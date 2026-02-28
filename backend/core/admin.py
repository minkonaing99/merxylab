from django.contrib import admin

from .models import (
    ActiveStreamSession,
    Course,
    Enrollment,
    Lesson,
    QuizAttempt,
    UserLessonProgress,
)

admin.site.register(Course)
admin.site.register(Lesson)
admin.site.register(Enrollment)
admin.site.register(UserLessonProgress)
admin.site.register(QuizAttempt)
admin.site.register(ActiveStreamSession)
