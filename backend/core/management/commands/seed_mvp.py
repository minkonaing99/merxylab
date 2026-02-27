from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand
from django.db import transaction

from core.models import Course, Lesson, Quiz, QuizChoice, QuizQuestion, Section


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

        section, _ = Section.objects.get_or_create(
            course=course,
            order=1,
            defaults={"title": "Getting Started"},
        )

        lesson1, _ = Lesson.objects.get_or_create(
            section=section,
            order=1,
            defaults={
                "course": course,
                "title": "Welcome and Setup",
                "is_preview": True,
                "hls_master_path": "media/hls/python-basics/lesson-1/master.m3u8",
                "duration_seconds": 300,
            },
        )

        lesson2, _ = Lesson.objects.get_or_create(
            section=section,
            order=2,
            defaults={
                "course": course,
                "title": "Variables and Data Types",
                "is_preview": False,
                "hls_master_path": "media/hls/python-basics/lesson-2/master.m3u8",
                "duration_seconds": 780,
            },
        )

        quiz, _ = Quiz.objects.get_or_create(lesson=lesson2, defaults={"passing_score": 70})
        question, _ = QuizQuestion.objects.get_or_create(
            quiz=quiz,
            order=1,
            defaults={"prompt": "Which type stores whole numbers?", "type": QuizQuestion.Type.MCQ},
        )
        QuizChoice.objects.get_or_create(question=question, text="int", defaults={"is_correct": True})
        QuizChoice.objects.get_or_create(question=question, text="str", defaults={"is_correct": False})
        QuizChoice.objects.get_or_create(question=question, text="list", defaults={"is_correct": False})

        self.stdout.write(self.style.SUCCESS("Seed completed."))
        self.stdout.write("Admin user: admin / admin12345")
        self.stdout.write("Student user: student1 / student12345")
