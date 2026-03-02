from datetime import timedelta
import threading

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient, APITransactionTestCase

from core.models import (
    Certificate,
    Course,
    CreditTransaction,
    CreditWallet,
    Enrollment,
    FinalExam,
    FinalExamChoice,
    FinalExamQuestion,
    FinalExamSession,
    Lesson,
    QuizAttempt,
    StudentProfile,
    UserLessonProgress,
    CertificateVerificationLog,
)


@override_settings(MONGO_URI="", MONGO_DB="merxylab")
class CoreApiFlowTests(APITransactionTestCase):
    def setUp(self):
        self.user_model = get_user_model()
        self.student = self.user_model.objects.create_user(username="student_test", password="student12345")
        StudentProfile.objects.create(
            user=self.student,
            full_name="Student Test",
            verification_status=StudentProfile.VerificationStatus.VERIFIED,
        )
        self.admin = self.user_model.objects.create_superuser(
            username="admin_test",
            email="admin_test@local.dev",
            password="admin12345",
        )
        admin_group, _ = Group.objects.get_or_create(name="admin")
        self.admin.groups.add(admin_group)

        self.course = Course.objects.create(
            title="Python Basics",
            description="Test course",
            slug="python-basics-test",
            level="Beginner",
            is_published=True,
        )
        self.lesson1 = Lesson.objects.create(
            course=self.course,
            section_title="Start",
            section_order=1,
            title="Lesson 1",
            order=1,
            is_preview=True,
            duration_seconds=120,
        )
        self.lesson2 = Lesson.objects.create(
            course=self.course,
            section_title="Start",
            section_order=1,
            title="Lesson 2",
            order=2,
            is_preview=False,
            duration_seconds=240,
            quiz_payload={
                "passing_score": 70,
                "time_limit_sec": None,
                "questions": [
                    {
                        "id": 1,
                        "prompt": "Which type stores whole numbers?",
                        "type": "MCQ",
                        "order": 1,
                        "choices": [
                            {"id": 1, "text": "int", "is_correct": True},
                            {"id": 2, "text": "str", "is_correct": False},
                        ],
                    }
                ],
            },
        )
        self.lesson3 = Lesson.objects.create(
            course=self.course,
            section_title="Start",
            section_order=1,
            title="Lesson 3",
            order=3,
            is_preview=False,
            duration_seconds=180,
        )
        self.final_exam = FinalExam.objects.create(
            course=self.course,
            title="Python Final Exam",
            passing_score=70,
            is_published=True,
        )
        q1 = FinalExamQuestion.objects.create(exam=self.final_exam, prompt="What is Python?", order=1)
        FinalExamChoice.objects.create(question=q1, text="A programming language", is_correct=True, order=1)
        FinalExamChoice.objects.create(question=q1, text="A snake only", is_correct=False, order=2)
        self.paid_course = Course.objects.create(
            title="Paid Course",
            description="Paid",
            slug="paid-course-test",
            level="Intermediate",
            price_cents=50,
            is_published=True,
        )

    def auth_as_student(self):
        login = self.client.post(
            "/api/auth/login/",
            {"username": "student_test", "password": "student12345"},
            format="json",
        )
        self.assertEqual(login.status_code, 200)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")

    def auth_as_admin(self):
        login = self.client.post(
            "/api/auth/login/",
            {"username": "admin_test", "password": "admin12345"},
            format="json",
        )
        self.assertEqual(login.status_code, 200)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")

    def test_course_lesson_locking(self):
        anon = self.client.get(f"/api/courses/{self.course.id}/lessons/")
        self.assertEqual(anon.status_code, 200)
        lesson_map = {item["id"]: item for item in anon.data["lessons"]}
        self.assertFalse(lesson_map[self.lesson1.id]["locked"])
        # Product rule: first two lessons are free preview access.
        self.assertFalse(lesson_map[self.lesson2.id]["locked"])

    def test_unlock_next_lesson_after_pass(self):
        self.auth_as_student()
        self.client.post(f"/api/courses/{self.course.id}/enroll/", {}, format="json")
        self.client.post(
            f"/api/lessons/{self.lesson1.id}/progress/",
            {"last_position_seconds": 120, "completed": True},
            format="json",
        )
        self.assertEqual(self.client.get(f"/api/lessons/{self.lesson2.id}/").status_code, 200)
        self.assertEqual(self.client.get(f"/api/lessons/{self.lesson3.id}/").status_code, 403)

        submit = self.client.post(
            f"/api/quizzes/{self.lesson2.id}/submit/",
            {"answers": [{"question_id": 1, "choice_id": 1}]},
            format="json",
        )
        self.assertEqual(submit.status_code, 201)
        self.assertTrue(submit.data["passed"])
        self.assertEqual(self.client.get(f"/api/lessons/{self.lesson3.id}/").status_code, 200)

    @override_settings(QUIZ_FAIL_LIMIT_PER_DAY=3, QUIZ_FAIL_COOLDOWN_MINUTES=30)
    def test_quiz_cooldown(self):
        self.auth_as_student()
        self.client.post(f"/api/courses/{self.course.id}/enroll/", {}, format="json")
        self.client.post(
            f"/api/lessons/{self.lesson1.id}/progress/",
            {"last_position_seconds": 120, "completed": True},
            format="json",
        )
        payload = {"answers": [{"question_id": 1, "choice_id": 2}]}
        for _ in range(3):
            r = self.client.post(f"/api/quizzes/{self.lesson2.id}/submit/", payload, format="json")
            self.assertEqual(r.status_code, 201)
            self.assertFalse(r.data["passed"])
        blocked = self.client.post(f"/api/quizzes/{self.lesson2.id}/submit/", payload, format="json")
        self.assertEqual(blocked.status_code, 429)
        self.assertIn("retry_after_seconds", blocked.data)

    def test_attempts_endpoint(self):
        self.auth_as_student()
        self.client.post(f"/api/courses/{self.course.id}/enroll/", {}, format="json")
        self.client.post(
            f"/api/lessons/{self.lesson1.id}/progress/",
            {"last_position_seconds": 120, "completed": True},
            format="json",
        )
        self.client.post(
            f"/api/quizzes/{self.lesson2.id}/submit/",
            {"answers": [{"question_id": 1, "choice_id": 1}]},
            format="json",
        )
        attempts = self.client.get(f"/api/quizzes/{self.lesson2.id}/attempts/")
        self.assertEqual(attempts.status_code, 200)
        self.assertEqual(len(attempts.data), 1)
        self.assertEqual(attempts.data[0]["quiz_id"], self.lesson2.id)

    def test_quiz_submit_with_blank_answers_counts_as_fail(self):
        self.auth_as_student()
        self.client.post(f"/api/courses/{self.course.id}/enroll/", {}, format="json")
        self.client.post(
            f"/api/lessons/{self.lesson1.id}/progress/",
            {"last_position_seconds": 120, "completed": True},
            format="json",
        )
        submit = self.client.post(
            f"/api/quizzes/{self.lesson2.id}/submit/",
            {"answers": []},
            format="json",
        )
        self.assertEqual(submit.status_code, 201)
        self.assertFalse(submit.data["passed"])
        self.assertEqual(submit.data["summary"]["correct_answers"], 0)

    def test_admin_insights(self):
        self.auth_as_student()
        self.assertEqual(self.client.get("/api/admin/insights/").status_code, 403)
        self.client.credentials()
        self.auth_as_admin()
        res = self.client.get("/api/admin/insights/")
        self.assertEqual(res.status_code, 200)
        self.assertIn("totals", res.data)
        self.assertIn("courses", res.data)

    def test_progress_completion_sticky(self):
        self.auth_as_student()
        self.client.post(f"/api/courses/{self.course.id}/enroll/", {}, format="json")
        self.client.post(
            f"/api/lessons/{self.lesson1.id}/progress/",
            {"last_position_seconds": 120, "completed": True},
            format="json",
        )
        self.client.post(
            f"/api/lessons/{self.lesson1.id}/progress/",
            {"last_position_seconds": 30, "completed": False},
            format="json",
        )
        progress = UserLessonProgress.objects.get(user=self.student, lesson=self.lesson1)
        self.assertTrue(progress.completed)

    def test_unlock_next_lesson_after_ninety_percent_no_quiz_video(self):
        self.auth_as_student()
        self.client.post(f"/api/courses/{self.course.id}/enroll/", {}, format="json")
        # Lesson 1 has no quiz; >=90% watch progress should unlock lesson 2.
        self.client.post(
            f"/api/lessons/{self.lesson1.id}/progress/",
            {"last_position_seconds": 108, "completed": False},  # 90% of 120
            format="json",
        )
        self.assertEqual(self.client.get(f"/api/lessons/{self.lesson2.id}/").status_code, 200)

    def test_profile_and_exam_eligibility(self):
        self.auth_as_student()
        self.client.post(f"/api/courses/{self.course.id}/enroll/", {}, format="json")
        # Initially locked because not all lessons are completed/passed.
        initial = self.client.get(f"/api/courses/{self.course.id}/exam-eligibility/")
        self.assertEqual(initial.status_code, 200)
        self.assertFalse(initial.data["can_take_final_exam"])

        # Complete lesson 1 and pass lesson 2 quiz to unlock lesson 3, then complete lesson 3.
        self.client.post(
            f"/api/lessons/{self.lesson1.id}/progress/",
            {"last_position_seconds": 120, "completed": True},
            format="json",
        )
        self.client.post(
            f"/api/quizzes/{self.lesson2.id}/submit/",
            {"answers": [{"question_id": 1, "choice_id": 1}]},
            format="json",
        )
        self.client.post(
            f"/api/lessons/{self.lesson3.id}/progress/",
            {"last_position_seconds": 180, "completed": True},
            format="json",
        )
        unlocked = self.client.get(f"/api/courses/{self.course.id}/exam-eligibility/")
        self.assertEqual(unlocked.status_code, 200)
        self.assertTrue(unlocked.data["can_take_final_exam"])

        # Update profile data (without photo in tests) and ensure endpoint works.
        profile = self.client.patch(
            "/api/me/profile/",
            {
                "full_name": "Student Test",
                "date_of_birth": "2000-01-01",
                "passport_number": "AB123456",
                "country": "MM",
            },
            format="multipart",
        )
        self.assertEqual(profile.status_code, 200)
        self.assertEqual(profile.data["full_name"], "Student Test")

    def test_final_exam_submit_and_certificate_issue(self):
        self.auth_as_student()
        self.client.post(f"/api/courses/{self.course.id}/enroll/", {}, format="json")

        # Unlock final exam.
        self.client.post(
            f"/api/lessons/{self.lesson1.id}/progress/",
            {"last_position_seconds": 120, "completed": True},
            format="json",
        )
        self.client.post(
            f"/api/quizzes/{self.lesson2.id}/submit/",
            {"answers": [{"question_id": 1, "choice_id": 1}]},
            format="json",
        )
        self.client.post(
            f"/api/lessons/{self.lesson3.id}/progress/",
            {"last_position_seconds": 180, "completed": True},
            format="json",
        )

        exam_payload = self.client.get(f"/api/courses/{self.course.id}/final-exam/")
        self.assertEqual(exam_payload.status_code, 200)
        qid = exam_payload.data["questions"][0]["id"]
        correct_choice = FinalExamChoice.objects.get(question_id=qid, is_correct=True).id

        submit = self.client.post(
            f"/api/courses/{self.course.id}/final-exam/submit/",
            {"answers": [{"question_id": qid, "choice_id": correct_choice}]},
            format="json",
        )
        self.assertEqual(submit.status_code, 201)
        self.assertTrue(submit.data["passed"])
        self.assertTrue(submit.data["certificate_issued"])

        cert = self.client.get(f"/api/courses/{self.course.id}/certificate/")
        self.assertEqual(cert.status_code, 200)
        self.assertTrue(cert.data["issued"])
        self.assertEqual(Certificate.objects.filter(user=self.student, course=self.course).count(), 1)

        verify_code = cert.data["certificate"]["verification_code"]
        public_verify = self.client.get(f"/api/verify/{verify_code}/")
        self.assertEqual(public_verify.status_code, 200)
        self.assertTrue(public_verify.data["valid"])
        self.assertEqual(public_verify.data["status"], "valid")
        self.assertEqual(
            public_verify.data["certificate"]["certificate_code"],
            cert.data["certificate"]["certificate_code"],
        )

    def test_admin_certificate_revoke_reissue_and_audit(self):
        self.auth_as_student()
        self.client.post(f"/api/courses/{self.course.id}/enroll/", {}, format="json")
        self.client.post(
            f"/api/lessons/{self.lesson1.id}/progress/",
            {"last_position_seconds": 120, "completed": True},
            format="json",
        )
        self.client.post(
            f"/api/quizzes/{self.lesson2.id}/submit/",
            {"answers": [{"question_id": 1, "choice_id": 1}]},
            format="json",
        )
        self.client.post(
            f"/api/lessons/{self.lesson3.id}/progress/",
            {"last_position_seconds": 180, "completed": True},
            format="json",
        )
        exam_payload = self.client.get(f"/api/courses/{self.course.id}/final-exam/")
        qid = exam_payload.data["questions"][0]["id"]
        correct_choice = FinalExamChoice.objects.get(question_id=qid, is_correct=True).id
        submit = self.client.post(
            f"/api/courses/{self.course.id}/final-exam/submit/",
            {"answers": [{"question_id": qid, "choice_id": correct_choice}]},
            format="json",
        )
        self.assertEqual(submit.status_code, 201)
        cert = self.client.get(f"/api/courses/{self.course.id}/certificate/")
        self.assertEqual(cert.status_code, 200)
        cert_id = cert.data["certificate"]["id"]
        old_verify_code = cert.data["certificate"]["verification_code"]
        old_certificate_code = cert.data["certificate"]["certificate_code"]

        self.client.credentials()
        self.auth_as_admin()

        student_certs = self.client.get(f"/api/admin/students/{self.student.id}/certificates/")
        self.assertEqual(student_certs.status_code, 200)
        self.assertEqual(len(student_certs.data["certificates"]), 1)
        self.assertEqual(student_certs.data["certificates"][0]["certificate"]["id"], cert_id)

        revoked = self.client.post(
            f"/api/admin/certificates/{cert_id}/revoke/",
            {"reason": "Academic integrity review."},
            format="json",
        )
        self.assertEqual(revoked.status_code, 200)
        self.assertTrue(bool(revoked.data["certificate"]["revoked_at"]))

        public_revoked = self.client.get(f"/api/verify/{old_verify_code}/")
        self.assertEqual(public_revoked.status_code, 200)
        self.assertFalse(public_revoked.data["valid"])
        self.assertEqual(public_revoked.data["status"], "revoked")

        reissued = self.client.post(
            f"/api/admin/certificates/{cert_id}/reissue/",
            {"reason": "Reissued after review closure."},
            format="json",
        )
        self.assertEqual(reissued.status_code, 200)
        new_verify_code = reissued.data["certificate"]["verification_code"]
        new_certificate_code = reissued.data["certificate"]["certificate_code"]
        self.assertNotEqual(new_verify_code, old_verify_code)
        self.assertNotEqual(new_certificate_code, old_certificate_code)

        old_verify_lookup = self.client.get(f"/api/verify/{old_verify_code}/")
        self.assertEqual(old_verify_lookup.status_code, 404)
        new_verify_lookup = self.client.get(f"/api/verify/{new_verify_code}/")
        self.assertEqual(new_verify_lookup.status_code, 200)
        self.assertTrue(new_verify_lookup.data["valid"])
        self.assertEqual(new_verify_lookup.data["status"], "valid")

        audit_feed = self.client.get("/api/admin/certificates/audit/")
        self.assertEqual(audit_feed.status_code, 200)
        actions = [item["action"] for item in audit_feed.data if item["id"]]
        self.assertIn("ISSUED", actions)
        self.assertIn("REVOKED", actions)
        self.assertIn("REISSUED", actions)

    @override_settings(
        CERT_VERIFY_RATE_LIMIT=1,
        CERT_VERIFY_RATE_WINDOW_SECONDS=300,
        CERT_VERIFY_RATE_LOCK_SECONDS=300,
    )
    def test_public_verify_rate_limit_and_event_logs(self):
        self.auth_as_student()
        self.client.post(f"/api/courses/{self.course.id}/enroll/", {}, format="json")
        self.client.post(
            f"/api/lessons/{self.lesson1.id}/progress/",
            {"last_position_seconds": 120, "completed": True},
            format="json",
        )
        self.client.post(
            f"/api/quizzes/{self.lesson2.id}/submit/",
            {"answers": [{"question_id": 1, "choice_id": 1}]},
            format="json",
        )
        self.client.post(
            f"/api/lessons/{self.lesson3.id}/progress/",
            {"last_position_seconds": 180, "completed": True},
            format="json",
        )
        exam_payload = self.client.get(f"/api/courses/{self.course.id}/final-exam/")
        qid = exam_payload.data["questions"][0]["id"]
        correct_choice = FinalExamChoice.objects.get(question_id=qid, is_correct=True).id
        self.client.post(
            f"/api/courses/{self.course.id}/final-exam/submit/",
            {"answers": [{"question_id": qid, "choice_id": correct_choice}]},
            format="json",
        )
        cert = self.client.get(f"/api/courses/{self.course.id}/certificate/")
        verify_code = cert.data["certificate"]["verification_code"]
        self.client.credentials()

        first = self.client.get(f"/api/verify/{verify_code}/")
        self.assertEqual(first.status_code, 200)
        second = self.client.get(f"/api/verify/{verify_code}/")
        self.assertEqual(second.status_code, 429)
        self.assertIn("retry_after_seconds", second.data)

        self.assertTrue(
            CertificateVerificationLog.objects.filter(
                verification_code=verify_code,
                status=CertificateVerificationLog.Status.VALID,
            ).exists()
        )
        self.assertTrue(
            CertificateVerificationLog.objects.filter(
                verification_code=verify_code,
                status=CertificateVerificationLog.Status.RATE_LIMITED,
            ).exists()
        )

        self.auth_as_admin()
        logs = self.client.get(f"/api/admin/certificates/verification-logs/?user_id={self.student.id}")
        self.assertEqual(logs.status_code, 200)
        self.assertTrue(any(row["verification_code"] == verify_code for row in logs.data))

    def test_public_verify_detects_tampered_signed_payload(self):
        self.auth_as_student()
        self.client.post(f"/api/courses/{self.course.id}/enroll/", {}, format="json")
        self.client.post(
            f"/api/lessons/{self.lesson1.id}/progress/",
            {"last_position_seconds": 120, "completed": True},
            format="json",
        )
        self.client.post(
            f"/api/quizzes/{self.lesson2.id}/submit/",
            {"answers": [{"question_id": 1, "choice_id": 1}]},
            format="json",
        )
        self.client.post(
            f"/api/lessons/{self.lesson3.id}/progress/",
            {"last_position_seconds": 180, "completed": True},
            format="json",
        )
        exam_payload = self.client.get(f"/api/courses/{self.course.id}/final-exam/")
        qid = exam_payload.data["questions"][0]["id"]
        correct_choice = FinalExamChoice.objects.get(question_id=qid, is_correct=True).id
        self.client.post(
            f"/api/courses/{self.course.id}/final-exam/submit/",
            {"answers": [{"question_id": qid, "choice_id": correct_choice}]},
            format="json",
        )

        cert = Certificate.objects.get(user=self.student, course=self.course)
        verify_code = cert.verification_code
        cert.signed_payload = f"{cert.signed_payload}.tampered"
        cert.save(update_fields=["signed_payload", "updated_at"])

        tampered = self.client.get(f"/api/verify/{verify_code}/")
        self.assertEqual(tampered.status_code, 200)
        self.assertFalse(tampered.data["valid"])
        self.assertEqual(tampered.data["status"], "invalid_signature")

    def test_legacy_certificate_missing_signature_fields_backfills_on_read(self):
        self.auth_as_student()
        self.client.post(f"/api/courses/{self.course.id}/enroll/", {}, format="json")
        self.client.post(
            f"/api/lessons/{self.lesson1.id}/progress/",
            {"last_position_seconds": 120, "completed": True},
            format="json",
        )
        self.client.post(
            f"/api/quizzes/{self.lesson2.id}/submit/",
            {"answers": [{"question_id": 1, "choice_id": 1}]},
            format="json",
        )
        self.client.post(
            f"/api/lessons/{self.lesson3.id}/progress/",
            {"last_position_seconds": 180, "completed": True},
            format="json",
        )
        exam_payload = self.client.get(f"/api/courses/{self.course.id}/final-exam/")
        qid = exam_payload.data["questions"][0]["id"]
        correct_choice = FinalExamChoice.objects.get(question_id=qid, is_correct=True).id
        self.client.post(
            f"/api/courses/{self.course.id}/final-exam/submit/",
            {"answers": [{"question_id": qid, "choice_id": correct_choice}]},
            format="json",
        )

        cert = Certificate.objects.get(user=self.student, course=self.course)
        cert.verification_code = ""
        cert.signed_payload = ""
        cert.signature_version = 0
        cert.save(update_fields=["verification_code", "signed_payload", "signature_version", "updated_at"])

        payload = self.client.get(f"/api/courses/{self.course.id}/certificate/")
        self.assertEqual(payload.status_code, 200)
        self.assertTrue(payload.data["issued"])
        self.assertTrue(payload.data["certificate"]["verification_code"])
        self.assertTrue(payload.data["certificate"]["signed_payload"])
        self.assertEqual(payload.data["certificate"]["signature_version"], 1)

        verify = self.client.get(f"/api/verify/{payload.data['certificate']['verification_code']}/")
        self.assertEqual(verify.status_code, 200)
        self.assertTrue(verify.data["valid"])

    def test_certificate_not_issued_when_profile_not_verified(self):
        profile = StudentProfile.objects.get(user=self.student)
        profile.verification_status = StudentProfile.VerificationStatus.PENDING
        profile.save(update_fields=["verification_status", "updated_at"])

        self.auth_as_student()
        self.client.post(f"/api/courses/{self.course.id}/enroll/", {}, format="json")
        self.client.post(
            f"/api/lessons/{self.lesson1.id}/progress/",
            {"last_position_seconds": 120, "completed": True},
            format="json",
        )
        self.client.post(
            f"/api/quizzes/{self.lesson2.id}/submit/",
            {"answers": [{"question_id": 1, "choice_id": 1}]},
            format="json",
        )
        self.client.post(
            f"/api/lessons/{self.lesson3.id}/progress/",
            {"last_position_seconds": 180, "completed": True},
            format="json",
        )
        exam_payload = self.client.get(f"/api/courses/{self.course.id}/final-exam/")
        qid = exam_payload.data["questions"][0]["id"]
        correct_choice = FinalExamChoice.objects.get(question_id=qid, is_correct=True).id
        submit = self.client.post(
            f"/api/courses/{self.course.id}/final-exam/submit/",
            {"answers": [{"question_id": qid, "choice_id": correct_choice}]},
            format="json",
        )
        self.assertEqual(submit.status_code, 201)
        self.assertTrue(submit.data["passed"])
        self.assertFalse(submit.data["certificate_issued"])
        self.assertIn("certificate_blocked_reason", submit.data)
        self.assertEqual(Certificate.objects.filter(user=self.student, course=self.course).count(), 0)

    def test_certificate_view_forbidden_when_profile_not_verified(self):
        profile = StudentProfile.objects.get(user=self.student)
        profile.verification_status = StudentProfile.VerificationStatus.PENDING
        profile.save(update_fields=["verification_status", "updated_at"])

        self.auth_as_student()
        self.client.post(f"/api/courses/{self.course.id}/enroll/", {}, format="json")
        blocked = self.client.get(f"/api/courses/{self.course.id}/certificate/")
        self.assertEqual(blocked.status_code, 403)
        self.assertIn("verification", blocked.data["detail"].lower())

    def test_final_exam_submit_with_blank_answers_counts_as_fail(self):
        self.auth_as_student()
        self.client.post(f"/api/courses/{self.course.id}/enroll/", {}, format="json")
        self.client.post(
            f"/api/lessons/{self.lesson1.id}/progress/",
            {"last_position_seconds": 120, "completed": True},
            format="json",
        )
        self.client.post(
            f"/api/quizzes/{self.lesson2.id}/submit/",
            {"answers": [{"question_id": 1, "choice_id": 1}]},
            format="json",
        )
        self.client.post(
            f"/api/lessons/{self.lesson3.id}/progress/",
            {"last_position_seconds": 180, "completed": True},
            format="json",
        )

        submit = self.client.post(
            f"/api/courses/{self.course.id}/final-exam/submit/",
            {"answers": []},
            format="json",
        )
        self.assertEqual(submit.status_code, 201)
        self.assertFalse(submit.data["passed"])
        self.assertEqual(submit.data["summary"]["correct_answers"], 0)

    def test_final_exam_retry_fee_after_three_failures(self):
        self.auth_as_student()
        self.client.post(f"/api/courses/{self.course.id}/enroll/", {}, format="json")
        self.client.post(
            f"/api/lessons/{self.lesson1.id}/progress/",
            {"last_position_seconds": 120, "completed": True},
            format="json",
        )
        self.client.post(
            f"/api/quizzes/{self.lesson2.id}/submit/",
            {"answers": [{"question_id": 1, "choice_id": 1}]},
            format="json",
        )
        self.client.post(
            f"/api/lessons/{self.lesson3.id}/progress/",
            {"last_position_seconds": 180, "completed": True},
            format="json",
        )

        exam_payload = self.client.get(f"/api/courses/{self.course.id}/final-exam/")
        self.assertEqual(exam_payload.status_code, 200)
        qid = exam_payload.data["questions"][0]["id"]
        wrong_choice = FinalExamChoice.objects.get(question_id=qid, is_correct=False).id

        for attempt_idx in range(3):
            failed = self.client.post(
                f"/api/courses/{self.course.id}/final-exam/submit/",
                {"answers": [{"question_id": qid, "choice_id": wrong_choice}]},
                format="json",
            )
            self.assertEqual(failed.status_code, 201)
            self.assertFalse(failed.data["passed"])
            # Refresh active exam session only while retry fee is not yet enforced.
            if attempt_idx < 2:
                exam_payload = self.client.get(f"/api/courses/{self.course.id}/final-exam/")
                self.assertEqual(exam_payload.status_code, 200)
                qid = exam_payload.data["questions"][0]["id"]
                wrong_choice = FinalExamChoice.objects.get(question_id=qid, is_correct=False).id

        blocked = self.client.post(
            f"/api/courses/{self.course.id}/final-exam/submit/",
            {"answers": [{"question_id": qid, "choice_id": wrong_choice}]},
            format="json",
        )
        self.assertEqual(blocked.status_code, 400)
        self.assertIn("Insufficient credits", blocked.data["detail"])
        self.assertEqual(int(blocked.data["required_credits"]), 50)

        wallet = CreditWallet.objects.get(user=self.student)
        wallet.balance_credits = 60
        wallet.save(update_fields=["balance_credits", "updated_at"])

        charged = self.client.post(
            f"/api/courses/{self.course.id}/final-exam/submit/",
            {"answers": [{"question_id": qid, "choice_id": wrong_choice}]},
            format="json",
        )
        self.assertEqual(charged.status_code, 201)
        self.assertEqual(int(charged.data["charged_credits"]), 50)
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance_credits, 10)

    def test_admin_final_exam_quick_actions(self):
        self.auth_as_admin()

        # Unpublish
        unpublish = self.client.patch(
            f"/api/admin/courses/{self.course.id}/final-exam/publish/",
            {"is_published": False},
            format="json",
        )
        self.assertEqual(unpublish.status_code, 200)
        self.assertFalse(unpublish.data["is_published"])

        # Delete one question
        qid = self.final_exam.questions.first().id
        delete_q = self.client.delete(f"/api/admin/final-exam/questions/{qid}/")
        self.assertEqual(delete_q.status_code, 204)

        # Reset exam (no questions and unpublished)
        reset = self.client.post(f"/api/admin/courses/{self.course.id}/final-exam/reset/", {}, format="json")
        self.assertEqual(reset.status_code, 200)
        self.assertEqual(len(reset.data["exam"]["questions"]), 0)
        self.assertFalse(reset.data["exam"]["is_published"])

    def test_final_exam_randomized_five_persistent_until_submit(self):
        self.auth_as_student()
        course = Course.objects.create(
            title="Python Advanced",
            description="Advanced test course",
            slug="python-advanced-test",
            level="Advanced",
            is_published=True,
        )
        lesson = Lesson.objects.create(
            course=course,
            section_title="Start",
            section_order=1,
            title="Lesson 1",
            order=1,
            is_preview=False,
            duration_seconds=100,
        )
        exam = FinalExam.objects.create(
            course=course,
            title="Advanced Final",
            passing_score=60,
            is_published=True,
        )
        for idx in range(1, 11):
            question = FinalExamQuestion.objects.create(exam=exam, prompt=f"Q{idx}", order=idx)
            FinalExamChoice.objects.create(question=question, text="A", is_correct=True, order=1)
            FinalExamChoice.objects.create(question=question, text="B", is_correct=False, order=2)
            FinalExamChoice.objects.create(question=question, text="C", is_correct=False, order=3)

        self.client.post(f"/api/courses/{course.id}/enroll/", {}, format="json")
        self.client.post(
            f"/api/lessons/{lesson.id}/progress/",
            {"last_position_seconds": 100, "completed": True},
            format="json",
        )

        first = self.client.get(f"/api/courses/{course.id}/final-exam/")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(len(first.data["questions"]), 5)
        first_ids = [row["id"] for row in first.data["questions"]]

        second = self.client.get(f"/api/courses/{course.id}/final-exam/")
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first_ids, [row["id"] for row in second.data["questions"]])

        active_session = FinalExamSession.objects.filter(user=self.student, exam=exam).first()
        self.assertIsNotNone(active_session)
        self.assertEqual(first_ids, active_session.question_ids)

        answers = []
        for question in second.data["questions"]:
            choice_id = question["choices"][0]["id"]
            answers.append({"question_id": question["id"], "choice_id": choice_id})
        submitted = self.client.post(
            f"/api/courses/{course.id}/final-exam/submit/",
            {"answers": answers},
            format="json",
        )
        self.assertEqual(submitted.status_code, 201)
        self.assertFalse(FinalExamSession.objects.filter(user=self.student, exam=exam).exists())

    def test_paid_enrollment_requires_credits(self):
        self.auth_as_student()
        no_credit = self.client.post(f"/api/courses/{self.paid_course.id}/enroll/", {}, format="json")
        self.assertEqual(no_credit.status_code, 400)
        self.assertIn("Insufficient credits", no_credit.data["detail"])

        self.client.credentials()
        self.auth_as_admin()
        add_credit = self.client.post(
            f"/api/admin/students/{self.student.id}/wallet/adjust/",
            {"amount": 120, "note": "Top up"},
            format="json",
        )
        self.assertEqual(add_credit.status_code, 201)
        self.client.credentials()
        self.auth_as_student()

        ok = self.client.post(f"/api/courses/{self.paid_course.id}/enroll/", {}, format="json")
        self.assertEqual(ok.status_code, 201)
        self.assertEqual(ok.data["charged_credits"], 50)
        wallet = CreditWallet.objects.get(user=self.student)
        self.assertEqual(wallet.balance_credits, 70)

    def test_admin_student_wallet_endpoints(self):
        self.auth_as_admin()
        Enrollment.objects.create(user=self.student, course=self.course, status=Enrollment.Status.ACTIVE)
        rows = self.client.get("/api/admin/students/")
        self.assertEqual(rows.status_code, 200)
        target = next(row for row in rows.data if row["user_id"] == self.student.id)
        self.assertIn("owned_courses", target)
        self.assertIn(self.course.title, target["owned_courses"])

        detail = self.client.get(f"/api/admin/students/{self.student.id}/wallet/")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.data["student"]["id"], self.student.id)

    def test_schedule_edges_course_visibility_and_access(self):
        future_course = Course.objects.create(
            title="Future Course",
            description="Not yet live",
            slug="future-course-test",
            level="Beginner",
            is_published=True,
            publish_at=timezone.now() + timedelta(hours=2),
        )
        expired_course = Course.objects.create(
            title="Expired Course",
            description="Already unpublished",
            slug="expired-course-test",
            level="Beginner",
            is_published=True,
            unpublish_at=timezone.now() - timedelta(minutes=1),
        )

        listed = self.client.get("/api/courses/")
        self.assertEqual(listed.status_code, 200)
        listed_ids = {row["id"] for row in listed.data}
        self.assertIn(self.course.id, listed_ids)
        self.assertNotIn(future_course.id, listed_ids)
        self.assertNotIn(expired_course.id, listed_ids)

        hidden_detail = self.client.get(f"/api/courses/{future_course.slug}/")
        self.assertEqual(hidden_detail.status_code, 404)
        hidden_access = self.client.get(f"/api/courses/{expired_course.id}/access/")
        self.assertEqual(hidden_access.status_code, 404)

    @override_settings(
        AUTH_LOGIN_USER_RATE_LIMIT=2,
        AUTH_LOGIN_USER_RATE_WINDOW_SECONDS=3600,
        AUTH_LOGIN_USER_RATE_LOCK_SECONDS=300,
        AUTH_LOGIN_IP_RATE_LIMIT=999,
    )
    def test_auth_login_lockout_flow(self):
        for _ in range(2):
            bad = self.client.post(
                "/api/auth/login/",
                {"username": "student_test", "password": "wrong-pass"},
                format="json",
            )
            self.assertEqual(bad.status_code, 401)

        locked = self.client.post(
            "/api/auth/login/",
            {"username": "student_test", "password": "wrong-pass"},
            format="json",
        )
        self.assertEqual(locked.status_code, 429)
        self.assertIn("retry_after_seconds", locked.data)

    @override_settings(
        EXAM_SUBMIT_RATE_LIMIT=2,
        EXAM_SUBMIT_RATE_WINDOW_SECONDS=3600,
        EXAM_SUBMIT_RATE_LOCK_SECONDS=300,
    )
    def test_final_exam_submit_lockout_flow(self):
        self.auth_as_student()
        self.client.post(f"/api/courses/{self.course.id}/enroll/", {}, format="json")
        self.client.post(
            f"/api/lessons/{self.lesson1.id}/progress/",
            {"last_position_seconds": 120, "completed": True},
            format="json",
        )
        self.client.post(
            f"/api/quizzes/{self.lesson2.id}/submit/",
            {"answers": [{"question_id": 1, "choice_id": 1}]},
            format="json",
        )
        self.client.post(
            f"/api/lessons/{self.lesson3.id}/progress/",
            {"last_position_seconds": 180, "completed": True},
            format="json",
        )

        for _ in range(2):
            submitted = self.client.post(
                f"/api/courses/{self.course.id}/final-exam/submit/",
                {"answers": []},
                format="json",
            )
            self.assertEqual(submitted.status_code, 201)

        locked = self.client.post(
            f"/api/courses/{self.course.id}/final-exam/submit/",
            {"answers": []},
            format="json",
        )
        self.assertEqual(locked.status_code, 429)
        self.assertIn("retry_after_seconds", locked.data)

    def test_paid_enrollment_credit_race_charges_once(self):
        wallet, _ = CreditWallet.objects.get_or_create(user=self.student, defaults={"balance_credits": 0})
        wallet.balance_credits = 100
        wallet.save(update_fields=["balance_credits", "updated_at"])

        login = self.client.post(
            "/api/auth/login/",
            {"username": "student_test", "password": "student12345"},
            format="json",
        )
        self.assertEqual(login.status_code, 200)
        token = login.data["access"]

        barrier = threading.Barrier(2)
        responses = []

        def enroll_once():
            local_client = APIClient()
            local_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
            barrier.wait(timeout=5)
            res = local_client.post(f"/api/courses/{self.paid_course.id}/enroll/", {}, format="json")
            responses.append(res.status_code)

        t1 = threading.Thread(target=enroll_once)
        t2 = threading.Thread(target=enroll_once)
        t1.start()
        t2.start()
        t1.join(timeout=10)
        t2.join(timeout=10)

        self.assertEqual(len(responses), 2)
        self.assertEqual(sorted(responses), [200, 201])
        self.assertEqual(Enrollment.objects.filter(user=self.student, course=self.paid_course).count(), 1)
        self.assertEqual(
            CreditTransaction.objects.filter(user=self.student, course=self.paid_course).count(),
            1,
        )
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance_credits, 50)

    def test_quiz_submit_rejects_tampered_session_token(self):
        self.auth_as_student()
        self.client.post(f"/api/courses/{self.course.id}/enroll/", {}, format="json")
        self.client.post(
            f"/api/lessons/{self.lesson1.id}/progress/",
            {"last_position_seconds": 120, "completed": True},
            format="json",
        )
        quiz_payload = self.client.get(f"/api/lessons/{self.lesson2.id}/quiz/")
        self.assertEqual(quiz_payload.status_code, 200)
        question = quiz_payload.data["questions"][0]
        choice = question["choices"][0]

        tampered = self.client.post(
            f"/api/quizzes/{self.lesson2.id}/submit/",
            {
                "session_token": f"{quiz_payload.data['session_token']}tampered",
                "answers": [{"question_id": question["id"], "choice_id": choice["id"]}],
            },
            format="json",
        )
        self.assertEqual(tampered.status_code, 400)
        self.assertIn("session", str(tampered.data.get("detail", "")).lower())

    def test_final_exam_submit_rejects_question_outside_active_session(self):
        self.auth_as_student()
        course = Course.objects.create(
            title="Exam Session Guard Course",
            description="Session guard",
            slug="exam-session-guard-course",
            level="Intermediate",
            is_published=True,
        )
        lesson = Lesson.objects.create(
            course=course,
            section_title="Start",
            section_order=1,
            title="Lesson 1",
            order=1,
            is_preview=False,
            duration_seconds=60,
        )
        exam = FinalExam.objects.create(
            course=course,
            title="Guarded Exam",
            passing_score=60,
            is_published=True,
        )
        for idx in range(1, 7):
            question = FinalExamQuestion.objects.create(exam=exam, prompt=f"GQ{idx}", order=idx)
            FinalExamChoice.objects.create(question=question, text="A", is_correct=True, order=1)
            FinalExamChoice.objects.create(question=question, text="B", is_correct=False, order=2)

        self.client.post(f"/api/courses/{course.id}/enroll/", {}, format="json")
        self.client.post(
            f"/api/lessons/{lesson.id}/progress/",
            {"last_position_seconds": 60, "completed": True},
            format="json",
        )

        exam_payload = self.client.get(f"/api/courses/{course.id}/final-exam/")
        self.assertEqual(exam_payload.status_code, 200)
        active_question_ids = {row["id"] for row in exam_payload.data["questions"]}
        self.assertEqual(len(active_question_ids), 5)

        outside_question = (
            FinalExamQuestion.objects.filter(exam=exam).exclude(id__in=active_question_ids).order_by("id").first()
        )
        self.assertIsNotNone(outside_question)
        outside_choice = FinalExamChoice.objects.filter(question=outside_question).order_by("id").first()

        invalid = self.client.post(
            f"/api/courses/{course.id}/final-exam/submit/",
            {"answers": [{"question_id": outside_question.id, "choice_id": outside_choice.id}]},
            format="json",
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertIn("not part of this exam", str(invalid.data.get("detail", "")).lower())
