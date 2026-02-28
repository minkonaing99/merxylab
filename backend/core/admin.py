from django.contrib import admin

from .models import (
    ActiveStreamSession,
    Certificate,
    CreditTransaction,
    CreditWallet,
    Course,
    Enrollment,
    FinalExam,
    FinalExamAttempt,
    FinalExamChoice,
    FinalExamQuestion,
    Lesson,
    QuizAttempt,
    StudentProfile,
    UserLessonProgress,
)

admin.site.register(Course)
admin.site.register(Lesson)
admin.site.register(FinalExam)
admin.site.register(FinalExamQuestion)
admin.site.register(FinalExamChoice)
admin.site.register(FinalExamAttempt)
admin.site.register(Certificate)
admin.site.register(CreditWallet)
admin.site.register(CreditTransaction)
admin.site.register(Enrollment)
admin.site.register(StudentProfile)
admin.site.register(UserLessonProgress)
admin.site.register(QuizAttempt)
admin.site.register(ActiveStreamSession)
