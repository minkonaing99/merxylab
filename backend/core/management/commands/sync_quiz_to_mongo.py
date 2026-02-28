from django.core.management.base import BaseCommand

from core.models import Lesson
from core.mongo_store import mongo_enabled, set_quiz_payload


class Command(BaseCommand):
    help = "Sync lesson quiz_payload JSON from MySQL to MongoDB lesson_quizzes collection."

    def handle(self, *args, **options):
        if not mongo_enabled():
            self.stdout.write(self.style.WARNING("Mongo is not configured. Set MONGO_URI and MONGO_DB in backend/.env first."))
            return

        count = 0
        for lesson in Lesson.objects.exclude(quiz_payload={}):
            payload = lesson.quiz_payload or {}
            if payload.get("questions"):
                set_quiz_payload(lesson, payload)
                count += 1
        self.stdout.write(self.style.SUCCESS(f"Synced {count} lesson quiz documents to MongoDB (if configured)."))
