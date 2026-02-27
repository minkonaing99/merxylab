import mimetypes
import shutil
import subprocess
import tempfile
import uuid
from datetime import timedelta
from pathlib import Path
import glob

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
from rest_framework_simplejwt.tokens import RefreshToken

from core.models import (
    ActiveStreamSession,
    Course,
    Enrollment,
    Lesson,
    Quiz,
    QuizAttempt,
    QuizAttemptAnswer,
    QuizChoice,
    QuizQuestion,
    Section,
    UserLessonProgress,
)
from core.permissions import IsAdminRole
from core.serializers import (
    AdminCourseCreateSerializer,
    AdminCourseUpdateSerializer,
    AdminLessonCreateSerializer,
    AdminLessonUpdateSerializer,
    AdminQuizCreateSerializer,
    AdminQuizUpdateSerializer,
    AdminSectionSerializer,
    AdminUploadHlsMetadataSerializer,
    AdminUploadVideoSerializer,
    CourseDetailSerializer,
    CourseListSerializer,
    EnrollmentSerializer,
    LessonAccessSerializer,
    LessonDetailSerializer,
    QuizAttemptSerializer,
    QuizPublicSerializer,
    QuizSubmitSerializer,
    StreamAccessSerializer,
    StreamHeartbeatSerializer,
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


def _role_for_user(user):
    if user.is_superuser or user.groups.filter(name="admin").exists():
        return "admin"
    return "student"


def _is_enrolled(user, course):
    if not user.is_authenticated:
        return False
    return Enrollment.objects.filter(
        user=user,
        course=course,
        status=Enrollment.Status.ACTIVE,
    ).exists()


def _can_access_lesson(user, lesson):
    if lesson.is_preview:
        return True
    if not _is_enrolled(user, lesson.course):
        return False
    unlocked_ids = _unlocked_lesson_ids(user, lesson.course)
    return lesson.id in unlocked_ids


def _ordered_course_lessons(course):
    return list(
        Lesson.objects.filter(course=course)
        .select_related("section")
        .order_by("section__order", "order", "id")
    )


def _unlocked_lesson_ids(user, course):
    lessons = _ordered_course_lessons(course)
    unlocked = set()
    if not user.is_authenticated:
        for lesson in lessons:
            if lesson.is_preview:
                unlocked.add(lesson.id)
        return unlocked

    if not _is_enrolled(user, course):
        for lesson in lessons:
            if lesson.is_preview:
                unlocked.add(lesson.id)
        return unlocked

    completed_ids = set(
        UserLessonProgress.objects.filter(user=user, lesson__course=course, completed=True).values_list("lesson_id", flat=True)
    )
    passed_quiz_lesson_ids = set(
        QuizAttempt.objects.filter(
            user=user,
            passed=True,
            quiz__lesson__course=course,
        ).values_list("quiz__lesson_id", flat=True)
    )
    quiz_lesson_ids = set(Quiz.objects.filter(lesson__course=course).values_list("lesson_id", flat=True))

    for idx, lesson in enumerate(lessons):
        if lesson.is_preview:
            unlocked.add(lesson.id)
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
    if lesson.is_preview:
        return ""
    if not _is_enrolled(user, lesson.course):
        return "Enrollment required for this lesson."
    return "Lesson is locked. Complete previous lesson and pass its quiz to unlock."


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


def _resolve_binary(explicit_path, command_name):
    if explicit_path and Path(explicit_path).exists():
        return explicit_path

    detected = shutil.which(command_name)
    if detected:
        return detected

    if command_name in ("ffmpeg", "ffprobe"):
        winget_pattern = str(
            Path.home()
            / "AppData"
            / "Local"
            / "Microsoft"
            / "WinGet"
            / "Packages"
            / "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe"
            / "ffmpeg-*"
            / "bin"
            / f"{command_name}.exe"
        )
        candidates = sorted(glob.glob(winget_pattern), reverse=True)
        if candidates:
            return candidates[0]

    return None


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
def register(request):
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
@permission_classes([IsAuthenticated])
def me(request):
    user = request.user
    return Response(
        {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "is_staff": user.is_staff,
            "is_superuser": user.is_superuser,
            "groups": list(user.groups.values_list("name", flat=True)),
            "role": _role_for_user(user),
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def logout(request):
    serializer = LogoutSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    try:
        token = RefreshToken(serializer.validated_data["refresh"])
        token.blacklist()
    except Exception:
        return Response(
            {"detail": "Invalid refresh token."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
@permission_classes([AllowAny])
def course_list(_request):
    courses = Course.objects.filter(is_published=True).order_by("id")
    return Response(CourseListSerializer(courses, many=True).data)


@api_view(["GET"])
@permission_classes([AllowAny])
def course_detail(request, course_slug):
    course = get_object_or_404(
        Course.objects.prefetch_related("sections__lessons"),
        slug=course_slug,
        is_published=True,
    )
    is_enrolled = _is_enrolled(request.user, course)
    unlocked_ids = _unlocked_lesson_ids(request.user, course)
    serializer = CourseDetailSerializer(
        course,
        context={"is_enrolled": is_enrolled, "unlocked_lesson_ids": unlocked_ids},
    )
    payload = serializer.data
    payload["enrolled"] = is_enrolled
    return Response(payload)


@api_view(["GET"])
@permission_classes([AllowAny])
def course_lessons(request, course_id):
    course = get_object_or_404(Course, id=course_id, is_published=True)
    is_enrolled = _is_enrolled(request.user, course)
    unlocked_ids = _unlocked_lesson_ids(request.user, course)
    lessons = Lesson.objects.filter(course=course).select_related("section").order_by("section__order", "order", "id")
    serializer = LessonAccessSerializer(lessons, many=True, context={"is_enrolled": is_enrolled, "unlocked_lesson_ids": unlocked_ids})
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
    course = get_object_or_404(Course, id=course_id, is_published=True)
    enrollment, created = Enrollment.objects.get_or_create(
        user=request.user,
        course=course,
        defaults={"status": Enrollment.Status.ACTIVE},
    )

    if not created and enrollment.status != Enrollment.Status.ACTIVE:
        enrollment.status = Enrollment.Status.ACTIVE
        enrollment.save(update_fields=["status", "updated_at"])

    return Response(
        {
            "enrolled": True,
            "created": created,
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
@permission_classes([AllowAny])
def course_access(request, course_id):
    course = get_object_or_404(Course, id=course_id, is_published=True)
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
        lessons = Lesson.objects.select_related("course", "section").all().order_by("course_id", "section_id", "order", "id")
        if course_id:
            lessons = lessons.filter(course_id=course_id)
        payload = [
            {
                "id": lesson.id,
                "course_id": lesson.course_id,
                "course_title": lesson.course.title,
                "section_id": lesson.section_id,
                "section_title": lesson.section.title,
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
    section_id = data.get("section_id")
    if section_id:
        section = get_object_or_404(Section, id=section_id, course=course)
    else:
        section, _ = Section.objects.get_or_create(
            course=course,
            order=data["section_order"],
            defaults={"title": data["section_title"]},
        )
        if section.title != data["section_title"]:
            section.title = data["section_title"]
            section.save(update_fields=["title", "updated_at"])

    lesson = Lesson.objects.create(
        course=course,
        section=section,
        title=data["title"],
        order=data["order"],
        content_type=data.get("content_type", Lesson.ContentType.VIDEO),
        is_preview=data.get("is_preview", False),
        hls_master_path=data.get("hls_master_path", ""),
        reading_content=data.get("reading_content", ""),
        duration_seconds=data.get("duration_seconds"),
    )
    return Response(LessonDetailSerializer(lesson).data, status=status.HTTP_201_CREATED)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_quizzes(request):
    if request.method == "GET":
        quizzes = Quiz.objects.select_related("lesson", "lesson__course").prefetch_related("questions__choices").all().order_by("id")
        payload = []
        for quiz in quizzes:
            payload.append(
                {
                    "id": quiz.id,
                    "lesson_id": quiz.lesson_id,
                    "lesson_title": quiz.lesson.title,
                    "course_id": quiz.lesson.course_id,
                    "course_title": quiz.lesson.course.title,
                    "passing_score": quiz.passing_score,
                    "time_limit_sec": quiz.time_limit_sec,
                    "questions_count": quiz.questions.count(),
                }
            )
        return Response(payload)

    serializer = AdminQuizCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    lesson = get_object_or_404(Lesson, id=data["lesson_id"])
    if hasattr(lesson, "quiz"):
        return Response({"detail": "Quiz already exists for this lesson."}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        quiz = Quiz.objects.create(
            lesson=lesson,
            passing_score=data.get("passing_score", 70),
            time_limit_sec=data.get("time_limit_sec"),
        )
        for question_item in data["questions"]:
            question = QuizQuestion.objects.create(
                quiz=quiz,
                prompt=question_item["prompt"],
                type=question_item.get("type", QuizQuestion.Type.MCQ),
                order=question_item["order"],
            )
            QuizChoice.objects.bulk_create(
                [
                    QuizChoice(
                        question=question,
                        text=choice["text"],
                        is_correct=choice.get("is_correct", False),
                    )
                    for choice in question_item["choices"]
                ]
            )

    return Response(QuizPublicSerializer(quiz).data, status=status.HTTP_201_CREATED)


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

    ffmpeg_bin = _resolve_binary(settings.FFMPEG_BIN, "ffmpeg")
    ffprobe_bin = _resolve_binary(settings.FFPROBE_BIN, "ffprobe")
    if not ffmpeg_bin:
        return Response(
            {
                "detail": "ffmpeg not found. Set FFMPEG_BIN in backend/.env or install ffmpeg in PATH.",
                "hint": "Example: FFMPEG_BIN=C:\\\\...\\\\ffmpeg.exe",
            },
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    data = serializer.validated_data
    lesson = get_object_or_404(Lesson.objects.select_related("course"), id=data["lesson_id"])
    video_file = data["video"]

    with tempfile.TemporaryDirectory() as temp_dir:
        input_path = Path(temp_dir) / video_file.name
        with input_path.open("wb") as f:
            for chunk in video_file.chunks():
                f.write(chunk)

        output_dir = settings.MEDIA_ROOT / "hls" / f"course_{lesson.course_id}" / f"lesson_{lesson.id}"
        output_dir.mkdir(parents=True, exist_ok=True)
        master_path = output_dir / "master.m3u8"
        segment_pattern = str(output_dir / "seg_%03d.ts")

        ffmpeg_cmd = [
            ffmpeg_bin,
            "-y",
            "-i",
            str(input_path),
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
            "-hls_time",
            "6",
            "-hls_playlist_type",
            "vod",
            "-hls_segment_filename",
            segment_pattern,
            str(master_path),
        ]
        ffmpeg_result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
        if ffmpeg_result.returncode != 0 or not master_path.exists():
            return Response(
                {"detail": "Video transcoding failed.", "stderr": ffmpeg_result.stderr[-1200:]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        duration_seconds = lesson.duration_seconds
        if ffprobe_bin:
            ffprobe_cmd = [
                ffprobe_bin,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(input_path),
            ]
            ffprobe_result = subprocess.run(ffprobe_cmd, capture_output=True, text=True)
            if ffprobe_result.returncode == 0:
                try:
                    duration_seconds = int(float(ffprobe_result.stdout.strip()))
                except ValueError:
                    pass

    lesson.hls_master_path = f"media/hls/course_{lesson.course_id}/lesson_{lesson.id}/master.m3u8"
    lesson.duration_seconds = duration_seconds
    lesson.save(update_fields=["hls_master_path", "duration_seconds", "updated_at"])

    return Response(
        {
            "lesson_id": lesson.id,
            "course_id": lesson.course_id,
            "hls_master_path": lesson.hls_master_path,
            "duration_seconds": lesson.duration_seconds,
        },
        status=status.HTTP_200_OK,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_sections(request):
    course_id = request.query_params.get("course_id")
    sections = Section.objects.all().order_by("course_id", "order", "id")
    if course_id:
        sections = sections.filter(course_id=course_id)
    return Response(AdminSectionSerializer(sections, many=True).data)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_course_detail(request, course_id):
    course = get_object_or_404(Course, id=course_id)

    if request.method == "DELETE":
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
        lesson.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    serializer = AdminLessonUpdateSerializer(lesson, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(LessonDetailSerializer(lesson).data)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated, IsAdminRole])
def admin_quiz_detail(request, quiz_id):
    quiz = get_object_or_404(Quiz, id=quiz_id)

    if request.method == "DELETE":
        quiz.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    serializer = AdminQuizUpdateSerializer(quiz, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(
        {
            "id": quiz.id,
            "lesson_id": quiz.lesson_id,
            "passing_score": int(quiz.passing_score),
            "time_limit_sec": quiz.time_limit_sec,
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
def admin_insights(request):
    courses = list(Course.objects.all().order_by("id").values("id", "title", "slug", "is_published"))

    enrollment_rows = Enrollment.objects.values("course_id").annotate(count=Count("id"))
    lesson_rows = Lesson.objects.values("course_id").annotate(count=Count("id"))
    quiz_rows = Quiz.objects.values("lesson__course_id").annotate(count=Count("id"))
    attempt_rows = QuizAttempt.objects.values("quiz__lesson__course_id").annotate(
        attempts=Count("id"),
        passes=Count("id", filter=Q(passed=True)),
    )

    enrollment_map = {row["course_id"]: row["count"] for row in enrollment_rows}
    lesson_map = {row["course_id"]: row["count"] for row in lesson_rows}
    quiz_map = {row["lesson__course_id"]: row["count"] for row in quiz_rows}
    attempt_map = {row["quiz__lesson__course_id"]: row for row in attempt_rows}

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
                "quizzes": Quiz.objects.count(),
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
        Lesson.objects.select_related("course", "section", "quiz"),
        id=lesson_id,
        course__is_published=True,
    )
    if not _can_access_lesson(request.user, lesson):
        return Response(
            {"detail": _lesson_access_denial_message(request.user, lesson)},
            status=status.HTTP_403_FORBIDDEN,
        )
    return Response(LessonDetailSerializer(lesson).data)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def lesson_progress(request, lesson_id):
    lesson = get_object_or_404(
        Lesson.objects.select_related("course"),
        id=lesson_id,
        course__is_published=True,
    )
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
    # Completion is sticky: once completed, subsequent partial progress updates
    # should not regress the lesson back to incomplete.
    progress.completed = progress.completed or serializer.validated_data["completed"]
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
        course__is_published=True,
    )
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

    lesson = get_object_or_404(Lesson, id=lesson_id, course__is_published=True)
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
        Lesson.objects.select_related("course").prefetch_related("quiz__questions__choices"),
        id=lesson_id,
        course__is_published=True,
    )
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

    quiz = getattr(lesson, "quiz", None)
    if quiz is None:
        return Response({"detail": "Quiz not found for this lesson."}, status=status.HTTP_404_NOT_FOUND)
    return Response(QuizPublicSerializer(quiz).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def quiz_submit(request, quiz_id):
    quiz = get_object_or_404(
        Quiz.objects.select_related("lesson__course").prefetch_related("questions__choices"),
        id=quiz_id,
        lesson__course__is_published=True,
    )
    if not _is_enrolled(request.user, quiz.lesson.course):
        return Response(
            {"detail": "Enrollment required for quizzes."},
            status=status.HTTP_403_FORBIDDEN,
        )
    if not _can_access_lesson(request.user, quiz.lesson):
        return Response(
            {"detail": _lesson_access_denial_message(request.user, quiz.lesson)},
            status=status.HTTP_403_FORBIDDEN,
        )

    now = timezone.now()
    fail_limit = settings.QUIZ_FAIL_LIMIT_PER_DAY
    cooldown_delta = timedelta(minutes=settings.QUIZ_FAIL_COOLDOWN_MINUTES)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    failed_today = (
        QuizAttempt.objects.filter(
            user=request.user,
            quiz=quiz,
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
    submitted_answers = serializer.validated_data["answers"]

    questions = list(quiz.questions.all().order_by("order", "id"))
    if not questions:
        return Response({"detail": "Quiz has no questions configured."}, status=status.HTTP_400_BAD_REQUEST)

    question_map = {q.id: q for q in questions}
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

        question = question_map.get(qid)
        if question is None:
            return Response(
                {"detail": f"Question {qid} is not part of this quiz."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            choice = QuizChoice.objects.get(id=cid, question_id=qid)
        except QuizChoice.DoesNotExist:
            return Response(
                {"detail": f"Choice {cid} is invalid for question {qid}."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if choice.is_correct:
            correct_count += 1
        normalized_answers.append((qid, cid))

    total_questions = len(questions)
    score = round((correct_count / total_questions) * 100, 2)
    passed = score >= float(quiz.passing_score)

    with transaction.atomic():
        attempt = QuizAttempt.objects.create(
            user=request.user,
            quiz=quiz,
            score=score,
            passed=passed,
        )
        QuizAttemptAnswer.objects.bulk_create(
            [
                QuizAttemptAnswer(attempt=attempt, question_id=qid, choice_id=cid)
                for qid, cid in normalized_answers
            ]
        )
        if passed:
            # A passed quiz marks the lesson as completed for progression unlock.
            progress, _ = UserLessonProgress.objects.get_or_create(
                user=request.user,
                lesson=quiz.lesson,
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
        "passing_score": int(quiz.passing_score),
    }
    return Response(response_payload, status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def quiz_attempts(request, quiz_id):
    quiz = get_object_or_404(Quiz.objects.select_related("lesson__course"), id=quiz_id, lesson__course__is_published=True)
    if not _is_enrolled(request.user, quiz.lesson.course):
        return Response(
            {"detail": "Enrollment required for quizzes."},
            status=status.HTTP_403_FORBIDDEN,
        )
    attempts = (
        QuizAttempt.objects.filter(user=request.user, quiz=quiz)
        .prefetch_related("answers")
        .order_by("-attempted_at")
    )
    return Response(QuizAttemptSerializer(attempts, many=True).data)
