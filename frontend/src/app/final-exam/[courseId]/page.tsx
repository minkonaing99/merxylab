"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { useAccessToken } from "@/hooks/use-access-token";

type Choice = { id: number; text: string; order: number };
type Question = { id: number; prompt: string; order: number; choices: Choice[] };
type FinalExam = {
  id: number;
  course_id: number;
  title: string;
  passing_score: number;
  time_limit_sec: number | null;
  questions: Question[];
  retry_fee_credits?: number;
  retry_fee_required?: boolean;
  failed_attempts?: number;
  current_credits?: number;
};

type SubmitResult = {
  score: string;
  passed: boolean;
  summary: { total_questions: number; correct_answers: number; passing_score: number };
  certificate_issued: boolean;
  certificate_created: boolean;
  charged_credits?: number;
  certificate: { certificate_code: string; issued_at: string } | null;
};

export default function CourseFinalExamPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ courseId: string }>();
  const courseId = useMemo(() => Number(params.courseId), [params.courseId]);
  const accessToken = useAccessToken();
  const [exam, setExam] = useState<FinalExam | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const loadExam = useCallback(async () => {
    const token = accessToken || getAccessToken();
    if (!token) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    if (!Number.isFinite(courseId)) {
      setError("Invalid course.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch<FinalExam>(`/courses/${courseId}/final-exam/`, {}, token);
      setExam(res);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to load final exam.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [accessToken, courseId, pathname, router]);

  useEffect(() => {
    void loadExam();
  }, [loadExam]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!exam) return;
    const token = accessToken || getAccessToken();
    if (!token) return;
    const unansweredCount = exam.questions.filter((q) => answers[q.id] == null).length;
    if (unansweredCount > 0) {
      const proceed = window.confirm(
        `You have ${unansweredCount} unanswered question(s). If you submit now, they will be counted as wrong.`,
      );
      if (!proceed) return;
    }
    setSubmitting(true);
    setError("");
    try {
      const payload = await apiFetch<SubmitResult>(
        `/courses/${courseId}/final-exam/submit/`,
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
      const message = err instanceof ApiError ? err.message : "Failed to submit final exam.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="page-wrap fade-up">
      <h1 className="text-3xl font-semibold md:text-4xl">Final Exam</h1>
      <p className="mt-2 text-sm muted">Pass this exam to become certificate-eligible.</p>
      {loading && <p className="mt-5 text-sm muted">Loading final exam...</p>}
      {error && <p className="mt-4 rounded-lg border border-red-300 bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}

      {exam && !result && (
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <section className="surface p-5">
            <h2 className="text-xl font-semibold">{exam.title}</h2>
            <p className="mt-2 text-sm muted">
              Passing score: {exam.passing_score}% {exam.time_limit_sec ? `| Time limit: ${exam.time_limit_sec}s` : ""}
            </p>
            {exam.retry_fee_required && (
              <p className="mt-2 rounded border border-amber-300 bg-amber-500/10 p-2 text-xs text-amber-700">
                Retry fee active: {exam.retry_fee_credits ?? 50} credits per attempt after 3 failures.
                {" "}
                Current credits: {exam.current_credits ?? 0}.
              </p>
            )}
          </section>
          {exam.questions.map((question) => (
            <section key={question.id} className="surface p-5">
              <h3 className="font-medium">{question.order}. {question.prompt}</h3>
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
          <button className="btn btn-primary" disabled={submitting}>
            {submitting ? "Submitting..." : "Submit Final Exam"}
          </button>
        </form>
      )}

      {result && (
        <section className={`mt-6 rounded-xl border p-5 ${result.passed ? "border-emerald-300 bg-emerald-500/10" : "border-red-300 bg-red-500/10"}`}>
          <h2 className="text-xl font-semibold">Final Exam Result</h2>
          <p className="mt-2 text-sm">
            Score: <strong>{result.score}%</strong> | Status: <strong>{result.passed ? "Passed" : "Failed"}</strong>
          </p>
          <p className="mt-1 text-sm muted">
            Correct: {result.summary.correct_answers}/{result.summary.total_questions}
          </p>
          {result.certificate && (
            <div className="mt-4 rounded-lg border border-emerald-300 bg-emerald-500/10 p-3 text-sm">
              <p>
                Certificate code: <strong>{result.certificate.certificate_code}</strong>
              </p>
              <p className="muted">Issued at: {new Date(result.certificate.issued_at).toLocaleString()}</p>
            </div>
          )}
          <div className="mt-4 flex gap-2">
            {!result.passed && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  setResult(null);
                  setAnswers({});
                  void loadExam();
                }}
              >
                Retry Final Exam
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={() => router.push("/profile")}>
              Back to Profile
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
