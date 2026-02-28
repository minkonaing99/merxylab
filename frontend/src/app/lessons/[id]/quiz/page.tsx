"use client";

import { useParams, usePathname, useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { useAccessToken } from "@/hooks/use-access-token";

type Choice = {
  id: number;
  text: string;
};

type Question = {
  id: number;
  prompt: string;
  order: number;
  choices: Choice[];
};

type Quiz = {
  id: number;
  passing_score: number;
  questions: Question[];
};

type AttemptResult = {
  score: string;
  passed: boolean;
  summary: {
    correct_answers: number;
    total_questions: number;
  };
};

type LessonMeta = {
  id: number;
  course_id: number;
};

type CourseLessonsPayload = {
  lessons: Array<{ id: number }>;
};
type ExamEligibility = {
  can_take_final_exam: boolean;
};

export default function LessonQuizPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ id: string }>();
  const lessonId = useMemo(() => Number(params.id), [params.id]);
  const accessToken = useAccessToken();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [nextLessonId, setNextLessonId] = useState<number | null>(null);
  const [courseId, setCourseId] = useState<number | null>(null);
  const [examEligibility, setExamEligibility] = useState<ExamEligibility | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(accessToken));

  useEffect(() => {
    const token = accessToken || getAccessToken();
    if (!token) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }

    Promise.all([
      apiFetch<Quiz>(`/lessons/${lessonId}/quiz/`, {}, token),
      apiFetch<LessonMeta>(`/lessons/${lessonId}/`, {}, token),
    ])
      .then(async ([quizPayload, lessonMeta]) => {
        setQuiz(quizPayload);
        setCourseId(lessonMeta.course_id);
        const courseLessons = await apiFetch<CourseLessonsPayload>(
          `/courses/${lessonMeta.course_id}/lessons/`,
          {},
          token,
        );
        const ordered = courseLessons.lessons;
        const currentIdx = ordered.findIndex((lesson) => lesson.id === lessonId);
        setNextLessonId(currentIdx >= 0 && currentIdx < ordered.length - 1 ? ordered[currentIdx + 1].id : null);
        try {
          const eligibility = await apiFetch<ExamEligibility>(
            `/courses/${lessonMeta.course_id}/exam-eligibility/`,
            {},
            token,
          );
          setExamEligibility(eligibility);
        } catch {
          setExamEligibility(null);
        }
      })
      .catch((err) => {
        const message = err instanceof ApiError ? err.message : "Could not load quiz.";
        setError(message);
      })
      .finally(() => setLoading(false));
  }, [lessonId, accessToken, pathname, router]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!quiz) {
      return;
    }
    const token = accessToken || getAccessToken();
    if (!token) {
      setError("Please login first.");
      return;
    }
    const unansweredCount = quiz.questions.filter((q) => answers[q.id] == null).length;
    if (unansweredCount > 0) {
      const proceed = window.confirm(
        `You have ${unansweredCount} unanswered question(s). If you submit now, they will be counted as wrong.`,
      );
      if (!proceed) return;
    }
    setError("");
    try {
      const payload = await apiFetch<AttemptResult>(
        `/quizzes/${quiz.id}/submit/`,
        {
          method: "POST",
          body: JSON.stringify({
            answers: Object.entries(answers).map(([questionId, choiceId]) => ({
              question_id: Number(questionId),
              choice_id: Number(choiceId),
            })),
          }),
        },
        token,
      );
      setResult(payload);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Quiz submit failed.";
      setError(message);
    }
  };

  const retryQuiz = () => {
    setResult(null);
    setAnswers({});
    setError("");
  };

  const goNext = () => {
    if (nextLessonId) {
      router.push(`/lessons/${nextLessonId}`);
      return;
    }
    if (courseId && examEligibility?.can_take_final_exam) {
      router.push(`/final-exam/${courseId}`);
      return;
    }
    router.push("/dashboard");
  };

  if (!accessToken && !getAccessToken()) {
    return <main className="page-wrap">Redirecting to login...</main>;
  }

  if (loading) {
    return <main className="page-wrap">Loading quiz...</main>;
  }

  return (
    <main className="page-wrap fade-up">
      <h1 className="text-2xl font-semibold md:text-3xl">Lesson Quiz</h1>
      {error && <p className="mt-4 rounded-lg border border-red-300 bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}
      {quiz && !result && (
        <form onSubmit={submit} className="mt-6 space-y-4">
          {quiz.questions.map((question) => (
            <section key={question.id} className="surface p-5">
              <h2 className="font-medium">
                {question.order}. {question.prompt}
              </h2>
              <div className="mt-3 space-y-2">
                {question.choices.map((choice) => (
                  <label key={choice.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={`q-${question.id}`}
                      checked={answers[question.id] === choice.id}
                      onChange={() => setAnswers((prev) => ({ ...prev, [question.id]: choice.id }))}
                    />
                    {choice.text}
                  </label>
                ))}
              </div>
            </section>
          ))}
          <button className="btn btn-primary">Submit Quiz</button>
        </form>
      )}

      {result && (
        <section
          className={`mt-6 rounded-xl border p-5 ${
            result.passed ? "border-emerald-300 bg-emerald-500/10" : "border-red-300 bg-red-500/10"
          }`}
        >
          <h2 className="text-lg font-semibold">Result</h2>
          <p className="mt-2 text-sm">
            Score: <strong>{result.score}%</strong> | Status: <strong>{result.passed ? "Passed" : "Failed"}</strong>
          </p>
          <p className="mt-1 text-sm muted">
            Correct: {result.summary.correct_answers}/{result.summary.total_questions}
          </p>
          <div className="mt-4">
            {result.passed ? (
              <button
                type="button"
                onClick={goNext}
                className="btn btn-primary"
              >
                {nextLessonId ? "Next Lesson" : examEligibility?.can_take_final_exam ? "Take Final Exam" : "Back to Dashboard"}
              </button>
            ) : (
              <button
                type="button"
                onClick={retryQuiz}
                className="btn btn-danger"
              >
                Retry Quiz
              </button>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
