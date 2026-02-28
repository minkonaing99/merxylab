from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from core.models import Course, Enrollment, Lesson, QuizAttempt, UserLessonProgress


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
