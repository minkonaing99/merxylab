from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from core.models import Certificate, Course, CreditWallet, Enrollment, FinalExam, FinalExamChoice, FinalExamQuestion, FinalExamSession, Lesson, QuizAttempt, UserLessonProgress


@override_settings(MONGO_URI="", MONGO_DB="merxylab")
class CoreApiFlowTests(APITransactionTestCase):
    def setUp(self):
        self.user_model = get_user_model()
        self.student = self.user_model.objects.create_user(username="student_test", password="student12345")
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
        self.assertTrue(lesson_map[self.lesson2.id]["locked"])

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

        for _ in range(3):
            failed = self.client.post(
                f"/api/courses/{self.course.id}/final-exam/submit/",
                {"answers": [{"question_id": qid, "choice_id": wrong_choice}]},
                format="json",
            )
            self.assertEqual(failed.status_code, 201)
            self.assertFalse(failed.data["passed"])
            exam_payload = self.client.get(f"/api/courses/{self.course.id}/final-exam/")
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
