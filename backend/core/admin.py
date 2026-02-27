from django.contrib import admin

from .models import (
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

admin.site.register(Course)
admin.site.register(Section)
admin.site.register(Lesson)
admin.site.register(Enrollment)
admin.site.register(UserLessonProgress)
admin.site.register(Quiz)
admin.site.register(QuizQuestion)
admin.site.register(QuizChoice)
admin.site.register(QuizAttempt)
admin.site.register(QuizAttemptAnswer)
admin.site.register(ActiveStreamSession)
