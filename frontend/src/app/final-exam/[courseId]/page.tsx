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
  certificate_blocked_reason?: string;
  charged_credits?: number;
  certificate: { certificate_code: string; issued_at: string } | null;
};
type RetryFeeLock = {
  required_credits: number;
  current_credits: number;
  failed_attempts?: number;
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
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [fullscreenExitedCount, setFullscreenExitedCount] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(
    typeof document !== "undefined" ? Boolean(document.fullscreenElement) : false,
  );
  const [pausedByFullscreenExit, setPausedByFullscreenExit] = useState(false);
  const [everEnteredFullscreen, setEverEnteredFullscreen] = useState(
    typeof document !== "undefined" ? Boolean(document.fullscreenElement) : false,
  );
  const [policyLocked, setPolicyLocked] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [pendingUnansweredCount, setPendingUnansweredCount] = useState(0);
  const [retryFeeLock, setRetryFeeLock] = useState<RetryFeeLock | null>(null);
  const [showFullscreenViolationModal, setShowFullscreenViolationModal] = useState(false);

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
    setRetryFeeLock(null);
    try {
      const res = await apiFetch<FinalExam>(`/courses/${courseId}/final-exam/`, {}, token);
      setExam(res);
    } catch (err) {
      if (err instanceof ApiError && err.status === 402 && err.payload && typeof err.payload === "object" && !Array.isArray(err.payload)) {
        const payload = err.payload as Record<string, unknown>;
        setRetryFeeLock({
          required_credits: Number(payload.required_credits ?? 0),
          current_credits: Number(payload.current_credits ?? 0),
          failed_attempts: Number(payload.failed_attempts ?? 0),
        });
        setError(err.message);
      } else {
        const message = err instanceof ApiError ? err.message : "Failed to load final exam.";
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }, [accessToken, courseId, pathname, router]);

  useEffect(() => {
    void loadExam();
  }, [loadExam]);

  const autoFailFinalExam = useCallback(async (reason: string) => {
    if (!exam || result || policyLocked) return;
    const token = accessToken || getAccessToken();
    if (!token) return;
    setPolicyLocked(true);
    setError(reason);
    setSubmitting(true);
    try {
      const payload = await apiFetch<SubmitResult>(
        `/courses/${courseId}/final-exam/submit/`,
        {
          method: "POST",
          body: JSON.stringify({
            answers: [],
          }),
        },
        token,
      );
      setResult(payload);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Auto-fail submit failed.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [accessToken, courseId, exam, policyLocked, result]);

  useEffect(() => {
    const forceFailForTabSwitching = async () => {
      await autoFailFinalExam("Auto-failed: more than 2 tab switches detected.");
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        setTabSwitchCount((v) => {
          const next = v + 1;
          if (next > 2) {
            void forceFailForTabSwitching();
          }
          return next;
        });
      }
    };
    const onFullscreenChange = () => {
      const next = Boolean(document.fullscreenElement);
      setIsFullscreen(next);
      if (next) {
        setEverEnteredFullscreen(true);
        setPausedByFullscreenExit(false);
      }
      if (!next) {
        setFullscreenExitedCount((v) => {
          const nextCount = v + 1;
          if (nextCount >= 2 && everEnteredFullscreen) {
            setShowFullscreenViolationModal(true);
          }
          return nextCount;
        });
        if (everEnteredFullscreen) {
          setPausedByFullscreenExit(true);
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [accessToken, autoFailFinalExam, courseId, everEnteredFullscreen, exam, policyLocked, result]);

  const enterFullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen();
      setPausedByFullscreenExit(false);
    } catch {
      // Ignore browser capability/permission error.
    }
  };

  const submitExam = async () => {
    if (!exam) return;
    const token = accessToken || getAccessToken();
    if (!token) return;
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

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!exam) return;
    const unansweredCount = exam.questions.filter((q) => answers[q.id] == null).length;
    if (unansweredCount > 0) {
      setPendingUnansweredCount(unansweredCount);
      setShowSubmitConfirm(true);
      return;
    }
    await submitExam();
  };

  return (
    <main className="page-wrap fade-up">
      <h1 className="text-3xl font-semibold md:text-4xl">Final Exam</h1>
      <p className="mt-2 text-sm muted">Pass this exam to become certificate-eligible.</p>
      {loading && <p className="mt-5 text-sm muted">Loading final exam...</p>}
      {error && <p className="mt-4 rounded-lg border border-red-300 bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}
      {exam && !result && !retryFeeLock && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-500/10 p-3 text-xs text-amber-700">
          <p>Anti-cheat monitoring: tab switches {tabSwitchCount}, fullscreen exits {fullscreenExitedCount}.</p>
          {!isFullscreen && (
            <button type="button" className="btn btn-secondary mt-2" onClick={enterFullscreen}>
              Enter Fullscreen
            </button>
          )}
        </div>
      )}

      {retryFeeLock && !result && (
        <section className="surface mt-6 p-5">
          <h2 className="text-lg font-semibold">Final Exam Locked</h2>
          <p className="mt-2 text-sm muted">
            You need to pay retry fee before the exam can be opened.
          </p>
          <p className="mt-2 text-sm">
            Required credits: <strong>{retryFeeLock.required_credits}</strong> | Current credits: <strong>{retryFeeLock.current_credits}</strong>
          </p>
          <div className="mt-4 flex gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => router.push("/profile")}>
              Back to Profile
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void loadExam()}>
              Refresh
            </button>
          </div>
        </section>
      )}

      {exam && !result && !retryFeeLock && !isFullscreen && (
        <section className="surface mt-6 p-5">
          <h2 className="text-lg font-semibold">{everEnteredFullscreen ? "Final Exam Paused" : "Fullscreen Required"}</h2>
          <p className="mt-2 text-sm muted">
            {everEnteredFullscreen
              ? "Fullscreen was exited. Re-enter fullscreen to continue the final exam."
              : "You must enter fullscreen before the final exam is shown."}
          </p>
          <button type="button" className="btn btn-primary mt-3" onClick={enterFullscreen}>
            {everEnteredFullscreen ? "Resume In Fullscreen" : "Start In Fullscreen"}
          </button>
        </section>
      )}
      {exam && !result && !retryFeeLock && pausedByFullscreenExit && isFullscreen && (
        <section className="surface mt-6 p-5">
          <h2 className="text-lg font-semibold">Final Exam Paused</h2>
          <p className="mt-2 text-sm muted">
            Fullscreen was exited. Re-enter fullscreen to continue the final exam.
          </p>
          <button type="button" className="btn btn-primary mt-3" onClick={enterFullscreen}>
            Resume In Fullscreen
          </button>
        </section>
      )}
      {exam && !result && !retryFeeLock && !pausedByFullscreenExit && isFullscreen && (
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
          {result.passed && !result.certificate && result.certificate_blocked_reason && (
            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-500/10 p-3 text-sm text-amber-700">
              {result.certificate_blocked_reason}
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
            {result.passed && result.certificate && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => router.push(`/certificates/${courseId}`)}
              >
                View Certification
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={() => router.push("/profile")}>
              Back to Profile
            </button>
          </div>
        </section>
      )}

      {showSubmitConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold">Unanswered Questions</h2>
            <p className="mt-2 text-sm muted">
              You have {pendingUnansweredCount} unanswered question(s). If you submit now, they will be counted as wrong.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setShowSubmitConfirm(false);
                  setPendingUnansweredCount(0);
                }}
              >
                Continue Exam
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  setShowSubmitConfirm(false);
                  await submitExam();
                }}
              >
                Submit Anyway
              </button>
            </div>
          </section>
        </div>
      )}

      {showFullscreenViolationModal && !result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-red-600">Policy Violation</h2>
            <p className="mt-2 text-sm muted">
              You exited fullscreen for the second time. This final exam attempt will be marked as failed.
            </p>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                className="btn btn-danger"
                onClick={async () => {
                  setShowFullscreenViolationModal(false);
                  await autoFailFinalExam("Auto-failed: fullscreen exited more than once.");
                }}
              >
                Acknowledge
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
