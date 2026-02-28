from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable

from django.conf import settings

try:
    from pymongo import MongoClient
except Exception:  # pragma: no cover
    MongoClient = None


_client = None


def mongo_enabled() -> bool:
    return bool(settings.MONGO_URI and settings.MONGO_DB)


def _get_collection():
    global _client
    if not mongo_enabled():
        return None
    if MongoClient is None:
        return None
    if _client is None:
        _client = MongoClient(settings.MONGO_URI, serverSelectionTimeoutMS=settings.MONGO_TIMEOUT_MS)
    try:
        db = _client[settings.MONGO_DB]
        col = db["lesson_quizzes"]
        col.create_index("lesson_id", unique=True)
        return col
    except Exception:
        return None


def _safe_questions(payload: dict | None) -> bool:
    return bool((payload or {}).get("questions"))


def get_quiz_payload(lesson) -> dict:
    if not mongo_enabled():
        return lesson.quiz_payload or {}

    col = _get_collection()
    if col is not None:
        try:
            doc = col.find_one({"lesson_id": lesson.id}, {"_id": 0, "quiz_payload": 1})
            if doc and _safe_questions(doc.get("quiz_payload")):
                return doc["quiz_payload"]
        except Exception:
            pass
    return {}


def set_quiz_payload(lesson, payload: dict):
    if not mongo_enabled():
        lesson.quiz_payload = payload
        lesson.save(update_fields=["quiz_payload", "updated_at"])
        return

    col = _get_collection()
    if col is not None:
        try:
            col.update_one(
                {"lesson_id": lesson.id},
                {
                    "$set": {
                        "lesson_id": lesson.id,
                        "course_id": lesson.course_id,
                        "quiz_payload": payload,
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
                upsert=True,
            )
            # Mongo is source of truth; avoid duplicated quiz data in SQL.
            if lesson.quiz_payload:
                lesson.quiz_payload = {}
                lesson.save(update_fields=["quiz_payload", "updated_at"])
        except Exception:
            raise


def delete_quiz_payload(lesson):
    if lesson.quiz_payload:
        lesson.quiz_payload = {}
        lesson.save(update_fields=["quiz_payload", "updated_at"])
    col = _get_collection()
    if col is not None:
        try:
            col.delete_one({"lesson_id": lesson.id})
        except Exception:
            pass


def get_quiz_map(lessons: Iterable) -> dict[int, dict]:
    lessons = list(lessons)
    lesson_ids = [lesson.id for lesson in lessons]
    lesson_map = {lesson.id: lesson for lesson in lessons}
    result = {}

    col = _get_collection()
    if col is not None and lesson_ids:
        try:
            for doc in col.find({"lesson_id": {"$in": lesson_ids}}, {"_id": 0, "lesson_id": 1, "quiz_payload": 1}):
                payload = doc.get("quiz_payload") or {}
                if _safe_questions(payload):
                    result[int(doc["lesson_id"])] = payload
        except Exception:
            pass

    if mongo_enabled():
        return result

    for lesson_id in lesson_ids:
        if lesson_id in result:
            continue
        payload = (lesson_map[lesson_id].quiz_payload or {})
        if _safe_questions(payload):
            result[lesson_id] = payload

    return result
