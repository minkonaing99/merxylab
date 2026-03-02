import mimetypes
import random
import shutil
import uuid
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core import signing
from django.core.exceptions import SuspiciousFileOperation
from django.db import transaction
from django.db.models import Count, Q
from django.http import FileResponse, Http404, HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from core.models import (
    ActiveStreamSession,
    Certificate,
    CertificateAuditLog,
    CertificateVerificationLog,
    Course,
    CreditTransaction,
    CreditWallet,
    EndpointRateLimit,
    Enrollment,
    VideoTranscodeJob,
    FinalExam,
    FinalExamAttempt,
    FinalExamChoice,
    FinalExamQuestion,
    FinalExamSession,
    Lesson,
    QuizAttempt,
    StudentProfile,
    UserLessonProgress,
)
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from core.permissions import IsAdminRole
from core.certificates import ensure_certificate_signature, validate_certificate_signature
from core.mongo_store import delete_quiz_payload, get_quiz_map, get_quiz_payload, set_quiz_payload
from core.serializers import (
    AdminCreditAdjustSerializer,
    AdminCourseCreateSerializer,
    AdminCourseUpdateSerializer,
    AdminCertificateActionSerializer,
    AdminFinalExamUpsertSerializer,
    AdminLessonCreateSerializer,
    AdminLessonUpdateSerializer,
    AdminQuizCreateSerializer,
    AdminQuizUpdateSerializer,
    AdminSectionSerializer,
    AdminStudentListRowSerializer,
    AdminUploadHlsMetadataSerializer,
    AdminUploadVideoSerializer,
    CertificateSerializer,
    CertificateAuditLogSerializer,
    CertificateVerificationLogSerializer,
    CreditTransactionSerializer,
    CreditWalletSerializer,
    CourseDetailSerializer,
    CourseListSerializer,
    EnrollmentSerializer,
    FinalExamAttemptSerializer,
    FinalExamSerializer,
    FinalExamSubmitSerializer,
    LessonAccessSerializer,
    LessonDetailSerializer,
    QuizAttemptSerializer,
    QuizSubmitSerializer,
    StreamAccessSerializer,
    StreamHeartbeatSerializer,
    StudentProfileSerializer,
    UserLessonProgressSerializer,
    UserLessonProgressUpsertSerializer,
)

@api_view(["GET"])
@permission_classes([AllowAny])
def health_check(_request):
    return Response({"status": "ok"})


class RegisterSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    email = serializers.EmailField(required=False, allow_blank=True)
    password = serializers.CharField(min_length=8, write_only=True)

    def validate_username(self, value):
        user_model = get_user_model()
        if user_model.objects.filter(username=value).exists():
            raise serializers.ValidationError("Username is already taken.")
        return value


class LogoutSerializer(serializers.Serializer):
    refresh = serializers.CharField()


def _client_ip(request):
    forwarded_for = (request.META.get("HTTP_X_FORWARDED_FOR", "") or "").strip()
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return (request.META.get("REMOTE_ADDR", "") or "").strip() or "unknown"


def _safe_subject(value):
    return str(value or "").strip().lower()[:180] or "unknown"


def _rate_limit_response(detail, retry_after_seconds):
    return Response(
        {
            "detail": detail,
            "retry_after_seconds": max(int(retry_after_seconds), 1),
        },
        status=status.HTTP_429_TOO_MANY_REQUESTS,
    )


def _rate_limit_hit(*, scope, subject_key, limit, window_seconds, lock_seconds, now=None):
    now = now or timezone.now()
    with transaction.atomic():
        row, _ = EndpointRateLimit.objects.select_for_update().get_or_create(
            scope=scope,
            subject_key=subject_key,
            defaults={
                "window_started_at": now,
                "attempt_count": 0,
                "locked_until": None,
            },
        )
        if row.locked_until and now < row.locked_until:
            wait_seconds = int((row.locked_until - now).total_seconds())
            return False, max(wait_seconds, 1)

        window_delta = timedelta(seconds=window_seconds)
        if row.window_started_at <= now - window_delta:
            row.window_started_at = now
            row.attempt_count = 0
            row.locked_until = None

        row.attempt_count += 1
        if row.attempt_count > int(limit):
            row.locked_until = now + timedelta(seconds=lock_seconds)
            row.save(update_fields=["window_started_at", "attempt_count", "locked_until", "updated_at"])
            wait_seconds = int((row.locked_until - now).total_seconds())
            return False, max(wait_seconds, 1)

        row.save(update_fields=["window_started_at", "attempt_count", "locked_until", "updated_at"])
        return True, 0


def _rate_limit_reset(*, scope, subject_key):
    EndpointRateLimit.objects.filter(scope=scope, subject_key=subject_key).delete()


def _role_for_user(user):
    if user.is_superuser or user.groups.filter(name="admin").exists():
        return "admin"
    return "student"


def _is_course_live(course, now=None):
    now = now or timezone.now()
    if not course.is_published:
        return False
    if course.publish_at and now < course.publish_at:
        return False
    if course.unpublish_at and now >= course.unpublish_at:
        return False
    return True


def _assert_course_live(course):
    if not _is_course_live(course):
        raise Http404("Course not found.")


def _free_lesson_ids(course, lessons=None):
    ordered = lessons if lessons is not None else _ordered_course_lessons(course)
    return {lesson.id for lesson in ordered[:2]}


def _is_enrolled(user, course):
    if not user.is_authenticated:
        return False
    return Enrollment.objects.filter(
        user=user,
        course=course,
        status=Enrollment.Status.ACTIVE,
    ).exists()


def _can_access_lesson(user, lesson):
    if lesson.id in _free_lesson_ids(lesson.course):
        return True
    if not _is_enrolled(user, lesson.course):
        return False
    unlocked_ids = _unlocked_lesson_ids(user, lesson.course)
    return lesson.id in unlocked_ids


def _ordered_course_lessons(course):
    return list(
        Lesson.objects.filter(course=course)
        .order_by("section_order", "order", "id")
    )


def _effective_completed_lesson_ids(user, course, lessons=None, quiz_map=None):
    lessons = lessons if lessons is not None else _ordered_course_lessons(course)
    quiz_map = quiz_map if quiz_map is not None else get_quiz_map(lessons)
    no_quiz_lesson_ids = {lesson.id for lesson in lessons if lesson.id not in quiz_map}
    lesson_lookup = {lesson.id: lesson for lesson in lessons}

    progress_rows = UserLessonProgress.objects.filter(user=user, lesson__course=course).values(
        "lesson_id",
        "completed",
        "last_position_seconds",
    )
    completed_ids = set()
    for row in progress_rows:
        lesson_id = row["lesson_id"]
        if row["completed"]:
            completed_ids.add(lesson_id)
            continue

        # For video lessons without quiz, allow progression at >= 90% watch progress.
        if lesson_id in no_quiz_lesson_ids:
            lesson = lesson_lookup.get(lesson_id)
            if lesson and lesson.content_type == Lesson.ContentType.VIDEO and lesson.duration_seconds:
                if int(row["last_position_seconds"] or 0) >= int(lesson.duration_seconds * 0.9):
                    completed_ids.add(lesson_id)

    return completed_ids


def _unlocked_lesson_ids(user, course):
    lessons = _ordered_course_lessons(course)
    unlocked = set(_free_lesson_ids(course, lessons))
    if not user.is_authenticated:
        return unlocked

    if not _is_enrolled(user, course):
        return unlocked

    quiz_map = get_quiz_map(lessons)
    completed_ids = _effective_completed_lesson_ids(user, course, lessons=lessons, quiz_map=quiz_map)
    passed_quiz_lesson_ids = set(
        QuizAttempt.objects.filter(
            user=user,
            passed=True,
            lesson__course=course,
        ).values_list("lesson_id", flat=True)
    )
    quiz_lesson_ids = set(quiz_map.keys())

    for idx, lesson in enumerate(lessons):
        if lesson.id in unlocked:
            continue

        if idx == 0:
            unlocked.add(lesson.id)
            continue

        previous_lesson = lessons[idx - 1]
        previous_completed = previous_lesson.id in completed_ids
        if not previous_completed:
            continue

        # If previous lesson has a quiz, that quiz must be passed.
        if previous_lesson.id in quiz_lesson_ids and previous_lesson.id not in passed_quiz_lesson_ids:
            continue

        unlocked.add(lesson.id)

    return unlocked


def _lesson_access_denial_message(user, lesson):
    if lesson.id in _free_lesson_ids(lesson.course):
        return ""
    if not _is_enrolled(user, lesson.course):
        return "Enrollment required for this lesson."
    return "Lesson is locked. Complete previous lesson and pass its quiz to unlock."


def _profile_completion_flags(profile):
    return {
        "has_full_name": bool(profile.full_name.strip()),
        "has_date_of_birth": bool(profile.date_of_birth),
        "has_passport_number": bool(profile.passport_number.strip()),
        "has_passport_photo": bool(profile.passport_photo),
    }


def _is_profile_completed(profile):
    flags = _profile_completion_flags(profile)
    return all(flags.values()) and profile.verification_status == StudentProfile.VerificationStatus.VERIFIED


def _wallet_for_user(user):
    wallet, _ = CreditWallet.objects.get_or_create(user=user, defaults={"balance_credits": 0})
    return wallet


def _course_completion_summary(user, course):
    lessons = _ordered_course_lessons(course)
    if not lessons:
        return {
            "total_lessons": 0,
            "completed_lessons": 0,
            "completion_rate": 0,
            "all_lessons_completed": False,
            "missing_lessons": [],
        }

    quiz_map = get_quiz_map(lessons)
    completed_ids = _effective_completed_lesson_ids(user, course, lessons=lessons, quiz_map=quiz_map)
    passed_quiz_lesson_ids = set(
        QuizAttempt.objects.filter(
            user=user,
            passed=True,
            lesson__course=course,
        ).values_list("lesson_id", flat=True)
    )
    completed_count = 0
    missing = []

    for lesson in lessons:
        has_quiz = lesson.id in quiz_map
        lesson_done = lesson.id in completed_ids and ((not has_quiz) or (lesson.id in passed_quiz_lesson_ids))
        if lesson_done:
            completed_count += 1
            continue
        missing.append(
            {
                "lesson_id": lesson.id,
                "lesson_title": lesson.title,
                "needs_lesson_completion": lesson.id not in completed_ids,
                "needs_quiz_pass": has_quiz and lesson.id not in passed_quiz_lesson_ids,
            }
        )

    rate = round((completed_count / len(lessons)) * 100)
    return {
        "total_lessons": len(lessons),
        "completed_lessons": completed_count,
        "completion_rate": rate,
        "all_lessons_completed": completed_count == len(lessons),
        "missing_lessons": missing,
    }


def _final_exam_unlock_summary(user, course):
    completion = _course_completion_summary(user, course)
    profile, _ = StudentProfile.objects.get_or_create(user=user)
    profile_flags = _profile_completion_flags(profile)
    profile_completed = _is_profile_completed(profile)
    exam = FinalExam.objects.filter(course=course, is_published=True).first()
    exam_exists = exam is not None
    can_take_final_exam = completion["all_lessons_completed"] and exam_exists
    return {
        "completion": completion,
        "profile": profile,
        "profile_flags": profile_flags,
        "profile_completed": profile_completed,
        "exam": exam,
        "exam_exists": exam_exists,
        "can_take_final_exam": can_take_final_exam,
    }


def _active_final_exam_session(user, exam, questions):
    total = len(questions)
    if total == 0:
        return None

    target_size = min(5, total)
    question_lookup = {question.id: question for question in questions}
    session, _ = FinalExamSession.objects.get_or_create(user=user, exam=exam)

    valid_ids = [qid for qid in (session.question_ids or []) if qid in question_lookup]
    if len(valid_ids) != target_size:
        sampled = random.sample([q.id for q in questions], target_size)
        random.shuffle(sampled)
        choice_order_map = {}
        for qid in sampled:
            choices = list(question_lookup[qid].choices.all().order_by("order", "id"))
            choice_ids = [choice.id for choice in choices]
            random.shuffle(choice_ids)
            choice_order_map[str(qid)] = choice_ids
        session.question_ids = sampled
        session.choice_order_map = choice_order_map
        session.save(update_fields=["question_ids", "choice_order_map", "updated_at"])
        return session

    # Rebuild missing/invalid choice order entries when needed.
    choice_order_map = dict(session.choice_order_map or {})
    updated = False
    for qid in valid_ids:
        key = str(qid)
        choice_ids = [choice.id for choice in question_lookup[qid].choices.all().order_by("order", "id")]
        existing = [cid for cid in choice_order_map.get(key, []) if cid in choice_ids]
        if len(existing) != len(choice_ids):
            existing = choice_ids[:]
            random.shuffle(existing)
            choice_order_map[key] = existing
            updated = True
    if updated:
        session.choice_order_map = choice_order_map
        session.save(update_fields=["choice_order_map", "updated_at"])
    return session


def _issue_stream_token(*, user_id, lesson_id, session_id, device_id):
    payload = {
        "uid": user_id,
        "lid": lesson_id,
        "sid": str(session_id),
        "did": device_id,
    }
    return signing.dumps(payload, salt="stream-playback")


def _decode_stream_token(token):
    return signing.loads(
        token,
        max_age=settings.STREAM_TOKEN_TTL_SECONDS,
        salt="stream-playback",
    )


def _build_playback_url(lesson_id):
    return f"/api/stream/hls/{lesson_id}/master.m3u8"


def _issue_quiz_session_token(*, user_id, lesson_id, question_ids, choice_map):
    payload = {
        "uid": int(user_id),
        "lid": int(lesson_id),
        "qids": [int(qid) for qid in question_ids],
        "cm": {str(k): [int(cid) for cid in v] for k, v in choice_map.items()},
    }
    return signing.dumps(payload, salt="lesson-quiz-session")


def _decode_quiz_session_token(token):
    max_age = int(getattr(settings, "QUIZ_SESSION_TOKEN_TTL_SECONDS", 7200))
    return signing.loads(token, max_age=max_age, salt="lesson-quiz-session")


def _lesson_asset_path(lesson, asset_name):
    if not lesson.hls_master_path:
        raise Http404("Lesson has no HLS path configured.")

    master_path = Path(lesson.hls_master_path)
    if master_path.is_absolute():
        lesson_root = master_path.parent.resolve()
    else:
        lesson_root = (settings.BASE_DIR / master_path).resolve().parent

    target = (lesson_root / asset_name).resolve()
    if not str(target).startswith(str(lesson_root)):
        raise SuspiciousFileOperation("Invalid asset path.")
    if not target.exists() or not target.is_file():
        raise Http404("HLS asset not found.")
    return target


def _remove_media_dir(path: Path):
    try:
        media_root = Path(settings.MEDIA_ROOT).resolve()
        target = path.resolve()
        if str(target).startswith(str(media_root)):
            shutil.rmtree(target, ignore_errors=True)
    except Exception:
        # Best-effort cleanup; deleting DB records should still proceed.
        pass


def _cleanup_lesson_media_files(lesson):
    # Primary deterministic folder used by upload pipeline.
    _remove_media_dir(Path(settings.MEDIA_ROOT) / "hls" / f"course_{lesson.course_id}" / f"lesson_{lesson.id}")
    _remove_media_dir(Path(settings.MEDIA_ROOT) / "uploads" / f"course_{lesson.course_id}" / f"lesson_{lesson.id}")

    # Secondary fallback if lesson path points to a different relative location.
    if lesson.hls_master_path:
        master_path = Path(lesson.hls_master_path)
        if master_path.is_absolute():
            _remove_media_dir(master_path.parent)
        else:
            _remove_media_dir((Path(settings.BASE_DIR) / master_path).parent)


def _cleanup_course_media_files(course_id):
    _remove_media_dir(Path(settings.MEDIA_ROOT) / "hls" / f"course_{course_id}")
    _remove_media_dir(Path(settings.MEDIA_ROOT) / "uploads" / f"course_{course_id}")


def _video_job_payload(job):
    return {
        "id": job.id,
        "lesson_id": job.lesson_id,
        "status": job.status,
        "progress_percent": int(job.progress_percent),
        "attempt_count": int(job.attempt_count),
        "max_attempts": int(job.max_attempts),
        "error_message": job.error_message,
        "output_hls_master_path": job.output_hls_master_path,
        "output_duration_seconds": job.output_duration_seconds,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
    }


def _create_certificate_audit_log(*, certificate, action, actor=None, reason="", meta=None):
    return CertificateAuditLog.objects.create(
        certificate=certificate,
        action=action,
        actor=actor,
        reason=(reason or "").strip(),
        meta=meta or {},
    )


def _create_certificate_verification_log(
    *,
    verification_code,
    status,
    request,
    certificate=None,
    detail="",
):
    ip_value = _client_ip(request)[:64] if request else ""
    ua_value = str(request.META.get("HTTP_USER_AGENT", ""))[:255] if request else ""
    return CertificateVerificationLog.objects.create(
        certificate=certificate,
        verification_code=(verification_code or "").strip().upper()[:32],
        status=status,
        ip_address=ip_value,
        user_agent=ua_value,
        detail=(detail or "")[:255],
    )


def _new_certificate_code():
    return uuid.uuid4().hex[:16].upper()


def _active_session_for_token(payload, lesson_id):
    try:
        session = ActiveStreamSession.objects.select_related("lesson").get(
            user_id=payload["uid"],
            session_id=payload["sid"],
        )
    except ActiveStreamSession.DoesNotExist as exc:
        raise PermissionError("Session not found.") from exc

    now = timezone.now()
    if session.status != ActiveStreamSession.Status.ACTIVE:
        raise PermissionError("Session is not active.")
    if session.expires_at <= now:
        raise PermissionError("Session expired.")
    if session.lesson_id != lesson_id:
        raise PermissionError("Lesson mismatch.")
    if session.device_id != payload["did"]:
        raise PermissionError("Device mismatch.")
    return session


@api_view(["POST"])
@permission_classes([AllowAny])
def auth_login(request):
    ip_key = f"ip:{_safe_subject(_client_ip(request))}"
    username_raw = str(request.data.get("username", "")).strip()
    username_key = f"user:{_safe_subject(username_raw)}"

    ok, retry_after = _rate_limit_hit(
        scope="auth_login_ip",
        subject_key=ip_key,
        limit=int(getattr(settings, "AUTH_LOGIN_IP_RATE_LIMIT", 25)),
        window_seconds=int(getattr(settings, "AUTH_LOGIN_IP_RATE_WINDOW_SECONDS", 300)),
        lock_seconds=int(getattr(settings, "AUTH_LOGIN_IP_RATE_LOCK_SECONDS", 900)),
    )
    if not ok:
        return _rate_limit_response("Too many login attempts from this network. Try again later.", retry_after)

    ok, retry_after = _rate_limit_hit(
        scope="auth_login_user",
        subject_key=username_key,
        limit=int(getattr(settings, "AUTH_LOGIN_USER_RATE_LIMIT", 8)),
        window_seconds=int(getattr(settings, "AUTH_LOGIN_USER_RATE_WINDOW_SECONDS", 300)),
        lock_seconds=int(getattr(settings, "AUTH_LOGIN_USER_RATE_LOCK_SECONDS", 900)),
    )
    if not ok:
        return _rate_limit_response("Too many login attempts for this account. Try again later.", retry_after)

    serializer = TokenObtainPairSerializer(data=request.data)
    if not serializer.is_valid():
        return Response({"detail": "Username or password is incorrect."}, status=status.HTTP_401_UNAUTHORIZED)

    _rate_limit_reset(scope="auth_login_user", subject_key=username_key)
    data = serializer.validated_data
    return Response({"refresh": data["refresh"], "access": data["access"]}, status=status.HTTP_200_OK)


@api_view(["POST"])
@permission_classes([AllowAny])
def register(request):
    ip_key = f"ip:{_safe_subject(_client_ip(request))}"
    ok, retry_after = _rate_limit_hit(
        scope="auth_register_ip",
        subject_key=ip_key,
        limit=int(getattr(settings, "AUTH_REGISTER_IP_RATE_LIMIT", 10)),
        window_seconds=int(getattr(settings, "AUTH_REGISTER_IP_RATE_WINDOW_SECONDS", 3600)),
        lock_seconds=int(getattr(settings, "AUTH_REGISTER_IP_RATE_LOCK_SECONDS", 3600)),
    )
    if not ok:
        return _rate_limit_response("Too many registration attempts. Try again later.", retry_after)

    serializer = RegisterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    user_model = get_user_model()
    user = user_model.objects.create_user(
        username=serializer.validated_data["username"],
        email=serializer.validated_data.get("email", ""),
        password=serializer.validated_data["password"],
    )

    # Ensure a default student role path exists for local MVP.
    Group.objects.get_or_create(name="student")
    user.groups.add(Group.objects.get(name="student"))

    return Response(
        {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "role": _role_for_user(user),
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(["GET"])
@permission_classes([AllowAny])
def username_available(request):
    username = str(request.query_params.get("username", "")).strip()
    if not username:
        return Response({"available": False, "detail": "Username is required."}, status=status.HTTP_400_BAD_REQUEST)
    if len(username) < 3:
        return Response(
            {"available": False, "detail": "Username must be at least 3 characters."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user_model = get_user_model()
    exists = user_model.objects.filter(username=username).exists()
    return Response(
        {
            "available": not exists,
            "detail": "Username is available." if not exists else "Username is already taken.",
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    user = request.user
    profile, _ = StudentProfile.objects.get_or_create(user=user)
    wallet = _wallet_for_user(user)
    profile_flags = _profile_completion_flags(profile)
    return Response(
        {
            "id": user.id,
            "username": user.username,
            "full_name": profile.full_name,
            "email": user.email,
            "is_staff": user.is_staff,
            "is_superuser": user.is_superuser,
            "groups": list(user.groups.values_list("name", flat=True)),
            "role": _role_for_user(user),
            "profile_completed": _is_profile_completed(profile),
            "credits": wallet.balance_credits,
        }
    )


@api_view(["GET", "PUT", "PATCH"])
@permission_classes([IsAuthenticated])
def my_profile(request):
    profile, _ = StudentProfile.objects.get_or_create(user=request.user)
    wallet = _wallet_for_user(request.user)
    if request.method == "GET":
        serializer = StudentProfileSerializer(profile, context={"request": request})
        payload = serializer.data
        payload["credits"] = wallet.balance_credits
        payload["completion_flags"] = _profile_completion_flags(profile)
        payload["profile_completed"] = _is_profile_completed(profile)
        return Response(payload)

    serializer = StudentProfileSerializer(
        profile,
        data=request.data,
        partial=request.method == "PATCH",
        context={"request": request},
    )
    serializer.is_valid(raise_exception=True)
    serializer.save()

    # Any student update to identity/passport details returns profile to pending review.
    if request.method in ("PUT", "PATCH"):
        updated_identity_fields = {
            "full_name",
            "date_of_birth",
            "passport_number",
            "passport_photo",
        }
        has_identity_update = any(field in serializer.validated_data for field in updated_identity_fields)
        if has_identity_update:
            profile.verification_status = StudentProfile.VerificationStatus.PENDING
            profile.verification_note = ""
            profile.save(update_fields=["verification_status", "verification_note", "updated_at"])

    payload = serializer.data
    payload["credits"] = wallet.balance_credits
    payload["completion_flags"] = _profile_completion_flags(profile)
    payload["profile_completed"] = _is_profile_completed(profile)
    return Response(payload)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def logout(request):
    serializer = LogoutSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    # Stateless JWT logout: client should discard access/refresh tokens.
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
@permission_classes([AllowAny])
def course_list(_request):
    courses = [course for course in Course.objects.all().order_by("id") if _is_course_live(course)]
    return Response(CourseListSerializer(courses, many=True).data)


@api_view(["GET"])
@permission_classes([AllowAny])
def course_detail(request, course_slug):
    course = get_object_or_404(
        Course.objects.prefetch_related("lessons"),
        slug=course_slug,
    )
    _assert_course_live(course)
    is_enrolled = _is_enrolled(request.user, course)
    unlocked_ids = _unlocked_lesson_ids(request.user, course)
    free_ids = _free_lesson_ids(course)
    quiz_status_by_lesson = {}
    if request.user.is_authenticated and is_enrolled:
        attempts = QuizAttempt.objects.filter(user=request.user, lesson__course=course).values("lesson_id", "passed")
        for row in attempts:
            lesson_id = row["lesson_id"]
            if row["passed"]:
                quiz_status_by_lesson[lesson_id] = "PASSED"
            elif quiz_status_by_lesson.get(lesson_id) != "PASSED":
                quiz_status_by_lesson[lesson_id] = "FAILED"
    serializer = CourseDetailSerializer(
        course,
        context={
            "is_enrolled": is_enrolled,
            "unlocked_lesson_ids": unlocked_ids,
            "free_lesson_ids": free_ids,
            "quiz_status_by_lesson": quiz_status_by_lesson,
        },
    )
    payload = serializer.data
    payload["enrolled"] = is_enrolled
    return Response(payload)


@api_view(["GET"])
@permission_classes([AllowAny])
def course_lessons(request, course_id):
    course = get_object_or_404(Course, id=course_id)
    _assert_course_live(course)
    is_enrolled = _is_enrolled(request.user, course)
    unlocked_ids = _unlocked_lesson_ids(request.user, course)
    free_ids = _free_lesson_ids(course)
    lessons = Lesson.objects.filter(course=course).order_by("section_order", "order", "id")
    serializer = LessonAccessSerializer(
        lessons,
        many=True,
        context={"is_enrolled": is_enrolled, "unlocked_lesson_ids": unlocked_ids, "free_lesson_ids": free_ids},
    )
    return Response(
        {
            "course_id": course.id,
            "enrolled": is_enrolled,
            "lessons": serializer.data,
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def enroll_course(request, course_id):
    course = get_object_or_404(Course, id=course_id)
    _assert_course_live(course)
    with transaction.atomic():
        wallet, _ = CreditWallet.objects.get_or_create(user=request.user, defaults={"balance_credits": 0})
        wallet = CreditWallet.objects.select_for_update().get(id=wallet.id)
        enrollment = Enrollment.objects.filter(user=request.user, course=course).first()
        charged = False
        tx = None

        if enrollment is None:
            price = int(course.price_cents or 0)
            if price > 0:
                if wallet.balance_credits < price:
                    return Response(
                        {
                            "detail": "Insufficient credits to enroll.",
                            "required_credits": price,
                            "current_credits": wallet.balance_credits,
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                wallet.balance_credits -= price
                wallet.save(update_fields=["balance_credits", "updated_at"])
                tx = CreditTransaction.objects.create(
                    user=request.user,
                    amount=-price,
                    balance_after=wallet.balance_credits,
                    kind=CreditTransaction.Kind.COURSE_PURCHASE,
                    note=f"Enrollment purchase: {course.title}",
                    course=course,
                    created_by=request.user,
                )
                charged = True

            enrollment = Enrollment.objects.create(
                user=request.user,
                course=course,
                status=Enrollment.Status.ACTIVE,
                payment_provider="CREDITS" if charged else "",
                payment_ref=str(tx.id) if tx else "",
            )
            created = True
        else:
            created = False
            if enrollment.status != Enrollment.Status.ACTIVE:
                enrollment.status = Enrollment.Status.ACTIVE
                enrollment.save(update_fields=["status", "updated_at"])

    return Response(
        {
            "enrolled": True,
            "created": created,
            "charged_credits": int(course.price_cents or 0) if created else 0,
            "current_credits": _wallet_for_user(request.user).balance_credits,
            "enrollment": EnrollmentSerializer(enrollment).data,
        },
        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_enrollments(request):
    enrollments = Enrollment.objects.filter(user=request.user).select_related("course").order_by("-enrolled_at")
    return Response(EnrollmentSerializer(enrollments, many=True).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_wallet(request):
    wallet = _wallet_for_user(request.user)
    txs = CreditTransaction.objects.filter(user=request.user).select_related("course", "created_by").order_by("-created_at")[:30]
    return Response(
        {
            "wallet": CreditWalletSerializer(wallet).data,
            "transactions": CreditTransactionSerializer(txs, many=True).data,
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def course_exam_eligibility(request, course_id):
    course = get_object_or_404(Course, id=course_id)
    _assert_course_live(course)
    if not _is_enrolled(request.user, course):
        return Response({"detail": "Enrollment required."}, status=status.HTTP_403_FORBIDDEN)

    summary = _final_exam_unlock_summary(request.user, course)
    completion = summary["completion"]
    profile_flags = summary["profile_flags"]
    profile_completed = summary["profile_completed"]
    can_take_final_exam = summary["can_take_final_exam"]
    exam_exists = summary["exam_exists"]
    latest_attempt = None
    if summary["exam"] is not None:
        latest_attempt = (
            FinalExamAttempt.objects.filter(user=request.user, exam=summary["exam"])
            .order_by("-attempted_at")
            .first()
        )

    return Response(
        {
            "course_id": course.id,
            "course_title": course.title,
            "final_exam_exists": exam_exists,
            "can_take_final_exam": can_take_final_exam,
            "certificate_ready": can_take_final_exam and profile_completed,
            "profile_completed": profile_completed,
            "profile_completion_flags": profile_flags,
            "progress": completion,
            "final_exam_result": (
                {
                    "attempted": True,
                    "passed": bool(latest_attempt.passed),
                    "score": str(latest_attempt.score),
                }
                if latest_attempt
                else {"attempted": False, "passed": False, "score": None}
            ),
            "next_step": (
                "Take final exam."
                if can_take_final_exam
                else ("Final exam is not configured yet." if not exam_exists else "Complete all lessons and pass each lesson quiz first.")
            ),
        }
    )


@api_view(["GET", "PUT"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_course_final_exam(request, course_id):
    course = get_object_or_404(Course, id=course_id)
    exam = FinalExam.objects.filter(course=course).first()

    if request.method == "GET":
        if exam is None:
            return Response(
                {
                    "exists": False,
                    "course_id": course.id,
                    "title": "Final Exam",
                    "passing_score": 70,
                    "time_limit_sec": None,
                    "is_published": False,
                    "questions": [],
                },
                status=status.HTTP_200_OK,
            )
        exam = FinalExam.objects.prefetch_related("questions__choices").get(id=exam.id)
        payload = FinalExamSerializer(exam, context={"include_answers": True}).data
        payload["exists"] = True
        return Response(payload)

    serializer = AdminFinalExamUpsertSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    with transaction.atomic():
        if exam is None:
            exam = FinalExam.objects.create(
                course=course,
                title=data.get("title", "Final Exam"),
                passing_score=data.get("passing_score", 70),
                time_limit_sec=data.get("time_limit_sec"),
                is_published=data.get("is_published", False),
            )
        else:
            exam.title = data.get("title", exam.title)
            exam.passing_score = data.get("passing_score", exam.passing_score)
            exam.time_limit_sec = data.get("time_limit_sec")
            exam.is_published = data.get("is_published", exam.is_published)
            exam.save(update_fields=["title", "passing_score", "time_limit_sec", "is_published", "updated_at"])
            exam.questions.all().delete()

        question_rows = []
        choice_rows = []
        for question_data in sorted(data["questions"], key=lambda row: row["order"]):
            question = FinalExamQuestion.objects.create(
                exam=exam,
                prompt=question_data["prompt"],
                order=question_data["order"],
            )
            question_rows.append(question)
            for choice_data in sorted(question_data["choices"], key=lambda row: row["order"]):
                choice_rows.append(
                    FinalExamChoice(
                        question=question,
                        text=choice_data["text"],
                        is_correct=choice_data.get("is_correct", False),
                        order=choice_data["order"],
                    )
                )
        if choice_rows:
            FinalExamChoice.objects.bulk_create(choice_rows)

    exam = FinalExam.objects.prefetch_related("questions__choices").get(id=exam.id)
    return Response(FinalExamSerializer(exam, context={"include_answers": True}).data, status=status.HTTP_200_OK)


@api_view(["PATCH"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_course_final_exam_publish(request, course_id):
    exam = get_object_or_404(FinalExam, course_id=course_id)
    serializer = serializers.Serializer(data=request.data)
    serializer.fields["is_published"] = serializers.BooleanField(required=True)
    serializer.is_valid(raise_exception=True)
    exam.is_published = serializer.validated_data["is_published"]
    exam.save(update_fields=["is_published", "updated_at"])
    exam = FinalExam.objects.prefetch_related("questions__choices").get(id=exam.id)
    return Response(FinalExamSerializer(exam, context={"include_answers": True}).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_course_final_exam_reset(request, course_id):
    exam = get_object_or_404(FinalExam, course_id=course_id)
    with transaction.atomic():
        exam.questions.all().delete()
        exam.is_published = False
        exam.save(update_fields=["is_published", "updated_at"])
    exam = FinalExam.objects.prefetch_related("questions__choices").get(id=exam.id)
    return Response(
        {
            "detail": "Final exam reset. All questions removed and exam unpublished.",
            "exam": FinalExamSerializer(exam, context={"include_answers": True}).data,
        }
    )


@api_view(["DELETE"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_final_exam_question_detail(request, question_id):
    question = get_object_or_404(FinalExamQuestion.objects.select_related("exam"), id=question_id)
    exam = question.exam
    question.delete()
    remaining = list(exam.questions.all().order_by("order", "id"))
    for idx, row in enumerate(remaining, start=1):
        if row.order != idx:
            row.order = idx
            row.save(update_fields=["order", "updated_at"])
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def course_final_exam(request, course_id):
    course = get_object_or_404(Course, id=course_id)
    _assert_course_live(course)
    if not _is_enrolled(request.user, course):
        return Response({"detail": "Enrollment required."}, status=status.HTTP_403_FORBIDDEN)

    summary = _final_exam_unlock_summary(request.user, course)
    exam = summary["exam"]
    if exam is None:
        return Response({"detail": "Final exam is not available for this course."}, status=status.HTTP_404_NOT_FOUND)
    if not summary["can_take_final_exam"]:
        return Response(
            {"detail": "Final exam is locked. Complete all lessons and lesson quizzes first."},
            status=status.HTTP_403_FORBIDDEN,
        )

    exam = FinalExam.objects.prefetch_related("questions__choices").get(id=exam.id)
    questions = list(exam.questions.all().order_by("order", "id"))
    session = _active_final_exam_session(request.user, exam, questions)
    if session is None:
        return Response({"detail": "Final exam question bank is empty."}, status=status.HTTP_400_BAD_REQUEST)
    retry_fee_credits = int(getattr(settings, "FINAL_EXAM_RETRY_FEE_CREDITS", 50))
    failed_attempts = FinalExamAttempt.objects.filter(user=request.user, exam=exam, passed=False).count()
    retry_fee_required = failed_attempts >= 3
    wallet = _wallet_for_user(request.user)
    if retry_fee_required and wallet.balance_credits < retry_fee_credits:
        return Response(
            {
                "detail": "Insufficient credits for final exam retry fee.",
                "required_credits": retry_fee_credits,
                "current_credits": wallet.balance_credits,
                "failed_attempts": failed_attempts,
                "retry_fee_required": True,
                "retry_fee_locked": True,
            },
            status=status.HTTP_402_PAYMENT_REQUIRED,
        )

    question_lookup = {question.id: question for question in questions}
    payload_questions = []
    for qid in session.question_ids:
        question = question_lookup.get(qid)
        if question is None:
            continue
        ordered_choice_ids = session.choice_order_map.get(str(qid), [])
        choices_lookup = {choice.id: choice for choice in question.choices.all()}
        ordered_choices = []
        for choice_id in ordered_choice_ids:
            choice = choices_lookup.get(choice_id)
            if choice is None:
                continue
            ordered_choices.append({"id": choice.id, "text": choice.text, "order": len(ordered_choices) + 1})
        if not ordered_choices:
            for choice in question.choices.all().order_by("order", "id"):
                ordered_choices.append({"id": choice.id, "text": choice.text, "order": len(ordered_choices) + 1})
        payload_questions.append(
            {
                "id": question.id,
                "prompt": question.prompt,
                "order": len(payload_questions) + 1,
                "choices": ordered_choices,
            }
        )

    return Response(
        {
            "id": exam.id,
            "course_id": exam.course_id,
            "title": exam.title,
            "passing_score": exam.passing_score,
            "time_limit_sec": exam.time_limit_sec,
            "is_published": exam.is_published,
            "questions": payload_questions,
            "retry_fee_credits": retry_fee_credits,
            "retry_fee_required": retry_fee_required,
            "failed_attempts": failed_attempts,
            "current_credits": wallet.balance_credits,
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def submit_course_final_exam(request, course_id):
    user_key = f"user:{request.user.id}:course:{course_id}"
    ok, retry_after = _rate_limit_hit(
        scope="exam_submit",
        subject_key=user_key,
        limit=int(getattr(settings, "EXAM_SUBMIT_RATE_LIMIT", 30)),
        window_seconds=int(getattr(settings, "EXAM_SUBMIT_RATE_WINDOW_SECONDS", 600)),
        lock_seconds=int(getattr(settings, "EXAM_SUBMIT_RATE_LOCK_SECONDS", 1800)),
    )
    if not ok:
        return _rate_limit_response("Final exam is temporarily locked due to too many submissions.", retry_after)

    course = get_object_or_404(Course, id=course_id)
    _assert_course_live(course)
    if not _is_enrolled(request.user, course):
        return Response({"detail": "Enrollment required."}, status=status.HTTP_403_FORBIDDEN)

    summary = _final_exam_unlock_summary(request.user, course)
    exam = summary["exam"]
    if exam is None:
        return Response({"detail": "Final exam is not available for this course."}, status=status.HTTP_404_NOT_FOUND)
    if not summary["can_take_final_exam"]:
        return Response(
            {"detail": "Final exam is locked. Complete all lessons and lesson quizzes first."},
            status=status.HTTP_403_FORBIDDEN,
        )

    serializer = FinalExamSubmitSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    submitted_answers = serializer.validated_data["answers"]

    exam = FinalExam.objects.prefetch_related("questions__choices").get(id=exam.id)
    all_questions = list(exam.questions.all().order_by("order", "id"))
    if not all_questions:
        return Response({"detail": "Final exam question bank is empty."}, status=status.HTTP_400_BAD_REQUEST)
    session = _active_final_exam_session(request.user, exam, all_questions)
    if session is None or not session.question_ids:
        return Response({"detail": "Final exam question set is unavailable."}, status=status.HTTP_400_BAD_REQUEST)
    question_lookup = {question.id: question for question in all_questions if question.id in set(session.question_ids)}
    questions = [question_lookup[qid] for qid in session.question_ids if qid in question_lookup]

    question_map = {question.id: question for question in questions}
    seen_questions = set()
    normalized_answers = []
    correct_count = 0

    for item in submitted_answers:
        qid = int(item["question_id"])
        cid = int(item["choice_id"])
        if qid in seen_questions:
            return Response({"detail": f"Duplicate answer for question {qid}."}, status=status.HTTP_400_BAD_REQUEST)
        seen_questions.add(qid)
        question = question_map.get(qid)
        if question is None:
            return Response({"detail": f"Question {qid} is not part of this exam."}, status=status.HTTP_400_BAD_REQUEST)
        choice = next((c for c in question.choices.all() if c.id == cid), None)
        if choice is None:
            return Response({"detail": f"Choice {cid} is invalid for question {qid}."}, status=status.HTTP_400_BAD_REQUEST)
        if choice.is_correct:
            correct_count += 1
        normalized_answers.append({"question_id": qid, "choice_id": cid})

    score = round((correct_count / len(questions)) * 100, 2)
    passed = score >= float(exam.passing_score)

    retry_fee_credits = int(getattr(settings, "FINAL_EXAM_RETRY_FEE_CREDITS", 50))
    charged_credits = 0

    with transaction.atomic():
        # Lock wallet row first to serialize credit-sensitive submit attempts per user.
        wallet, _ = CreditWallet.objects.get_or_create(user=request.user, defaults={"balance_credits": 0})
        wallet = CreditWallet.objects.select_for_update().get(id=wallet.id)
        failed_attempts = FinalExamAttempt.objects.filter(user=request.user, exam=exam, passed=False).count()
        if failed_attempts >= 3:
            if wallet.balance_credits < retry_fee_credits:
                return Response(
                    {
                        "detail": "Insufficient credits for final exam retry fee.",
                        "required_credits": retry_fee_credits,
                        "current_credits": wallet.balance_credits,
                        "failed_attempts": failed_attempts,
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            wallet.balance_credits -= retry_fee_credits
            wallet.save(update_fields=["balance_credits", "updated_at"])
            CreditTransaction.objects.create(
                user=request.user,
                amount=-retry_fee_credits,
                balance_after=wallet.balance_credits,
                kind=CreditTransaction.Kind.COURSE_PURCHASE,
                note=f"Final exam retry fee: {course.title}",
                course=course,
                created_by=request.user,
            )
            charged_credits = retry_fee_credits

        attempt = FinalExamAttempt.objects.create(
            user=request.user,
            exam=exam,
            score=score,
            passed=passed,
            answers_payload=normalized_answers,
        )
        FinalExamSession.objects.filter(user=request.user, exam=exam).delete()
        certificate = None
        certificate_created = False
        if passed:
            certificate, certificate_created = Certificate.objects.get_or_create(
                user=request.user,
                course=course,
                defaults={
                    "exam_attempt": attempt,
                    "certificate_code": _new_certificate_code(),
                },
            )
            if not certificate_created and certificate.exam_attempt_id is None:
                certificate.exam_attempt = attempt
                certificate.save(update_fields=["exam_attempt", "updated_at"])
            ensure_certificate_signature(certificate)
            if certificate_created:
                _create_certificate_audit_log(
                    certificate=certificate,
                    action=CertificateAuditLog.Action.ISSUED,
                    actor=request.user,
                    reason="Final exam passed.",
                    meta={"course_id": course.id, "exam_attempt_id": attempt.id},
                )

    payload = FinalExamAttemptSerializer(attempt).data
    payload["summary"] = {
        "total_questions": len(questions),
        "correct_answers": correct_count,
        "passing_score": int(exam.passing_score),
    }
    payload["certificate_issued"] = bool(passed)
    payload["certificate_created"] = bool(certificate_created) if passed else False
    payload["certificate"] = (
        CertificateSerializer(certificate, context={"request": request}).data if passed and certificate else None
    )
    payload["charged_credits"] = charged_credits
    return Response(payload, status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def course_final_exam_attempts(request, course_id):
    course = get_object_or_404(Course, id=course_id)
    _assert_course_live(course)
    if not _is_enrolled(request.user, course):
        return Response({"detail": "Enrollment required."}, status=status.HTTP_403_FORBIDDEN)
    exam = FinalExam.objects.filter(course=course, is_published=True).first()
    if exam is None:
        return Response([], status=status.HTTP_200_OK)
    attempts = FinalExamAttempt.objects.filter(user=request.user, exam=exam).order_by("-attempted_at")
    return Response(FinalExamAttemptSerializer(attempts, many=True).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_course_certificate(request, course_id):
    course = get_object_or_404(Course, id=course_id)
    _assert_course_live(course)
    if not _is_enrolled(request.user, course):
        return Response({"detail": "Enrollment required."}, status=status.HTTP_403_FORBIDDEN)
    certificate = Certificate.objects.filter(user=request.user, course=course).select_related("exam_attempt").first()
    if certificate is None:
        return Response({"issued": False, "detail": "Certificate not issued yet."}, status=status.HTTP_404_NOT_FOUND)
    ensure_certificate_signature(certificate)
    return Response(
        {
            "issued": True,
            "certificate": CertificateSerializer(certificate, context={"request": request}).data,
        }
    )


@api_view(["GET"])
@permission_classes([AllowAny])
def public_verify_certificate(request, verification_code):
    code = str(verification_code or "").strip().upper()
    ip_key = f"ip:{_safe_subject(_client_ip(request))}"
    ok, retry_after = _rate_limit_hit(
        scope="certificate_verify_ip",
        subject_key=ip_key,
        limit=int(getattr(settings, "CERT_VERIFY_RATE_LIMIT", 120)),
        window_seconds=int(getattr(settings, "CERT_VERIFY_RATE_WINDOW_SECONDS", 300)),
        lock_seconds=int(getattr(settings, "CERT_VERIFY_RATE_LOCK_SECONDS", 300)),
    )
    if not ok:
        _create_certificate_verification_log(
            verification_code=code,
            status=CertificateVerificationLog.Status.RATE_LIMITED,
            request=request,
            detail="Too many verification requests from this IP.",
        )
        return _rate_limit_response("Too many verification requests. Try again later.", retry_after)

    certificate = (
        Certificate.objects.select_related("user", "course", "user__student_profile")
        .filter(verification_code=code)
        .first()
    )
    if certificate is None:
        _create_certificate_verification_log(
            verification_code=code,
            status=CertificateVerificationLog.Status.NOT_FOUND,
            request=request,
            detail="Verification code not found.",
        )
        return Response(
            {"valid": False, "status": "not_found", "detail": "Certificate not found."},
            status=status.HTTP_404_NOT_FOUND,
        )

    ensure_certificate_signature(certificate)
    signature_valid, signature_state = validate_certificate_signature(certificate)

    status_label = "valid"
    detail = "Certificate is valid."
    if certificate.revoked_at:
        status_label = "revoked"
        detail = "Certificate has been revoked."
    elif not signature_valid:
        status_label = "invalid_signature"
        detail = "Certificate signature check failed."

    student_name = ""
    profile = getattr(certificate.user, "student_profile", None)
    if profile and profile.full_name:
        student_name = profile.full_name.strip()
    if not student_name:
        student_name = certificate.user.get_full_name().strip() or certificate.user.username

    log_status = CertificateVerificationLog.Status.VALID
    if status_label == "revoked":
        log_status = CertificateVerificationLog.Status.REVOKED
    elif status_label == "invalid_signature":
        log_status = CertificateVerificationLog.Status.INVALID_SIGNATURE
    _create_certificate_verification_log(
        verification_code=code,
        status=log_status,
        request=request,
        certificate=certificate,
        detail=detail,
    )

    return Response(
        {
            "valid": bool(status_label == "valid"),
            "status": status_label,
            "detail": detail,
            "certificate": {
                "certificate_code": certificate.certificate_code,
                "verification_code": certificate.verification_code,
                "student_name": student_name,
                "course_title": certificate.course.title,
                "issued_at": certificate.issued_at,
                "revoked_at": certificate.revoked_at,
                "revoked_reason": certificate.revoked_reason,
                "signature_version": certificate.signature_version,
                "signed_payload": certificate.signed_payload,
                "signature_state": signature_state,
            },
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_certificate_verification_logs(request):
    logs = CertificateVerificationLog.objects.select_related(
        "certificate",
        "certificate__course",
        "certificate__user",
    ).order_by("-created_at", "-id")
    code = str(request.query_params.get("verification_code", "")).strip().upper()
    status_filter = str(request.query_params.get("status", "")).strip().upper()
    user_id = str(request.query_params.get("user_id", "")).strip()
    if code:
        logs = logs.filter(verification_code=code)
    if status_filter:
        logs = logs.filter(status=status_filter)
    if user_id.isdigit():
        logs = logs.filter(certificate__user_id=int(user_id))
    logs = logs[:300]
    return Response(CertificateVerificationLogSerializer(logs, many=True).data)


@api_view(["GET"])
@permission_classes([AllowAny])
def course_access(request, course_id):
    course = get_object_or_404(Course, id=course_id)
    _assert_course_live(course)
    return Response({"course_id": course.id, "enrolled": _is_enrolled(request.user, course)})


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_courses(request):
    if request.method == "GET":
        courses = Course.objects.all().order_by("id")
        enrollment_map = {item["course_id"]: item["count"] for item in Enrollment.objects.values("course_id").annotate(count=Count("id"))}
        payload = CourseListSerializer(courses, many=True).data
        for row in payload:
            row["enrollment_count"] = enrollment_map.get(row["id"], 0)
        return Response(payload)

    serializer = AdminCourseCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    course = serializer.save()
    return Response(CourseListSerializer(course).data, status=status.HTTP_201_CREATED)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_lessons(request):
    if request.method == "GET":
        course_id = request.query_params.get("course_id")
        lessons = Lesson.objects.select_related("course").all().order_by("course_id", "section_order", "order", "id")
        if course_id:
            lessons = lessons.filter(course_id=course_id)
        payload = [
            {
                "id": lesson.id,
                "course_id": lesson.course_id,
                "course_title": lesson.course.title,
                "section_id": lesson.section_order,
                "section_title": lesson.section_title,
                "title": lesson.title,
                "order": lesson.order,
                "content_type": lesson.content_type,
                "is_preview": lesson.is_preview,
                "hls_master_path": lesson.hls_master_path,
                "reading_content": lesson.reading_content,
                "duration_seconds": lesson.duration_seconds,
            }
            for lesson in lessons
        ]
        return Response(payload)

    serializer = AdminLessonCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    course = get_object_or_404(Course, id=data["course_id"])
    if data.get("section_id"):
        existing = (
            Lesson.objects.filter(course=course, section_order=data["section_id"])
            .order_by("id")
            .first()
        )
        if existing is None:
            return Response({"detail": "Section not found."}, status=status.HTTP_404_NOT_FOUND)
        section_order = existing.section_order
        section_title = existing.section_title
    else:
        section_order = data["section_order"]
        section_title = data["section_title"]

    lesson = Lesson.objects.create(
        course=course,
        section_title=section_title,
        section_order=section_order,
        title=data["title"],
        order=data["order"],
        content_type=data.get("content_type", Lesson.ContentType.VIDEO),
        is_preview=False,
        hls_master_path=data.get("hls_master_path", ""),
        reading_content=data.get("reading_content", ""),
        duration_seconds=data.get("duration_seconds"),
    )
    return Response(LessonDetailSerializer(lesson).data, status=status.HTTP_201_CREATED)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_quizzes(request):
    if request.method == "GET":
        lessons = list(Lesson.objects.select_related("course").order_by("id"))
        quiz_map = get_quiz_map(lessons)
        payload = []
        for lesson in lessons:
            quiz = quiz_map.get(lesson.id)
            if not quiz:
                continue
            payload.append(
                {
                    "id": lesson.id,
                    "lesson_id": lesson.id,
                    "lesson_title": lesson.title,
                    "course_id": lesson.course_id,
                    "course_title": lesson.course.title,
                    "passing_score": quiz.get("passing_score", 70),
                    "time_limit_sec": quiz.get("time_limit_sec"),
                    "questions_count": len(quiz.get("questions", [])),
                }
            )
        return Response(payload)

    serializer = AdminQuizCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    lesson = get_object_or_404(Lesson, id=data["lesson_id"])
    existing = get_quiz_payload(lesson)
    if existing.get("questions"):
        return Response({"detail": "Quiz already exists for this lesson."}, status=status.HTTP_400_BAD_REQUEST)

    question_id_seq = 1
    choice_id_seq = 1
    questions = []
    for question_item in data["questions"]:
        choices = []
        for choice in question_item["choices"]:
            choices.append(
                {
                    "id": choice_id_seq,
                    "text": choice["text"],
                    "is_correct": bool(choice.get("is_correct", False)),
                }
            )
            choice_id_seq += 1
        questions.append(
            {
                "id": question_id_seq,
                "prompt": question_item["prompt"],
                "type": question_item.get("type", "MCQ"),
                "order": question_item["order"],
                "choices": choices,
            }
        )
        question_id_seq += 1

    payload = {
        "passing_score": data.get("passing_score", 70),
        "time_limit_sec": data.get("time_limit_sec"),
        "questions": questions,
    }
    set_quiz_payload(lesson, payload)

    return Response(
        {
            "id": lesson.id,
            "lesson_id": lesson.id,
            "passing_score": payload["passing_score"],
            "time_limit_sec": payload.get("time_limit_sec"),
            "questions": [
                {
                    "id": q["id"],
                    "prompt": q["prompt"],
                    "type": q["type"],
                    "order": q["order"],
                    "choices": [{"id": c["id"], "text": c["text"]} for c in q.get("choices", [])],
                }
                for q in payload.get("questions", [])
            ],
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_upload_hls_metadata(request):
    serializer = AdminUploadHlsMetadataSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    lesson = get_object_or_404(Lesson, id=data["lesson_id"])
    lesson.hls_master_path = data["hls_master_path"]
    lesson.duration_seconds = data.get("duration_seconds")
    lesson.save(update_fields=["hls_master_path", "duration_seconds", "updated_at"])
    return Response(LessonDetailSerializer(lesson).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_upload_video(request):
    serializer = AdminUploadVideoSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    data = serializer.validated_data
    lesson = get_object_or_404(Lesson.objects.select_related("course"), id=data["lesson_id"])
    video_file = data["video"]
    upload_dir = Path(settings.MEDIA_ROOT) / "uploads" / f"course_{lesson.course_id}" / f"lesson_{lesson.id}"
    upload_dir.mkdir(parents=True, exist_ok=True)
    safe_name = f"{uuid.uuid4().hex}_{Path(video_file.name).name}"
    source_path = upload_dir / safe_name
    with source_path.open("wb") as f:
        for chunk in video_file.chunks():
            f.write(chunk)

    job = VideoTranscodeJob.objects.create(
        lesson=lesson,
        uploaded_by=request.user,
        source_file=str(source_path),
        status=VideoTranscodeJob.Status.QUEUED,
        progress_percent=5,
        max_attempts=int(getattr(settings, "VIDEO_TRANSCODE_MAX_ATTEMPTS", 3)),
    )

    try:
        from core.tasks import process_video_transcode_job

        async_result = process_video_transcode_job.delay(job.id)
        job.task_id = async_result.id or ""
        job.save(update_fields=["task_id", "updated_at"])
    except Exception as exc:
        job.status = VideoTranscodeJob.Status.FAILED
        job.error_message = f"Queue dispatch failed: {str(exc)[:800]}"
        job.progress_percent = 0
        job.finished_at = timezone.now()
        job.save(update_fields=["status", "error_message", "progress_percent", "finished_at", "updated_at"])
        return Response(
            {
                "detail": "Failed to queue transcoding job.",
                "job": _video_job_payload(job),
            },
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    return Response(
        {
            "detail": "Video received. Transcoding queued.",
            "job": _video_job_payload(job),
        },
        status=status.HTTP_202_ACCEPTED,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_upload_job_detail(request, job_id):
    job = get_object_or_404(VideoTranscodeJob.objects.select_related("lesson"), id=job_id)
    return Response(_video_job_payload(job))


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_sections(request):
    course_id = request.query_params.get("course_id")
    lessons = Lesson.objects.all().order_by("course_id", "section_order", "id")
    if course_id:
        lessons = lessons.filter(course_id=course_id)

    seen = set()
    payload = []
    for lesson in lessons:
        key = (lesson.course_id, lesson.section_order)
        if key in seen:
            continue
        seen.add(key)
        payload.append(
            {
                "id": lesson.section_order,
                "course_id": lesson.course_id,
                "title": lesson.section_title,
                "order": lesson.section_order,
            }
        )
    return Response(AdminSectionSerializer(payload, many=True).data)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_course_detail(request, course_id):
    course = get_object_or_404(Course, id=course_id)

    if request.method == "DELETE":
        lessons = list(Lesson.objects.filter(course=course).only("id", "course_id", "hls_master_path"))
        for lesson in lessons:
            delete_quiz_payload(lesson)
            _cleanup_lesson_media_files(lesson)
        _cleanup_course_media_files(course.id)
        course.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    serializer = AdminCourseUpdateSerializer(course, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(CourseListSerializer(course).data)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_lesson_detail(request, lesson_id):
    lesson = get_object_or_404(Lesson, id=lesson_id)

    if request.method == "DELETE":
        delete_quiz_payload(lesson)
        _cleanup_lesson_media_files(lesson)
        lesson.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    serializer = AdminLessonUpdateSerializer(lesson, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(LessonDetailSerializer(lesson).data)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_quiz_detail(request, quiz_id):
    lesson = get_object_or_404(Lesson, id=quiz_id)

    if request.method == "DELETE":
        delete_quiz_payload(lesson)
        return Response(status=status.HTTP_204_NO_CONTENT)

    serializer = AdminQuizUpdateSerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    payload = get_quiz_payload(lesson)
    if "passing_score" in serializer.validated_data:
        payload["passing_score"] = serializer.validated_data["passing_score"]
    if "time_limit_sec" in serializer.validated_data:
        payload["time_limit_sec"] = serializer.validated_data["time_limit_sec"]
    set_quiz_payload(lesson, payload)
    return Response(
        {
            "id": lesson.id,
            "lesson_id": lesson.id,
            "passing_score": int(payload.get("passing_score", 70)),
            "time_limit_sec": payload.get("time_limit_sec"),
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_course_enrollments(request, course_id):
    course = get_object_or_404(Course, id=course_id)
    enrollments = (
        Enrollment.objects.filter(course=course)
        .select_related("user")
        .order_by("-enrolled_at")
    )
    payload = [
        {
            "id": enrollment.id,
            "status": enrollment.status,
            "enrolled_at": enrollment.enrolled_at,
            "user": {
                "id": enrollment.user_id,
                "username": enrollment.user.username,
                "email": enrollment.user.email,
            },
        }
        for enrollment in enrollments
    ]
    return Response(
        {
            "course": {
                "id": course.id,
                "title": course.title,
                "slug": course.slug,
            },
            "enrollment_count": len(payload),
            "enrollments": payload,
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_students(request):
    user_model = get_user_model()
    users = user_model.objects.exclude(is_superuser=True).order_by("id")
    rows = []
    for user in users:
        role = _role_for_user(user)
        if role != "student":
            continue
        profile, _ = StudentProfile.objects.get_or_create(user=user)
        wallet = _wallet_for_user(user)
        rows.append(
            {
                "user_id": user.id,
                "username": user.username,
                "email": user.email or "",
                "full_name": profile.full_name,
                "verification_status": profile.verification_status,
                "has_passport_photo": bool(profile.passport_photo),
                "role": role,
                "credits": wallet.balance_credits,
                "enrollments": Enrollment.objects.filter(user=user).count(),
                "owned_courses": list(
                    Enrollment.objects.filter(user=user, status=Enrollment.Status.ACTIVE)
                    .select_related("course")
                    .values_list("course__title", flat=True)
                ),
            }
        )
    return Response(AdminStudentListRowSerializer(rows, many=True).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_student_profile(request, user_id):
    user_model = get_user_model()
    student = get_object_or_404(user_model, id=user_id)
    if _role_for_user(student) != "student":
        return Response({"detail": "Only student accounts are supported."}, status=status.HTTP_400_BAD_REQUEST)
    profile, _ = StudentProfile.objects.get_or_create(user=student)
    profile_payload = StudentProfileSerializer(profile, context={"request": request}).data
    profile_payload["completion_flags"] = _profile_completion_flags(profile)
    profile_payload["profile_completed"] = _is_profile_completed(profile)
    return Response(
        {
            "student": {
                "id": student.id,
                "username": student.username,
                "email": student.email or "",
            },
            "profile": profile_payload,
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_student_profile_review(request, user_id):
    user_model = get_user_model()
    student = get_object_or_404(user_model, id=user_id)
    if _role_for_user(student) != "student":
        return Response({"detail": "Only student accounts are supported."}, status=status.HTTP_400_BAD_REQUEST)
    profile, _ = StudentProfile.objects.get_or_create(user=student)

    action = str(request.data.get("action", "")).strip().lower()
    note = str(request.data.get("note", "")).strip()
    if action not in ("approve", "deny"):
        return Response({"detail": "action must be either 'approve' or 'deny'."}, status=status.HTTP_400_BAD_REQUEST)

    if action == "approve":
        profile.verification_status = StudentProfile.VerificationStatus.VERIFIED
        profile.verification_note = note
        profile.save(update_fields=["verification_status", "verification_note", "updated_at"])
        detail = "Student profile approved."
    else:
        if profile.passport_photo:
            profile.passport_photo.delete(save=False)
        profile.passport_photo = ""
        profile.verification_status = StudentProfile.VerificationStatus.REJECTED
        profile.verification_note = note or "Verification denied. Please re-upload passport photo."
        profile.save(update_fields=["passport_photo", "verification_status", "verification_note", "updated_at"])
        detail = "Student profile denied. Passport photo cleared."

    profile_payload = StudentProfileSerializer(profile, context={"request": request}).data
    profile_payload["completion_flags"] = _profile_completion_flags(profile)
    profile_payload["profile_completed"] = _is_profile_completed(profile)
    return Response(
        {
            "detail": detail,
            "student": {
                "id": student.id,
                "username": student.username,
                "email": student.email or "",
            },
            "profile": profile_payload,
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_student_certificates(request, user_id):
    user_model = get_user_model()
    student = get_object_or_404(user_model, id=user_id)
    if _role_for_user(student) != "student":
        return Response({"detail": "Only student accounts are supported."}, status=status.HTTP_400_BAD_REQUEST)
    certificates = (
        Certificate.objects.filter(user=student)
        .select_related("course", "exam_attempt")
        .prefetch_related("audit_logs__actor")
        .order_by("-issued_at", "-id")
    )
    payload = []
    for cert in certificates:
        ensure_certificate_signature(cert)
        payload.append(
            {
                "certificate": CertificateSerializer(cert, context={"request": request}).data,
                "course": {"id": cert.course_id, "title": cert.course.title},
                "audit_logs": CertificateAuditLogSerializer(cert.audit_logs.all()[:20], many=True).data,
            }
        )
    return Response(
        {
            "student": {"id": student.id, "username": student.username, "email": student.email or ""},
            "certificates": payload,
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_certificate_revoke(request, certificate_id):
    certificate = get_object_or_404(Certificate.objects.select_related("course", "user"), id=certificate_id)
    serializer = AdminCertificateActionSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    reason = serializer.validated_data.get("reason", "").strip()
    with transaction.atomic():
        certificate = Certificate.objects.select_for_update().get(id=certificate.id)
        if certificate.revoked_at is None:
            certificate.revoked_at = timezone.now()
            certificate.revoked_reason = reason or "Revoked by admin."
            certificate.save(update_fields=["revoked_at", "revoked_reason", "updated_at"])
            _create_certificate_audit_log(
                certificate=certificate,
                action=CertificateAuditLog.Action.REVOKED,
                actor=request.user,
                reason=certificate.revoked_reason,
                meta={"course_id": certificate.course_id, "user_id": certificate.user_id},
            )
    ensure_certificate_signature(certificate)
    return Response(
        {
            "detail": "Certificate revoked.",
            "certificate": CertificateSerializer(certificate, context={"request": request}).data,
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_certificate_reissue(request, certificate_id):
    certificate = get_object_or_404(Certificate.objects.select_related("course", "user"), id=certificate_id)
    serializer = AdminCertificateActionSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    reason = serializer.validated_data.get("reason", "").strip()

    with transaction.atomic():
        certificate = Certificate.objects.select_for_update().get(id=certificate.id)
        old_certificate_code = certificate.certificate_code
        old_verification_code = certificate.verification_code

        certificate.certificate_code = _new_certificate_code()
        certificate.verification_code = ""
        certificate.signed_payload = ""
        certificate.revoked_at = None
        certificate.revoked_reason = ""
        certificate.save(
            update_fields=[
                "certificate_code",
                "verification_code",
                "signed_payload",
                "revoked_at",
                "revoked_reason",
                "updated_at",
            ]
        )
        ensure_certificate_signature(certificate)
        _create_certificate_audit_log(
            certificate=certificate,
            action=CertificateAuditLog.Action.REISSUED,
            actor=request.user,
            reason=reason or "Reissued by admin.",
            meta={
                "course_id": certificate.course_id,
                "user_id": certificate.user_id,
                "old_certificate_code": old_certificate_code,
                "new_certificate_code": certificate.certificate_code,
                "old_verification_code": old_verification_code,
                "new_verification_code": certificate.verification_code,
            },
        )

    return Response(
        {
            "detail": "Certificate reissued with new verification identity.",
            "certificate": CertificateSerializer(certificate, context={"request": request}).data,
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_certificate_audit_logs(request):
    logs = CertificateAuditLog.objects.select_related("certificate", "certificate__course", "certificate__user", "actor")
    user_id = request.query_params.get("user_id")
    course_id = request.query_params.get("course_id")
    if user_id:
        logs = logs.filter(certificate__user_id=user_id)
    if course_id:
        logs = logs.filter(certificate__course_id=course_id)
    logs = logs.order_by("-created_at", "-id")[:200]
    return Response(CertificateAuditLogSerializer(logs, many=True).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_student_wallet(request, user_id):
    user_model = get_user_model()
    student = get_object_or_404(user_model, id=user_id)
    if _role_for_user(student) != "student":
        return Response({"detail": "Only student accounts are supported."}, status=status.HTTP_400_BAD_REQUEST)
    wallet = _wallet_for_user(student)
    txs = CreditTransaction.objects.filter(user=student).select_related("course", "created_by").order_by("-created_at")[:100]
    enrollments = Enrollment.objects.filter(user=student).select_related("course").order_by("-enrolled_at")
    return Response(
        {
            "student": {"id": student.id, "username": student.username, "email": student.email or ""},
            "wallet": CreditWalletSerializer(wallet).data,
            "transactions": CreditTransactionSerializer(txs, many=True).data,
            "enrollments": EnrollmentSerializer(enrollments, many=True).data,
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_student_wallet_adjust(request, user_id):
    user_model = get_user_model()
    student = get_object_or_404(user_model, id=user_id)
    if _role_for_user(student) != "student":
        return Response({"detail": "Only student accounts are supported."}, status=status.HTTP_400_BAD_REQUEST)

    serializer = AdminCreditAdjustSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    amount = int(serializer.validated_data["amount"])
    note = serializer.validated_data.get("note", "")
    if amount == 0:
        return Response({"detail": "Amount must not be zero."}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        wallet = CreditWallet.objects.select_for_update().filter(user=student).first()
        if wallet is None:
            wallet = CreditWallet.objects.create(user=student, balance_credits=0)
        next_balance = wallet.balance_credits + amount
        if next_balance < 0:
            return Response(
                {
                    "detail": "Insufficient credits for this deduction.",
                    "current_credits": wallet.balance_credits,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        wallet.balance_credits = next_balance
        wallet.save(update_fields=["balance_credits", "updated_at"])
        tx = CreditTransaction.objects.create(
            user=student,
            amount=amount,
            balance_after=next_balance,
            kind=CreditTransaction.Kind.ADMIN_ADJUST if amount >= 0 else CreditTransaction.Kind.REFUND,
            note=note,
            created_by=request.user,
        )

    return Response(
        {
            "wallet": CreditWalletSerializer(wallet).data,
            "transaction": CreditTransactionSerializer(tx).data,
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_student_expel(request, user_id):
    user_model = get_user_model()
    student = get_object_or_404(user_model, id=user_id)
    if _role_for_user(student) != "student":
        return Response({"detail": "Only student accounts can be expelled."}, status=status.HTTP_400_BAD_REQUEST)

    confirmation = str(request.data.get("confirmation", "")).strip()
    expected = "I would like to expell this student"
    if confirmation != expected:
        return Response(
            {"detail": f"Confirmation text must match exactly: '{expected}'."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Remove uploaded passport file explicitly before user delete.
    profile = StudentProfile.objects.filter(user=student).first()
    if profile and profile.passport_photo:
        profile.passport_photo.delete(save=False)

    username = student.username
    student.delete()
    return Response({"detail": f"Student '{username}' has been expelled and removed."}, status=status.HTTP_200_OK)


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_insights(request):
    courses = list(Course.objects.all().order_by("id").values("id", "title", "slug", "is_published"))

    enrollment_rows = Enrollment.objects.values("course_id").annotate(count=Count("id"))
    lesson_rows = Lesson.objects.values("course_id").annotate(count=Count("id"))
    lessons = list(Lesson.objects.all().only("id", "course_id", "quiz_payload"))
    quiz_map = get_quiz_map(lessons)
    quiz_count_by_course = {}
    for lesson in lessons:
        if lesson.id in quiz_map:
            quiz_count_by_course[lesson.course_id] = quiz_count_by_course.get(lesson.course_id, 0) + 1
    attempt_rows = QuizAttempt.objects.values("lesson__course_id").annotate(
        attempts=Count("id"),
        passes=Count("id", filter=Q(passed=True)),
    )

    enrollment_map = {row["course_id"]: row["count"] for row in enrollment_rows}
    lesson_map = {row["course_id"]: row["count"] for row in lesson_rows}
    quiz_map = quiz_count_by_course
    attempt_map = {row["lesson__course_id"]: row for row in attempt_rows}

    course_payload = []
    for course in courses:
        course_id = course["id"]
        attempts = int(attempt_map.get(course_id, {}).get("attempts", 0))
        passes = int(attempt_map.get(course_id, {}).get("passes", 0))
        pass_rate = round((passes / attempts) * 100, 2) if attempts > 0 else 0.0
        course_payload.append(
            {
                "course_id": course_id,
                "title": course["title"],
                "slug": course["slug"],
                "is_published": bool(course["is_published"]),
                "enrollments": int(enrollment_map.get(course_id, 0)),
                "lessons": int(lesson_map.get(course_id, 0)),
                "quizzes": int(quiz_map.get(course_id, 0)),
                "quiz_attempts": attempts,
                "quiz_passes": passes,
                "pass_rate": pass_rate,
            }
        )

    total_attempts = QuizAttempt.objects.count()
    total_passes = QuizAttempt.objects.filter(passed=True).count()
    total_pass_rate = round((total_passes / total_attempts) * 100, 2) if total_attempts > 0 else 0.0

    return Response(
        {
            "totals": {
                "courses": len(courses),
                "published_courses": sum(1 for course in courses if course["is_published"]),
                "students": Enrollment.objects.values("user_id").distinct().count(),
                "enrollments": Enrollment.objects.count(),
                "lessons": Lesson.objects.count(),
                "quizzes": sum(quiz_count_by_course.values()),
                "quiz_attempts": total_attempts,
                "quiz_passes": total_passes,
                "pass_rate": total_pass_rate,
            },
            "courses": course_payload,
        }
    )


@api_view(["GET"])
@permission_classes([AllowAny])
def lesson_detail(request, lesson_id):
    lesson = get_object_or_404(
        Lesson.objects.select_related("course"),
        id=lesson_id,
    )
    _assert_course_live(lesson.course)
    if not _can_access_lesson(request.user, lesson):
        return Response(
            {"detail": _lesson_access_denial_message(request.user, lesson)},
            status=status.HTTP_403_FORBIDDEN,
        )
    has_quiz = bool(get_quiz_payload(lesson).get("questions"))
    return Response(LessonDetailSerializer(lesson, context={"has_quiz": has_quiz}).data)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def lesson_progress(request, lesson_id):
    lesson = get_object_or_404(
        Lesson.objects.select_related("course"),
        id=lesson_id,
    )
    _assert_course_live(lesson.course)
    if not _can_access_lesson(request.user, lesson):
        return Response(
            {"detail": _lesson_access_denial_message(request.user, lesson)},
            status=status.HTTP_403_FORBIDDEN,
        )

    progress, _ = UserLessonProgress.objects.get_or_create(
        user=request.user,
        lesson=lesson,
        defaults={"last_position_seconds": 0, "completed": False},
    )

    if request.method == "GET":
        return Response(UserLessonProgressSerializer(progress).data)

    serializer = UserLessonProgressUpsertSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    progress.last_position_seconds = serializer.validated_data["last_position_seconds"]
    has_quiz = bool(get_quiz_payload(lesson).get("questions"))
    completed_flag = bool(serializer.validated_data["completed"])
    if (
        not has_quiz
        and lesson.content_type == Lesson.ContentType.VIDEO
        and lesson.duration_seconds
        and progress.last_position_seconds >= int(lesson.duration_seconds * 0.9)
    ):
        completed_flag = True

    # Completion is sticky: once completed, subsequent partial progress updates
    # should not regress the lesson back to incomplete.
    progress.completed = progress.completed or completed_flag
    progress.save(update_fields=["last_position_seconds", "completed", "updated_at"])

    return Response(UserLessonProgressSerializer(progress).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def stream_access(request, lesson_id):
    serializer = StreamAccessSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    device_id = serializer.validated_data["device_id"]

    lesson = get_object_or_404(
        Lesson.objects.select_related("course"),
        id=lesson_id,
    )
    _assert_course_live(lesson.course)
    if not _can_access_lesson(request.user, lesson):
        return Response(
            {"detail": _lesson_access_denial_message(request.user, lesson)},
            status=status.HTTP_403_FORBIDDEN,
        )

    now = timezone.now()
    lease_ttl = timedelta(seconds=settings.STREAM_LEASE_TTL_SECONDS)
    cooldown = timedelta(seconds=settings.STREAM_SESSION_COOLDOWN_SECONDS)

    with transaction.atomic():
        session = (
            ActiveStreamSession.objects.select_for_update()
            .filter(user=request.user)
            .first()
        )

        if session is None:
            session = ActiveStreamSession.objects.create(
                user=request.user,
                session_id=uuid.uuid4(),
                device_id=device_id,
                lesson=lesson,
                issued_at=now,
                last_heartbeat_at=now,
                expires_at=now + lease_ttl,
                status=ActiveStreamSession.Status.ACTIVE,
            )
        else:
            expired = session.expires_at <= now or session.status != ActiveStreamSession.Status.ACTIVE
            same_device = session.device_id == device_id

            if expired or same_device:
                session.session_id = uuid.uuid4() if expired else session.session_id
                session.device_id = device_id
                session.lesson = lesson
                session.status = ActiveStreamSession.Status.ACTIVE
                session.last_heartbeat_at = now
                session.expires_at = now + lease_ttl
                session.save(
                    update_fields=[
                        "session_id",
                        "device_id",
                        "lesson",
                        "status",
                        "last_heartbeat_at",
                        "expires_at",
                        "updated_at",
                    ]
                )
            else:
                if now - session.updated_at < cooldown:
                    wait_seconds = int((cooldown - (now - session.updated_at)).total_seconds())
                    return Response(
                        {
                            "detail": "Session switch cooldown active.",
                            "retry_after_seconds": max(wait_seconds, 1),
                        },
                        status=status.HTTP_429_TOO_MANY_REQUESTS,
                    )
                session.session_id = uuid.uuid4()
                session.device_id = device_id
                session.lesson = lesson
                session.status = ActiveStreamSession.Status.ACTIVE
                session.last_heartbeat_at = now
                session.expires_at = now + lease_ttl
                session.issued_at = now
                session.save(
                    update_fields=[
                        "session_id",
                        "device_id",
                        "lesson",
                        "status",
                        "issued_at",
                        "last_heartbeat_at",
                        "expires_at",
                        "updated_at",
                    ]
                )

    playback_token = _issue_stream_token(
        user_id=request.user.id,
        lesson_id=lesson.id,
        session_id=session.session_id,
        device_id=session.device_id,
    )
    return Response(
        {
            "session_id": str(session.session_id),
            "playback_token": playback_token,
            "playback_url": _build_playback_url(lesson.id),
            "token_ttl_seconds": settings.STREAM_TOKEN_TTL_SECONDS,
            "lease_ttl_seconds": settings.STREAM_LEASE_TTL_SECONDS,
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def stream_heartbeat(request):
    serializer = StreamHeartbeatSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    now = timezone.now()
    lease_ttl = timedelta(seconds=settings.STREAM_LEASE_TTL_SECONDS)

    try:
        session = ActiveStreamSession.objects.get(user=request.user)
    except ActiveStreamSession.DoesNotExist:
        return Response({"active": False, "detail": "No active session."}, status=status.HTTP_409_CONFLICT)

    if (
        session.status != ActiveStreamSession.Status.ACTIVE
        or session.expires_at <= now
        or str(session.session_id) != str(serializer.validated_data["session_id"])
        or session.device_id != serializer.validated_data["device_id"]
        or session.lesson_id != serializer.validated_data["lesson_id"]
    ):
        return Response(
            {"active": False, "detail": "Session superseded or expired."},
            status=status.HTTP_409_CONFLICT,
        )

    session.last_heartbeat_at = now
    session.expires_at = now + lease_ttl
    session.save(update_fields=["last_heartbeat_at", "expires_at", "updated_at"])
    return Response({"active": True, "expires_at": session.expires_at.isoformat()})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def stream_renew(request):
    serializer = StreamHeartbeatSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    now = timezone.now()
    lease_ttl = timedelta(seconds=settings.STREAM_LEASE_TTL_SECONDS)

    try:
        session = ActiveStreamSession.objects.get(user=request.user)
    except ActiveStreamSession.DoesNotExist:
        return Response({"detail": "No active session."}, status=status.HTTP_409_CONFLICT)

    if (
        session.status != ActiveStreamSession.Status.ACTIVE
        or session.expires_at <= now
        or str(session.session_id) != str(serializer.validated_data["session_id"])
        or session.device_id != serializer.validated_data["device_id"]
        or session.lesson_id != serializer.validated_data["lesson_id"]
    ):
        return Response({"detail": "Session superseded or expired."}, status=status.HTTP_409_CONFLICT)

    session.last_heartbeat_at = now
    session.expires_at = now + lease_ttl
    session.save(update_fields=["last_heartbeat_at", "expires_at", "updated_at"])

    playback_token = _issue_stream_token(
        user_id=request.user.id,
        lesson_id=session.lesson_id,
        session_id=session.session_id,
        device_id=session.device_id,
    )
    return Response(
        {
            "session_id": str(session.session_id),
            "playback_token": playback_token,
            "playback_url": _build_playback_url(session.lesson_id),
            "token_ttl_seconds": settings.STREAM_TOKEN_TTL_SECONDS,
        }
    )


@api_view(["GET"])
@permission_classes([AllowAny])
def stream_hls_asset(request, lesson_id, asset_name):
    token = request.query_params.get("token")
    if not token:
        return Response({"detail": "Missing token."}, status=status.HTTP_401_UNAUTHORIZED)

    try:
        payload = _decode_stream_token(token)
        _active_session_for_token(payload, lesson_id)
    except signing.SignatureExpired:
        return Response({"detail": "Token expired."}, status=status.HTTP_401_UNAUTHORIZED)
    except signing.BadSignature:
        return Response({"detail": "Invalid token."}, status=status.HTTP_401_UNAUTHORIZED)
    except PermissionError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_401_UNAUTHORIZED)

    lesson = get_object_or_404(Lesson.objects.select_related("course"), id=lesson_id)
    _assert_course_live(lesson.course)
    try:
        path = _lesson_asset_path(lesson, asset_name)
    except SuspiciousFileOperation:
        return Response({"detail": "Invalid path."}, status=status.HTTP_400_BAD_REQUEST)

    # Ensure token is propagated to child playlist/segment URLs so HLS playback can fetch protected assets.
    if path.suffix.lower() == ".m3u8":
        text = path.read_text(encoding="utf-8")
        rewritten_lines = []
        for line in text.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                rewritten_lines.append(line)
                continue
            if "token=" in stripped:
                rewritten_lines.append(line)
                continue
            separator = "&" if "?" in stripped else "?"
            rewritten_lines.append(f"{line}{separator}token={token}")
        body = "\n".join(rewritten_lines)
        return HttpResponse(body, content_type="application/vnd.apple.mpegurl")

    content_type, _ = mimetypes.guess_type(str(path))
    return FileResponse(path.open("rb"), content_type=content_type or "application/octet-stream")


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def lesson_quiz(request, lesson_id):
    lesson = get_object_or_404(
        Lesson.objects.select_related("course"),
        id=lesson_id,
    )
    _assert_course_live(lesson.course)
    if not _is_enrolled(request.user, lesson.course):
        return Response(
            {"detail": "Enrollment required for quizzes."},
            status=status.HTTP_403_FORBIDDEN,
        )
    if not _can_access_lesson(request.user, lesson):
        return Response(
            {"detail": _lesson_access_denial_message(request.user, lesson)},
            status=status.HTTP_403_FORBIDDEN,
        )

    quiz = get_quiz_payload(lesson)
    questions = quiz.get("questions", [])
    if not questions:
        return Response({"detail": "Quiz not found for this lesson."}, status=status.HTTP_404_NOT_FOUND)
    pool_size = min(5, len(questions))
    sampled_questions = random.sample(questions, pool_size) if len(questions) > pool_size else list(questions)
    random.shuffle(sampled_questions)

    question_ids = []
    choice_map = {}
    rendered_questions = []
    for idx, q in enumerate(sampled_questions, start=1):
        qid = int(q["id"])
        shuffled_choices = list(q.get("choices", []))
        random.shuffle(shuffled_choices)
        question_ids.append(qid)
        choice_map[str(qid)] = [int(c["id"]) for c in shuffled_choices]
        rendered_questions.append(
            {
                "id": qid,
                "prompt": q["prompt"],
                "type": q.get("type", "MCQ"),
                "order": idx,
                "choices": [{"id": c["id"], "text": c["text"]} for c in shuffled_choices],
            }
        )

    session_token = _issue_quiz_session_token(
        user_id=request.user.id,
        lesson_id=lesson.id,
        question_ids=question_ids,
        choice_map=choice_map,
    )

    return Response(
        {
            "id": lesson.id,
            "lesson_id": lesson.id,
            "passing_score": quiz.get("passing_score", 70),
            "time_limit_sec": quiz.get("time_limit_sec"),
            "pool_size": pool_size,
            "session_token": session_token,
            "questions": rendered_questions,
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def quiz_submit(request, quiz_id):
    user_key = f"user:{request.user.id}:quiz:{quiz_id}"
    ok, retry_after = _rate_limit_hit(
        scope="quiz_submit",
        subject_key=user_key,
        limit=int(getattr(settings, "QUIZ_SUBMIT_RATE_LIMIT", 50)),
        window_seconds=int(getattr(settings, "QUIZ_SUBMIT_RATE_WINDOW_SECONDS", 600)),
        lock_seconds=int(getattr(settings, "QUIZ_SUBMIT_RATE_LOCK_SECONDS", 900)),
    )
    if not ok:
        return _rate_limit_response("Quiz is temporarily locked due to too many submissions.", retry_after)

    lesson = get_object_or_404(
        Lesson.objects.select_related("course"),
        id=quiz_id,
    )
    _assert_course_live(lesson.course)
    quiz = get_quiz_payload(lesson)
    questions = quiz.get("questions", [])
    if not questions:
        return Response({"detail": "Quiz not found for this lesson."}, status=status.HTTP_404_NOT_FOUND)

    if not _is_enrolled(request.user, lesson.course):
        return Response(
            {"detail": "Enrollment required for quizzes."},
            status=status.HTTP_403_FORBIDDEN,
        )
    if not _can_access_lesson(request.user, lesson):
        return Response(
            {"detail": _lesson_access_denial_message(request.user, lesson)},
            status=status.HTTP_403_FORBIDDEN,
        )

    now = timezone.now()
    fail_limit = settings.QUIZ_FAIL_LIMIT_PER_DAY
    cooldown_delta = timedelta(minutes=settings.QUIZ_FAIL_COOLDOWN_MINUTES)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    failed_today = (
        QuizAttempt.objects.filter(
            user=request.user,
            lesson=lesson,
            passed=False,
            attempted_at__gte=today_start,
        )
        .order_by("-attempted_at")
    )
    if failed_today.count() >= fail_limit:
        latest_fail = failed_today.first()
        if latest_fail and now < latest_fail.attempted_at + cooldown_delta:
            wait_seconds = int((latest_fail.attempted_at + cooldown_delta - now).total_seconds())
            return Response(
                {
                    "detail": "Retry limit reached. Please wait before trying again.",
                    "retry_after_seconds": max(wait_seconds, 1),
                },
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

    serializer = QuizSubmitSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    session_token = (serializer.validated_data.get("session_token") or "").strip()
    submitted_answers = serializer.validated_data["answers"]

    full_question_map = {int(q["id"]): q for q in questions}
    active_questions = questions
    allowed_choice_map = {int(q["id"]): {int(c["id"]) for c in q.get("choices", [])} for q in questions}

    # If provided, quiz session token enforces randomized question pool + choice set.
    if session_token:
        try:
            token_payload = _decode_quiz_session_token(session_token)
        except signing.BadSignature:
            return Response({"detail": "Quiz session expired or invalid. Please reload quiz."}, status=status.HTTP_400_BAD_REQUEST)
        if int(token_payload.get("uid", 0)) != int(request.user.id) or int(token_payload.get("lid", 0)) != int(lesson.id):
            return Response({"detail": "Quiz session does not match this user/lesson."}, status=status.HTTP_400_BAD_REQUEST)
        token_qids = [int(qid) for qid in token_payload.get("qids", [])]
        token_cm = token_payload.get("cm", {}) if isinstance(token_payload.get("cm", {}), dict) else {}
        active_questions = [full_question_map[qid] for qid in token_qids if qid in full_question_map]
        if not active_questions:
            return Response({"detail": "Quiz session has no active questions. Please reload quiz."}, status=status.HTTP_400_BAD_REQUEST)
        allowed_choice_map = {}
        for question in active_questions:
            qid = int(question["id"])
            source_choice_ids = {int(c["id"]) for c in question.get("choices", [])}
            token_choice_ids = [int(cid) for cid in token_cm.get(str(qid), []) if int(cid) in source_choice_ids]
            allowed_choice_map[qid] = set(token_choice_ids if token_choice_ids else source_choice_ids)

    question_map = {int(q["id"]): q for q in active_questions}
    seen_questions = set()
    normalized_answers = []
    correct_count = 0

    for item in submitted_answers:
        qid = item["question_id"]
        cid = item["choice_id"]
        if qid in seen_questions:
            return Response(
                {"detail": f"Duplicate answer for question {qid}."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        seen_questions.add(qid)

        question = question_map.get(int(qid))
        if question is None:
            return Response(
                {"detail": f"Question {qid} is not part of this quiz."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if int(cid) not in allowed_choice_map.get(int(qid), set()):
            return Response(
                {"detail": f"Choice {cid} is invalid for question {qid}."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        choice = next((c for c in question.get("choices", []) if int(c["id"]) == int(cid)), None)
        if choice is None:
            return Response(
                {"detail": f"Choice {cid} is invalid for question {qid}."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if choice.get("is_correct"):
            correct_count += 1
        normalized_answers.append({"question_id": int(qid), "choice_id": int(cid)})

    total_questions = len(active_questions)
    score = round((correct_count / total_questions) * 100, 2)
    passed = score >= float(quiz.get("passing_score", 70))

    with transaction.atomic():
        attempt = QuizAttempt.objects.create(
            user=request.user,
            lesson=lesson,
            score=score,
            passed=passed,
            answers_payload=normalized_answers,
        )
        if passed:
            # A passed quiz marks the lesson as completed for progression unlock.
            progress, _ = UserLessonProgress.objects.get_or_create(
                user=request.user,
                lesson=lesson,
                defaults={"last_position_seconds": 0, "completed": True},
            )
            if not progress.completed:
                progress.completed = True
                progress.save(update_fields=["completed", "updated_at"])

    response_payload = QuizAttemptSerializer(attempt).data
    response_payload["summary"] = {
        "total_questions": total_questions,
        "answered_questions": len(normalized_answers),
        "correct_answers": correct_count,
        "passing_score": int(quiz.get("passing_score", 70)),
    }
    return Response(response_payload, status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def quiz_attempts(request, quiz_id):
    lesson = get_object_or_404(Lesson.objects.select_related("course"), id=quiz_id)
    _assert_course_live(lesson.course)
    if not _is_enrolled(request.user, lesson.course):
        return Response(
            {"detail": "Enrollment required for quizzes."},
            status=status.HTTP_403_FORBIDDEN,
        )
    attempts = (
        QuizAttempt.objects.filter(user=request.user, lesson=lesson)
        .order_by("-attempted_at")
    )
    return Response(QuizAttemptSerializer(attempts, many=True).data)
