import uuid

from django.conf import settings
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
    publish_at = models.DateTimeField(null=True, blank=True)
    unpublish_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return self.title


class Lesson(TimeStampedModel):
    class ContentType(models.TextChoices):
        VIDEO = "VIDEO", "Video"
        READING = "READING", "Reading"

    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name="lessons")
    section_title = models.CharField(max_length=255, default="Section 1")
    section_order = models.PositiveIntegerField(default=1)
    title = models.CharField(max_length=255)
    order = models.PositiveIntegerField(default=1)
    content_type = models.CharField(max_length=16, choices=ContentType.choices, default=ContentType.VIDEO)
    is_preview = models.BooleanField(default=False)
    hls_master_path = models.CharField(max_length=512, blank=True)
    reading_content = models.TextField(blank=True)
    duration_seconds = models.PositiveIntegerField(null=True, blank=True)
    quiz_payload = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["course_id", "section_order", "order", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["course", "section_order", "order"],
                name="uniq_lesson_course_section_order",
            ),
        ]

    def __str__(self):
        return f"{self.section_title} - {self.title}"


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


class StudentProfile(TimeStampedModel):
    class VerificationStatus(models.TextChoices):
        PENDING = "PENDING", "Pending"
        VERIFIED = "VERIFIED", "Verified"
        REJECTED = "REJECTED", "Rejected"

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="student_profile")
    full_name = models.CharField(max_length=255, blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    passport_number = models.CharField(max_length=64, blank=True)
    passport_photo = models.FileField(upload_to="verification/passports/", blank=True)
    phone_number = models.CharField(max_length=32, blank=True)
    country = models.CharField(max_length=120, blank=True)
    city = models.CharField(max_length=120, blank=True)
    address = models.TextField(blank=True)
    verification_status = models.CharField(
        max_length=16,
        choices=VerificationStatus.choices,
        default=VerificationStatus.PENDING,
    )
    verification_note = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["user_id"]

    def __str__(self):
        return f"profile:{self.user_id}"


class FinalExam(TimeStampedModel):
    course = models.OneToOneField(Course, on_delete=models.CASCADE, related_name="final_exam")
    title = models.CharField(max_length=255, default="Final Exam")
    passing_score = models.PositiveIntegerField(default=70)
    time_limit_sec = models.PositiveIntegerField(null=True, blank=True)
    is_published = models.BooleanField(default=False)

    class Meta:
        ordering = ["course_id"]

    def __str__(self):
        return f"final-exam:{self.course_id}"


class FinalExamQuestion(TimeStampedModel):
    exam = models.ForeignKey(FinalExam, on_delete=models.CASCADE, related_name="questions")
    prompt = models.TextField()
    order = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ["exam_id", "order", "id"]
        constraints = [
            models.UniqueConstraint(fields=["exam", "order"], name="uniq_final_exam_question_order"),
        ]

    def __str__(self):
        return f"final-q:{self.exam_id}:{self.order}"


class FinalExamChoice(TimeStampedModel):
    question = models.ForeignKey(FinalExamQuestion, on_delete=models.CASCADE, related_name="choices")
    text = models.CharField(max_length=500)
    is_correct = models.BooleanField(default=False)
    order = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ["question_id", "order", "id"]
        constraints = [
            models.UniqueConstraint(fields=["question", "order"], name="uniq_final_exam_choice_order"),
        ]

    def __str__(self):
        return f"final-c:{self.question_id}:{self.order}"


class FinalExamAttempt(TimeStampedModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="final_exam_attempts")
    exam = models.ForeignKey(FinalExam, on_delete=models.CASCADE, related_name="attempts")
    attempted_at = models.DateTimeField(auto_now_add=True)
    score = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    passed = models.BooleanField(default=False)
    answers_payload = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["-attempted_at"]
        indexes = [
            models.Index(fields=["user", "exam"]),
        ]

    def __str__(self):
        return f"final-attempt:{self.user_id}:{self.exam_id}:{self.score}"


class FinalExamSession(TimeStampedModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="final_exam_sessions")
    exam = models.ForeignKey(FinalExam, on_delete=models.CASCADE, related_name="active_sessions")
    question_ids = models.JSONField(default=list, blank=True)
    choice_order_map = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-updated_at"]
        constraints = [
            models.UniqueConstraint(fields=["user", "exam"], name="uniq_final_exam_session_user_exam"),
        ]
        indexes = [
            models.Index(fields=["user", "exam"]),
        ]

    def __str__(self):
        return f"final-session:{self.user_id}:{self.exam_id}"


class Certificate(TimeStampedModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="certificates")
    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name="certificates")
    exam_attempt = models.ForeignKey(FinalExamAttempt, on_delete=models.SET_NULL, null=True, blank=True, related_name="certificates")
    issued_at = models.DateTimeField(auto_now_add=True)
    certificate_code = models.CharField(max_length=32, unique=True)

    class Meta:
        ordering = ["-issued_at"]
        constraints = [
            models.UniqueConstraint(fields=["user", "course"], name="uniq_certificate_user_course"),
        ]

    def __str__(self):
        return f"cert:{self.user_id}:{self.course_id}:{self.certificate_code}"


class CreditWallet(TimeStampedModel):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="credit_wallet")
    balance_credits = models.IntegerField(default=0)

    class Meta:
        ordering = ["user_id"]

    def __str__(self):
        return f"wallet:{self.user_id}:{self.balance_credits}"


class CreditTransaction(TimeStampedModel):
    class Kind(models.TextChoices):
        ADMIN_ADJUST = "ADMIN_ADJUST", "Admin Adjust"
        COURSE_PURCHASE = "COURSE_PURCHASE", "Course Purchase"
        REFUND = "REFUND", "Refund"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="credit_transactions")
    amount = models.IntegerField()
    balance_after = models.IntegerField()
    kind = models.CharField(max_length=32, choices=Kind.choices)
    note = models.CharField(max_length=255, blank=True)
    course = models.ForeignKey(Course, on_delete=models.SET_NULL, null=True, blank=True, related_name="credit_transactions")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_credit_transactions",
    )

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["user", "created_at"]),
        ]

    def __str__(self):
        return f"credit-tx:{self.user_id}:{self.kind}:{self.amount}"


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


class QuizAttempt(TimeStampedModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="quiz_attempts")
    lesson = models.ForeignKey(Lesson, on_delete=models.CASCADE, related_name="quiz_attempts")
    attempted_at = models.DateTimeField(auto_now_add=True)
    score = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    passed = models.BooleanField(default=False)
    answers_payload = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["-attempted_at"]
        indexes = [
            models.Index(fields=["user", "lesson"]),
        ]

    def __str__(self):
        return f"{self.user_id} - {self.lesson_id} ({self.score})"


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


class EndpointRateLimit(TimeStampedModel):
    scope = models.CharField(max_length=64)
    subject_key = models.CharField(max_length=255)
    window_started_at = models.DateTimeField()
    attempt_count = models.PositiveIntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["scope", "subject_key"], name="uniq_rate_limit_scope_subject"),
        ]
        indexes = [
            models.Index(fields=["scope", "locked_until"]),
        ]

    def __str__(self):
        return f"rate-limit:{self.scope}:{self.subject_key}:{self.attempt_count}"


class VideoTranscodeJob(TimeStampedModel):
    class Status(models.TextChoices):
        QUEUED = "QUEUED", "Queued"
        PROCESSING = "PROCESSING", "Processing"
        RETRYING = "RETRYING", "Retrying"
        COMPLETED = "COMPLETED", "Completed"
        FAILED = "FAILED", "Failed"

    lesson = models.ForeignKey(Lesson, on_delete=models.CASCADE, related_name="video_jobs")
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="video_jobs",
    )
    source_file = models.CharField(max_length=512)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.QUEUED)
    progress_percent = models.PositiveSmallIntegerField(default=0)
    attempt_count = models.PositiveIntegerField(default=0)
    max_attempts = models.PositiveIntegerField(default=3)
    task_id = models.CharField(max_length=128, blank=True)
    error_message = models.TextField(blank=True)
    output_hls_master_path = models.CharField(max_length=512, blank=True)
    output_duration_seconds = models.PositiveIntegerField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["status", "created_at"]),
            models.Index(fields=["lesson", "status"]),
        ]

    def __str__(self):
        return f"video-job:{self.id}:{self.lesson_id}:{self.status}"
