from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand
from django.db import transaction

from core.models import Course, Lesson
from core.mongo_store import set_quiz_payload


class Command(BaseCommand):
    help = "Seed minimal local MVP data (idempotent)."

    @transaction.atomic
    def handle(self, *args, **options):
        user_model = get_user_model()

        admin_group, _ = Group.objects.get_or_create(name="admin")

        admin_user, created = user_model.objects.get_or_create(
            username="admin",
            defaults={"email": "admin@merxylab.local", "is_staff": True, "is_superuser": True},
        )
        if created:
            admin_user.set_password("admin12345")
            admin_user.save(update_fields=["password"])
        admin_user.groups.add(admin_group)

        student_user, created = user_model.objects.get_or_create(
            username="student1",
            defaults={"email": "student1@merxylab.local"},
        )
        if created:
            student_user.set_password("student12345")
            student_user.save(update_fields=["password"])

        course, _ = Course.objects.get_or_create(
            slug="python-basics",
            defaults={
                "title": "Python Basics",
                "description": "Starter course for MerxyLab local MVP.",
                "level": "Beginner",
                "price_cents": 0,
                "is_published": True,
            },
        )

        lesson1, _ = Lesson.objects.get_or_create(
            course=course,
            section_order=1,
            order=1,
            defaults={
                "section_title": "Getting Started",
                "title": "Welcome and Setup",
                "is_preview": True,
                "hls_master_path": "media/hls/python-basics/lesson-1/master.m3u8",
                "duration_seconds": 300,
            },
        )

        lesson2, _ = Lesson.objects.get_or_create(
            course=course,
            section_order=1,
            order=2,
            defaults={
                "section_title": "Getting Started",
                "title": "Variables and Data Types",
                "is_preview": False,
                "hls_master_path": "media/hls/python-basics/lesson-2/master.m3u8",
                "duration_seconds": 780,
            },
        )

        quiz_payload = {
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
                        {"id": 3, "text": "list", "is_correct": False},
                    ],
                }
            ],
        }
        set_quiz_payload(lesson2, quiz_payload)

        self.stdout.write(self.style.SUCCESS("Seed completed."))
        self.stdout.write("Admin user: admin / admin12345")
        self.stdout.write("Student user: student1 / student12345")
