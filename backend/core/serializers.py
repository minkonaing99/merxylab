from rest_framework import serializers

from core.models import (
    Certificate,
    Course,
    CreditTransaction,
    CreditWallet,
    Enrollment,
    FinalExam,
    FinalExamAttempt,
    Lesson,
    QuizAttempt,
    StudentProfile,
    UserLessonProgress,
)


class LessonAccessSerializer(serializers.ModelSerializer):
    locked = serializers.SerializerMethodField()
    section_id = serializers.SerializerMethodField()

    class Meta:
        model = Lesson
        fields = [
            "id",
            "section_id",
            "course_id",
            "title",
            "order",
            "content_type",
            "is_preview",
            "duration_seconds",
            "hls_master_path",
            "locked",
        ]

    def get_locked(self, obj):
        if obj.is_preview:
            return False
        unlocked_ids = self.context.get("unlocked_lesson_ids", set())
        return obj.id not in unlocked_ids

    def get_section_id(self, obj):
        return obj.section_order


class CourseListSerializer(serializers.ModelSerializer):
    class Meta:
        model = Course
        fields = [
            "id",
            "title",
            "slug",
            "description",
            "level",
            "price_cents",
            "thumbnail_url",
            "is_published",
        ]


class CourseDetailSerializer(CourseListSerializer):
    sections = serializers.SerializerMethodField()

    class Meta(CourseListSerializer.Meta):
        fields = CourseListSerializer.Meta.fields + ["sections"]

    def get_sections(self, obj):
        lessons = list(
            obj.lessons.all().order_by("section_order", "order", "id")
        )
        unlocked_ids = self.context.get("unlocked_lesson_ids", set())

        grouped = {}
        for lesson in lessons:
            key = lesson.section_order
            grouped.setdefault(
                key,
                {
                    "id": key,
                    "course_id": obj.id,
                    "title": lesson.section_title,
                    "order": lesson.section_order,
                    "lessons": [],
                },
            )
            grouped[key]["lessons"].append(
                LessonAccessSerializer(
                    lesson,
                    context={"unlocked_lesson_ids": unlocked_ids},
                ).data
            )

        return [grouped[key] for key in sorted(grouped.keys())]


class EnrollmentSerializer(serializers.ModelSerializer):
    course = CourseListSerializer(read_only=True)

    class Meta:
        model = Enrollment
        fields = [
            "id",
            "course",
            "status",
            "enrolled_at",
            "expires_at",
            "payment_provider",
            "payment_ref",
        ]


class StudentProfileSerializer(serializers.ModelSerializer):
    passport_photo_url = serializers.SerializerMethodField()

    class Meta:
        model = StudentProfile
        fields = [
            "full_name",
            "date_of_birth",
            "passport_number",
            "passport_photo",
            "passport_photo_url",
            "phone_number",
            "country",
            "city",
            "address",
            "verification_status",
            "verification_note",
            "updated_at",
        ]
        read_only_fields = [
            "verification_status",
            "verification_note",
            "updated_at",
        ]
        extra_kwargs = {
            "passport_photo": {"write_only": True, "required": False},
        }

    def get_passport_photo_url(self, obj):
        if not obj.passport_photo:
            return ""
        request = self.context.get("request")
        url = obj.passport_photo.url
        return request.build_absolute_uri(url) if request else url

    def validate_passport_photo(self, value):
        if not value:
            return value
        filename = value.name.lower()
        allowed = (".jpg", ".jpeg", ".png", ".webp")
        if not filename.endswith(allowed):
            raise serializers.ValidationError("Supported formats: .jpg, .jpeg, .png, .webp")
        max_size = 5 * 1024 * 1024
        if getattr(value, "size", 0) > max_size:
            raise serializers.ValidationError("Passport photo must be 5MB or smaller.")
        return value


class LessonDetailSerializer(serializers.ModelSerializer):
    has_quiz = serializers.SerializerMethodField()
    section_id = serializers.SerializerMethodField()

    class Meta:
        model = Lesson
        fields = [
            "id",
            "course_id",
            "section_id",
            "title",
            "order",
            "content_type",
            "is_preview",
            "hls_master_path",
            "reading_content",
            "duration_seconds",
            "has_quiz",
        ]

    def get_has_quiz(self, obj):
        if "has_quiz" in self.context:
            return bool(self.context["has_quiz"])
        return bool(obj.quiz_payload and obj.quiz_payload.get("questions"))

    def get_section_id(self, obj):
        return obj.section_order


class UserLessonProgressSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserLessonProgress
        fields = [
            "lesson_id",
            "last_position_seconds",
            "completed",
            "updated_at",
        ]


class UserLessonProgressUpsertSerializer(serializers.Serializer):
    last_position_seconds = serializers.IntegerField(min_value=0)
    completed = serializers.BooleanField(required=False, default=False)


class StreamAccessSerializer(serializers.Serializer):
    device_id = serializers.CharField(max_length=128)


class StreamHeartbeatSerializer(serializers.Serializer):
    session_id = serializers.UUIDField()
    device_id = serializers.CharField(max_length=128)
    lesson_id = serializers.IntegerField(min_value=1)


class QuizSubmitAnswerSerializer(serializers.Serializer):
    question_id = serializers.IntegerField(min_value=1)
    choice_id = serializers.IntegerField(min_value=1)


class QuizSubmitSerializer(serializers.Serializer):
    answers = QuizSubmitAnswerSerializer(many=True, allow_empty=False)


class QuizAttemptSerializer(serializers.ModelSerializer):
    quiz_id = serializers.SerializerMethodField()
    answers = serializers.SerializerMethodField()

    class Meta:
        model = QuizAttempt
        fields = ["id", "quiz_id", "attempted_at", "score", "passed", "answers"]

    def get_quiz_id(self, obj):
        return obj.lesson_id

    def get_answers(self, obj):
        return obj.answers_payload or []


class AdminSectionSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    course_id = serializers.IntegerField()
    title = serializers.CharField()
    order = serializers.IntegerField()


class AdminCourseCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Course
        fields = [
            "id",
            "title",
            "description",
            "slug",
            "level",
            "price_cents",
            "thumbnail_url",
            "is_published",
        ]


class AdminCourseUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Course
        fields = [
            "title",
            "description",
            "slug",
            "level",
            "price_cents",
            "thumbnail_url",
            "is_published",
        ]


class AdminLessonCreateSerializer(serializers.Serializer):
    course_id = serializers.IntegerField(min_value=1)
    section_id = serializers.IntegerField(min_value=1, required=False)
    section_title = serializers.CharField(max_length=255, required=False, allow_blank=False)
    section_order = serializers.IntegerField(min_value=1, required=False)
    title = serializers.CharField(max_length=255)
    order = serializers.IntegerField(min_value=1)
    content_type = serializers.ChoiceField(choices=Lesson.ContentType.choices, default=Lesson.ContentType.VIDEO)
    is_preview = serializers.BooleanField(default=False)
    hls_master_path = serializers.CharField(max_length=512, required=False, allow_blank=True, default="")
    reading_content = serializers.CharField(required=False, allow_blank=True, default="")
    duration_seconds = serializers.IntegerField(min_value=0, required=False, allow_null=True)

    def validate(self, attrs):
        if "section_id" not in attrs and "section_title" not in attrs:
            raise serializers.ValidationError("Provide either section_id or section_title.")
        if "section_title" in attrs and "section_order" not in attrs:
            raise serializers.ValidationError("section_order is required when section_title is provided.")
        return attrs


class AdminQuizChoiceInputSerializer(serializers.Serializer):
    text = serializers.CharField(max_length=500)
    is_correct = serializers.BooleanField(default=False)


class AdminQuizQuestionInputSerializer(serializers.Serializer):
    prompt = serializers.CharField()
    type = serializers.ChoiceField(choices=[("MCQ", "Multiple Choice")], default="MCQ")
    order = serializers.IntegerField(min_value=1)
    choices = AdminQuizChoiceInputSerializer(many=True, allow_empty=False)


class AdminQuizCreateSerializer(serializers.Serializer):
    lesson_id = serializers.IntegerField(min_value=1)
    passing_score = serializers.IntegerField(min_value=0, max_value=100, required=False, default=70)
    time_limit_sec = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    questions = AdminQuizQuestionInputSerializer(many=True, allow_empty=False)


class AdminUploadHlsMetadataSerializer(serializers.Serializer):
    lesson_id = serializers.IntegerField(min_value=1)
    hls_master_path = serializers.CharField(max_length=512)
    duration_seconds = serializers.IntegerField(min_value=0, required=False, allow_null=True)


class AdminUploadVideoSerializer(serializers.Serializer):
    lesson_id = serializers.IntegerField(min_value=1)
    video = serializers.FileField()

    def validate_video(self, value):
        filename = value.name.lower()
        if not filename.endswith((".mp4", ".mov", ".mkv", ".webm")):
            raise serializers.ValidationError("Supported formats: .mp4, .mov, .mkv, .webm")
        return value


class AdminLessonUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Lesson
        fields = [
            "title",
            "order",
            "content_type",
            "is_preview",
            "reading_content",
            "duration_seconds",
        ]


class AdminQuizUpdateSerializer(serializers.Serializer):
    passing_score = serializers.IntegerField(min_value=0, max_value=100, required=False)
    time_limit_sec = serializers.IntegerField(min_value=1, required=False, allow_null=True)


class AdminFinalExamChoiceInputSerializer(serializers.Serializer):
    text = serializers.CharField(max_length=500)
    is_correct = serializers.BooleanField(default=False)
    order = serializers.IntegerField(min_value=1)


class AdminFinalExamQuestionInputSerializer(serializers.Serializer):
    prompt = serializers.CharField()
    order = serializers.IntegerField(min_value=1)
    choices = AdminFinalExamChoiceInputSerializer(many=True, allow_empty=False)

    def validate_choices(self, value):
        if len(value) < 2:
            raise serializers.ValidationError("Each question must have at least 2 choices.")
        if not any(choice.get("is_correct") for choice in value):
            raise serializers.ValidationError("Each question must have at least one correct choice.")
        return value


class AdminFinalExamUpsertSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255, required=False, default="Final Exam")
    passing_score = serializers.IntegerField(min_value=0, max_value=100, required=False, default=70)
    time_limit_sec = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    is_published = serializers.BooleanField(required=False, default=False)
    questions = AdminFinalExamQuestionInputSerializer(many=True, allow_empty=False)


class FinalExamChoiceSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    text = serializers.CharField()
    order = serializers.IntegerField()


class FinalExamQuestionSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    prompt = serializers.CharField()
    order = serializers.IntegerField()
    choices = FinalExamChoiceSerializer(many=True)


class FinalExamSerializer(serializers.ModelSerializer):
    course_id = serializers.IntegerField(source="course.id", read_only=True)
    questions = serializers.SerializerMethodField()

    class Meta:
        model = FinalExam
        fields = [
            "id",
            "course_id",
            "title",
            "passing_score",
            "time_limit_sec",
            "is_published",
            "questions",
        ]

    def get_questions(self, obj):
        include_answers = bool(self.context.get("include_answers", False))
        rows = []
        for question in obj.questions.all().order_by("order", "id"):
            choices = []
            for choice in question.choices.all().order_by("order", "id"):
                item = {"id": choice.id, "text": choice.text, "order": choice.order}
                if include_answers:
                    item["is_correct"] = bool(choice.is_correct)
                choices.append(item)
            rows.append(
                {
                    "id": question.id,
                    "prompt": question.prompt,
                    "order": question.order,
                    "choices": choices,
                }
            )
        return rows


class FinalExamSubmitAnswerSerializer(serializers.Serializer):
    question_id = serializers.IntegerField(min_value=1)
    choice_id = serializers.IntegerField(min_value=1)


class FinalExamSubmitSerializer(serializers.Serializer):
    answers = FinalExamSubmitAnswerSerializer(many=True, allow_empty=False)


class FinalExamAttemptSerializer(serializers.ModelSerializer):
    exam_id = serializers.IntegerField(source="exam.id", read_only=True)
    course_id = serializers.IntegerField(source="exam.course_id", read_only=True)

    class Meta:
        model = FinalExamAttempt
        fields = ["id", "exam_id", "course_id", "attempted_at", "score", "passed", "answers_payload"]


class CertificateSerializer(serializers.ModelSerializer):
    course_id = serializers.IntegerField(source="course.id", read_only=True)
    exam_attempt_id = serializers.IntegerField(source="exam_attempt.id", read_only=True)

    class Meta:
        model = Certificate
        fields = ["id", "course_id", "exam_attempt_id", "issued_at", "certificate_code"]


class CreditTransactionSerializer(serializers.ModelSerializer):
    course_title = serializers.CharField(source="course.title", read_only=True)
    created_by_username = serializers.CharField(source="created_by.username", read_only=True)

    class Meta:
        model = CreditTransaction
        fields = [
            "id",
            "amount",
            "balance_after",
            "kind",
            "note",
            "course",
            "course_title",
            "created_by",
            "created_by_username",
            "created_at",
        ]


class CreditWalletSerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(source="user.id", read_only=True)
    username = serializers.CharField(source="user.username", read_only=True)

    class Meta:
        model = CreditWallet
        fields = ["user_id", "username", "balance_credits", "updated_at"]


class AdminCreditAdjustSerializer(serializers.Serializer):
    amount = serializers.IntegerField()
    note = serializers.CharField(required=False, allow_blank=True, max_length=255)


class AdminStudentListRowSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    username = serializers.CharField()
    email = serializers.CharField(allow_blank=True)
    role = serializers.CharField()
    credits = serializers.IntegerField()
    enrollments = serializers.IntegerField()
    owned_courses = serializers.ListField(child=serializers.CharField(), required=False)
