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
        const courseLessons = await apiFetch<CourseLessonsPayload>(
          `/courses/${lessonMeta.course_id}/lessons/`,
          {},
          token,
        );
        const ordered = courseLessons.lessons;
        const currentIdx = ordered.findIndex((lesson) => lesson.id === lessonId);
        setNextLessonId(currentIdx >= 0 && currentIdx < ordered.length - 1 ? ordered[currentIdx + 1].id : null);
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
    if (!accessToken) {
      setError("Please login first.");
      return;
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
        accessToken,
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
    router.push("/dashboard");
  };

  if (!accessToken && !getAccessToken()) {
    return <main className="mx-auto w-full max-w-4xl px-4 py-8">Redirecting to login...</main>;
  }

  if (loading) {
    return <main className="mx-auto w-full max-w-4xl px-4 py-8">Loading quiz...</main>;
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Lesson Quiz</h1>
      {error && <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {quiz && !result && (
        <form onSubmit={submit} className="mt-6 space-y-4">
          {quiz.questions.map((question) => (
            <section key={question.id} className="rounded-xl border border-slate-200 bg-white p-5">
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
          <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">Submit Quiz</button>
        </form>
      )}

      {result && (
        <section
          className={`mt-6 rounded-xl border p-5 ${
            result.passed ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"
          }`}
        >
          <h2 className="text-lg font-semibold">Result</h2>
          <p className="mt-2 text-sm">
            Score: <strong>{result.score}%</strong> | Status: <strong>{result.passed ? "Passed" : "Failed"}</strong>
          </p>
          <p className="mt-1 text-sm text-slate-700">
            Correct: {result.summary.correct_answers}/{result.summary.total_questions}
          </p>
          <div className="mt-4">
            {result.passed ? (
              <button
                type="button"
                onClick={goNext}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
              >
                Next Lesson
              </button>
            ) : (
              <button
                type="button"
                onClick={retryQuiz}
                className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white"
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
