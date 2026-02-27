from datetime import timedelta
from pathlib import Path
from tempfile import TemporaryDirectory

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient, APITransactionTestCase

from core.models import (
    ActiveStreamSession,
    Course,
    Enrollment,
    Lesson,
    Quiz,
    QuizChoice,
    QuizQuestion,
    Section,
    UserLessonProgress,
)


@override_settings(
    STREAM_LEASE_TTL_SECONDS=180,
    STREAM_TOKEN_TTL_SECONDS=120,
    STREAM_SESSION_COOLDOWN_SECONDS=30,
)
class CoreApiFlowTests(APITransactionTestCase):
    def setUp(self):
        self.user_model = get_user_model()
        self.student = self.user_model.objects.create_user(username="student_test", password="student12345")
        self.other_student = self.user_model.objects.create_user(username="student_two", password="student12345")
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
        self.section = Section.objects.create(course=self.course, title="Start", order=1)

        self.temp_dir = TemporaryDirectory()
        lesson1_dir = Path(self.temp_dir.name) / "lesson1"
        lesson2_dir = Path(self.temp_dir.name) / "lesson2"
        lesson1_dir.mkdir(parents=True, exist_ok=True)
        lesson2_dir.mkdir(parents=True, exist_ok=True)
        (lesson1_dir / "master.m3u8").write_text("#EXTM3U\n#EXTINF:5,\nseg-1.ts\n#EXT-X-ENDLIST", encoding="utf-8")
        (lesson1_dir / "seg-1.ts").write_text("dummy", encoding="utf-8")
        (lesson2_dir / "master.m3u8").write_text("#EXTM3U\n#EXTINF:5,\nseg-1.ts\n#EXT-X-ENDLIST", encoding="utf-8")
        (lesson2_dir / "seg-1.ts").write_text("dummy", encoding="utf-8")

        self.preview_lesson = Lesson.objects.create(
            course=self.course,
            section=self.section,
            title="Preview Lesson",
            order=1,
            is_preview=True,
            hls_master_path=str((lesson1_dir / "master.m3u8").resolve()),
            duration_seconds=120,
        )
        self.paid_lesson = Lesson.objects.create(
            course=self.course,
            section=self.section,
            title="Locked Lesson",
            order=2,
            is_preview=False,
            hls_master_path=str((lesson2_dir / "master.m3u8").resolve()),
            duration_seconds=240,
        )
        self.lesson3 = Lesson.objects.create(
            course=self.course,
            section=self.section,
            title="Lesson 3",
            order=3,
            is_preview=False,
            hls_master_path=str((lesson2_dir / "master.m3u8").resolve()),
            duration_seconds=240,
        )

        self.quiz = Quiz.objects.create(lesson=self.paid_lesson, passing_score=70)
        self.question = QuizQuestion.objects.create(
            quiz=self.quiz,
            prompt="Which type stores whole numbers?",
            type=QuizQuestion.Type.MCQ,
            order=1,
        )
        self.correct_choice = QuizChoice.objects.create(question=self.question, text="int", is_correct=True)
        self.wrong_choice = QuizChoice.objects.create(question=self.question, text="str", is_correct=False)

    def tearDown(self):
        self.temp_dir.cleanup()
        super().tearDown()

    def auth_as_student(self):
        login = self.client.post(
            "/api/auth/login/",
            {"username": "student_test", "password": "student12345"},
            format="json",
        )
        self.assertEqual(login.status_code, 200)
        access = login.data["access"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")

    def auth_as_admin(self):
        login = self.client.post(
            "/api/auth/login/",
            {"username": "admin_test", "password": "admin12345"},
            format="json",
        )
        self.assertEqual(login.status_code, 200)
        access = login.data["access"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")

    def test_course_lesson_locking_and_enrollment(self):
        anon_lessons = self.client.get(f"/api/courses/{self.course.id}/lessons/")
        self.assertEqual(anon_lessons.status_code, 200)
        lesson_map = {item["id"]: item for item in anon_lessons.data["lessons"]}
        self.assertFalse(lesson_map[self.preview_lesson.id]["locked"])
        self.assertTrue(lesson_map[self.paid_lesson.id]["locked"])

        self.auth_as_student()
        enroll = self.client.post(f"/api/courses/{self.course.id}/enroll/", {}, format="json")
        self.assertIn(enroll.status_code, [200, 201])

        authed_lessons = self.client.get(f"/api/courses/{self.course.id}/lessons/")
        self.assertEqual(authed_lessons.status_code, 200)
        lesson_map = {item["id"]: item for item in authed_lessons.data["lessons"]}
        self.assertTrue(lesson_map[self.paid_lesson.id]["locked"])

        self.client.post(
            f"/api/lessons/{self.preview_lesson.id}/progress/",
            {"last_position_seconds": 120, "completed": True},
            format="json",
        )
        unlocked_after_progress = self.client.get(f"/api/courses/{self.course.id}/lessons/")
        lesson_map = {item["id"]: item for item in unlocked_after_progress.data["lessons"]}
        self.assertFalse(lesson_map[self.paid_lesson.id]["locked"])

    def test_lesson_access_and_progress(self):
        preview = self.client.get(f"/api/lessons/{self.preview_lesson.id}/")
        self.assertEqual(preview.status_code, 200)

        locked_anon = self.client.get(f"/api/lessons/{self.paid_lesson.id}/")
        self.assertEqual(locked_anon.status_code, 403)

        self.auth_as_student()
        self.client.post(f"/api/courses/{self.course.id}/enroll/", {}, format="json")

        locked_authed = self.client.get(f"/api/lessons/{self.paid_lesson.id}/")
        self.assertEqual(locked_authed.status_code, 403)

        self.client.post(
            f"/api/lessons/{self.preview_lesson.id}/progress/",
            {"last_position_seconds": 120, "completed": True},
            format="json",
        )
        locked_authed = self.client.get(f"/api/lessons/{self.paid_lesson.id}/")
        self.assertEqual(locked_authed.status_code, 200)

        get_progress = self.client.get(f"/api/lessons/{self.paid_lesson.id}/progress/")
        self.assertEqual(get_progress.status_code, 200)
        self.assertEqual(get_progress.data["last_position_seconds"], 0)

        post_progress = self.client.post(
            f"/api/lessons/{self.paid_lesson.id}/progress/",
            {"last_position_seconds": 33, "completed": False},
            format="json",
        )
        self.assertEqual(post_progress.status_code, 200)
        self.assertEqual(post_progress.data["last_position_seconds"], 33)
        self.assertTrue(
            UserLessonProgress.objects.filter(
                user=self.student,
                lesson=self.paid_lesson,
                last_position_seconds=33,
            ).exists()
        )

    def test_quiz_submit_and_attempts(self):
        self.auth_as_student()

        blocked_quiz = self.client.get(f"/api/lessons/{self.paid_lesson.id}/quiz/")
        self.assertEqual(blocked_quiz.status_code, 403)

        self.client.post(f"/api/courses/{self.course.id}/enroll/", {}, format="json")
        self.client.post(
            f"/api/lessons/{self.preview_lesson.id}/progress/",
            {"last_position_seconds": 120, "completed": True},
            format="json",
        )

        quiz_payload = self.client.get(f"/api/lessons/{self.paid_lesson.id}/quiz/")
        self.assertEqual(quiz_payload.status_code, 200)
        self.assertEqual(len(quiz_payload.data["questions"]), 1)

        submit = self.client.post(
            f"/api/quizzes/{self.quiz.id}/submit/",
            {
                "answers": [
                    {
                        "question_id": self.question.id,
                        "choice_id": self.correct_choice.id,
                    }
                ]
            },
            format="json",
        )
        self.assertEqual(submit.status_code, 201)
        self.assertTrue(submit.data["passed"])

        attempts = self.client.get(f"/api/quizzes/{self.quiz.id}/attempts/")
        self.assertEqual(attempts.status_code, 200)
        self.assertEqual(len(attempts.data), 1)

    def test_stream_session_cooldown_and_takeover(self):
        self.auth_as_student()
        self.client.post(f"/api/courses/{self.course.id}/enroll/", {}, format="json")
        self.client.post(
            f"/api/lessons/{self.preview_lesson.id}/progress/",
            {"last_position_seconds": 120, "completed": True},
            format="json",
        )

        first = self.client.post(
            f"/api/lessons/{self.paid_lesson.id}/stream-access/",
            {"device_id": "device-a"},
            format="json",
        )
        self.assertEqual(first.status_code, 200)
        first_session_id = first.data["session_id"]

        immediate_other = self.client.post(
            f"/api/lessons/{self.paid_lesson.id}/stream-access/",
            {"device_id": "device-b"},
            format="json",
        )
        self.assertEqual(immediate_other.status_code, 429)

        ActiveStreamSession.objects.filter(user=self.student).update(
            updated_at=timezone.now() - timedelta(seconds=31)
        )

        takeover = self.client.post(
            f"/api/lessons/{self.paid_lesson.id}/stream-access/",
            {"device_id": "device-b"},
            format="json",
        )
        self.assertEqual(takeover.status_code, 200)
        self.assertNotEqual(first_session_id, takeover.data["session_id"])

        old_heartbeat = self.client.post(
            "/api/stream/heartbeat/",
            {
                "session_id": first_session_id,
                "device_id": "device-a",
                "lesson_id": self.paid_lesson.id,
            },
            format="json",
        )
        self.assertEqual(old_heartbeat.status_code, 409)

    def test_stream_hls_requires_valid_token(self):
        self.auth_as_student()
        self.client.post(f"/api/courses/{self.course.id}/enroll/", {}, format="json")
        self.client.post(
            f"/api/lessons/{self.preview_lesson.id}/progress/",
            {"last_position_seconds": 120, "completed": True},
            format="json",
        )

        stream = self.client.post(
            f"/api/lessons/{self.paid_lesson.id}/stream-access/",
            {"device_id": "device-a"},
            format="json",
        )
        self.assertEqual(stream.status_code, 200)
        token = stream.data["playback_token"]

        anon_client = APIClient()

        authorized_asset = anon_client.get(
            f"/api/stream/hls/{self.paid_lesson.id}/master.m3u8?token={token}"
        )
        self.assertEqual(authorized_asset.status_code, 200)
        authorized_asset.close()

        invalid_asset = anon_client.get(
            f"/api/stream/hls/{self.paid_lesson.id}/master.m3u8"
        )
        self.assertEqual(invalid_asset.status_code, 401)

    def test_enrollment_uniqueness(self):
        self.auth_as_student()
        first = self.client.post(f"/api/courses/{self.course.id}/enroll/", {}, format="json")
        second = self.client.post(f"/api/courses/{self.course.id}/enroll/", {}, format="json")
        self.assertIn(first.status_code, [200, 201])
        self.assertEqual(second.status_code, 200)
        self.assertEqual(
            Enrollment.objects.filter(user=self.student, course=self.course).count(),
            1,
        )

    def test_admin_endpoints_permissions_and_create(self):
        self.auth_as_student()
        forbidden = self.client.get("/api/admin/courses/")
        self.assertEqual(forbidden.status_code, 403)
        forbidden_insights = self.client.get("/api/admin/insights/")
        self.assertEqual(forbidden_insights.status_code, 403)

        self.client.credentials()
        self.auth_as_admin()

        created_course = self.client.post(
            "/api/admin/courses/",
            {
                "title": "Admin Created Course",
                "description": "created by admin api",
                "slug": "admin-created-course",
                "level": "Intermediate",
                "price_cents": 0,
                "is_published": True,
            },
            format="json",
        )
        self.assertEqual(created_course.status_code, 201)
        new_course_id = created_course.data["id"]

        created_lesson = self.client.post(
            "/api/admin/lessons/",
            {
                "course_id": new_course_id,
                "section_title": "API Section",
                "section_order": 1,
                "title": "API Lesson",
                "order": 1,
                "is_preview": False,
            },
            format="json",
        )
        self.assertEqual(created_lesson.status_code, 201)
        new_lesson_id = created_lesson.data["id"]

        updated_hls = self.client.post(
            "/api/admin/upload-hls-metadata/",
            {
                "lesson_id": new_lesson_id,
                "hls_master_path": "media/hls/admin/lesson/master.m3u8",
                "duration_seconds": 360,
            },
            format="json",
        )
        self.assertEqual(updated_hls.status_code, 200)
        self.assertEqual(updated_hls.data["duration_seconds"], 360)

        created_quiz = self.client.post(
            "/api/admin/quizzes/",
            {
                "lesson_id": new_lesson_id,
                "passing_score": 70,
                "questions": [
                    {
                        "prompt": "Q1",
                        "type": "MCQ",
                        "order": 1,
                        "choices": [
                            {"text": "A", "is_correct": True},
                            {"text": "B", "is_correct": False},
                        ],
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(created_quiz.status_code, 201)

        insights = self.client.get("/api/admin/insights/")
        self.assertEqual(insights.status_code, 200)
        self.assertIn("totals", insights.data)
        self.assertIn("courses", insights.data)
        self.assertGreaterEqual(insights.data["totals"]["courses"], 1)

    @override_settings(QUIZ_FAIL_LIMIT_PER_DAY=3, QUIZ_FAIL_COOLDOWN_MINUTES=30)
    def test_quiz_fail_retry_cooldown(self):
        self.auth_as_student()
        self.client.post(f"/api/courses/{self.course.id}/enroll/", {}, format="json")
        self.client.post(
            f"/api/lessons/{self.preview_lesson.id}/progress/",
            {"last_position_seconds": 120, "completed": True},
            format="json",
        )

        payload = {
            "answers": [
                {
                    "question_id": self.question.id,
                    "choice_id": self.wrong_choice.id,
                }
            ]
        }
        for _ in range(3):
            r = self.client.post(f"/api/quizzes/{self.quiz.id}/submit/", payload, format="json")
            self.assertEqual(r.status_code, 201)
            self.assertFalse(r.data["passed"])

        blocked = self.client.post(f"/api/quizzes/{self.quiz.id}/submit/", payload, format="json")
        self.assertEqual(blocked.status_code, 429)
        self.assertIn("retry_after_seconds", blocked.data)

    def test_next_lesson_requires_previous_quiz_pass(self):
        self.auth_as_student()
        self.client.post(f"/api/courses/{self.course.id}/enroll/", {}, format="json")

        # Unlock lesson 2 by completing lesson 1.
        self.client.post(
            f"/api/lessons/{self.preview_lesson.id}/progress/",
            {"last_position_seconds": 120, "completed": True},
            format="json",
        )
        self.assertEqual(self.client.get(f"/api/lessons/{self.paid_lesson.id}/").status_code, 200)

        # Lesson 3 should remain locked because lesson 2 quiz is not passed yet.
        self.assertEqual(self.client.get(f"/api/lessons/{self.lesson3.id}/").status_code, 403)

        # Complete lesson 2 but still fail quiz => lesson 3 stays locked.
        self.client.post(
            f"/api/lessons/{self.paid_lesson.id}/progress/",
            {"last_position_seconds": 240, "completed": True},
            format="json",
        )
        self.client.post(
            f"/api/quizzes/{self.quiz.id}/submit/",
            {
                "answers": [
                    {
                        "question_id": self.question.id,
                        "choice_id": self.wrong_choice.id,
                    }
                ]
            },
            format="json",
        )
        self.assertEqual(self.client.get(f"/api/lessons/{self.lesson3.id}/").status_code, 403)

        # Pass quiz => lesson 3 unlocks.
        self.client.post(
            f"/api/quizzes/{self.quiz.id}/submit/",
            {
                "answers": [
                    {
                        "question_id": self.question.id,
                        "choice_id": self.correct_choice.id,
                    }
                ]
            },
            format="json",
        )
        self.assertEqual(self.client.get(f"/api/lessons/{self.lesson3.id}/").status_code, 200)

    def test_progress_completion_is_sticky(self):
        self.auth_as_student()
        self.client.post(f"/api/courses/{self.course.id}/enroll/", {}, format="json")

        self.client.post(
            f"/api/lessons/{self.preview_lesson.id}/progress/",
            {"last_position_seconds": 120, "completed": True},
            format="json",
        )
        self.client.post(
            f"/api/lessons/{self.preview_lesson.id}/progress/",
            {"last_position_seconds": 60, "completed": False},
            format="json",
        )

        progress = self.client.get(f"/api/lessons/{self.preview_lesson.id}/progress/")
        self.assertEqual(progress.status_code, 200)
        self.assertTrue(progress.data["completed"])

    def test_passing_quiz_marks_lesson_completed(self):
        self.auth_as_student()
        self.client.post(f"/api/courses/{self.course.id}/enroll/", {}, format="json")

        # Unlock lesson 2 via lesson 1 completion.
        self.client.post(
            f"/api/lessons/{self.preview_lesson.id}/progress/",
            {"last_position_seconds": 120, "completed": True},
            format="json",
        )

        # Pass lesson 2 quiz without explicitly marking lesson 2 progress complete.
        submit = self.client.post(
            f"/api/quizzes/{self.quiz.id}/submit/",
            {
                "answers": [
                    {
                        "question_id": self.question.id,
                        "choice_id": self.correct_choice.id,
                    }
                ]
            },
            format="json",
        )
        self.assertEqual(submit.status_code, 201)
        self.assertTrue(submit.data["passed"])

        progress = self.client.get(f"/api/lessons/{self.paid_lesson.id}/progress/")
        self.assertEqual(progress.status_code, 200)
        self.assertTrue(progress.data["completed"])
