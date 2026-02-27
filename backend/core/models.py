import uuid

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Course(TimeStampedModel):
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    slug = models.SlugField(max_length=255, unique=True)
    level = models.CharField(max_length=64, blank=True)
    price_cents = models.PositiveIntegerField(default=0)
    thumbnail_url = models.URLField(blank=True)
    is_published = models.BooleanField(default=False)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return self.title


class Section(TimeStampedModel):
    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name="sections")
    title = models.CharField(max_length=255)
    order = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ["course_id", "order", "id"]
        constraints = [
            models.UniqueConstraint(fields=["course", "order"], name="uniq_section_course_order"),
        ]

    def __str__(self):
        return f"{self.course.title} - {self.title}"


class Lesson(TimeStampedModel):
    class ContentType(models.TextChoices):
        VIDEO = "VIDEO", "Video"
        READING = "READING", "Reading"

    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name="lessons")
    section = models.ForeignKey(Section, on_delete=models.CASCADE, related_name="lessons")
    title = models.CharField(max_length=255)
    order = models.PositiveIntegerField(default=1)
    content_type = models.CharField(max_length=16, choices=ContentType.choices, default=ContentType.VIDEO)
    is_preview = models.BooleanField(default=False)
    hls_master_path = models.CharField(max_length=512, blank=True)
    reading_content = models.TextField(blank=True)
    duration_seconds = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["section_id", "order", "id"]
        constraints = [
            models.UniqueConstraint(fields=["section", "order"], name="uniq_lesson_section_order"),
        ]

    def __str__(self):
        return f"{self.section.title} - {self.title}"


class Enrollment(TimeStampedModel):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        CANCELLED = "CANCELLED", "Cancelled"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="enrollments")
    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name="enrollments")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    enrolled_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    payment_provider = models.CharField(max_length=64, blank=True)
    payment_ref = models.CharField(max_length=128, blank=True)

    class Meta:
        ordering = ["-enrolled_at"]
        constraints = [
            models.UniqueConstraint(fields=["user", "course"], name="uniq_enrollment_user_course"),
        ]
        indexes = [
            models.Index(fields=["status"]),
        ]

    def __str__(self):
        return f"{self.user_id} -> {self.course_id} ({self.status})"


class UserLessonProgress(TimeStampedModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="lesson_progress")
    lesson = models.ForeignKey(Lesson, on_delete=models.CASCADE, related_name="user_progress")
    last_position_seconds = models.PositiveIntegerField(default=0)
    completed = models.BooleanField(default=False)

    class Meta:
        ordering = ["user_id", "lesson_id"]
        constraints = [
            models.UniqueConstraint(fields=["user", "lesson"], name="uniq_progress_user_lesson"),
        ]

    def __str__(self):
        return f"{self.user_id} - {self.lesson_id}: {self.last_position_seconds}s"


class Quiz(TimeStampedModel):
    lesson = models.OneToOneField(Lesson, on_delete=models.CASCADE, related_name="quiz")
    passing_score = models.PositiveSmallIntegerField(
        default=70,
        validators=[MinValueValidator(0), MaxValueValidator(100)],
    )
    time_limit_sec = models.PositiveIntegerField(null=True, blank=True)

    def __str__(self):
        return f"Quiz for {self.lesson.title}"


class QuizQuestion(TimeStampedModel):
    class Type(models.TextChoices):
        MCQ = "MCQ", "Multiple Choice"

    quiz = models.ForeignKey(Quiz, on_delete=models.CASCADE, related_name="questions")
    prompt = models.TextField()
    type = models.CharField(max_length=16, choices=Type.choices, default=Type.MCQ)
    order = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ["quiz_id", "order", "id"]
        constraints = [
            models.UniqueConstraint(fields=["quiz", "order"], name="uniq_question_quiz_order"),
        ]

    def __str__(self):
        return f"{self.quiz_id} - Q{self.order}"


class QuizChoice(TimeStampedModel):
    question = models.ForeignKey(QuizQuestion, on_delete=models.CASCADE, related_name="choices")
    text = models.CharField(max_length=500)
    is_correct = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.question_id} - {self.text[:40]}"


class QuizAttempt(TimeStampedModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="quiz_attempts")
    quiz = models.ForeignKey(Quiz, on_delete=models.CASCADE, related_name="attempts")
    attempted_at = models.DateTimeField(auto_now_add=True)
    score = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    passed = models.BooleanField(default=False)

    class Meta:
        ordering = ["-attempted_at"]
        indexes = [
            models.Index(fields=["user", "quiz"]),
        ]

    def __str__(self):
        return f"{self.user_id} - {self.quiz_id} ({self.score})"


class QuizAttemptAnswer(TimeStampedModel):
    attempt = models.ForeignKey(QuizAttempt, on_delete=models.CASCADE, related_name="answers")
    question = models.ForeignKey(QuizQuestion, on_delete=models.CASCADE, related_name="attempt_answers")
    choice = models.ForeignKey(QuizChoice, on_delete=models.CASCADE, related_name="attempt_answers")

    class Meta:
        ordering = ["attempt_id", "question_id"]
        constraints = [
            models.UniqueConstraint(fields=["attempt", "question"], name="uniq_attempt_question"),
        ]

    def __str__(self):
        return f"{self.attempt_id} - {self.question_id}"


class ActiveStreamSession(TimeStampedModel):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        REVOKED = "REVOKED", "Revoked"
        EXPIRED = "EXPIRED", "Expired"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="active_stream_session",
    )
    session_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    device_id = models.CharField(max_length=128)
    lesson = models.ForeignKey(Lesson, on_delete=models.CASCADE, related_name="active_streams")
    issued_at = models.DateTimeField(auto_now_add=True)
    last_heartbeat_at = models.DateTimeField()
    expires_at = models.DateTimeField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)

    class Meta:
        ordering = ["-issued_at"]
        indexes = [
            models.Index(fields=["status", "expires_at"]),
        ]

    def __str__(self):
        return f"{self.user_id} - {self.device_id} ({self.status})"
