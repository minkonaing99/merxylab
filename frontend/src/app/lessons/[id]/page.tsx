"use client";

import Hls from "hls.js";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { API_ORIGIN, apiFetch, ApiError } from "@/lib/api";
import { getAccessToken, getOrCreateDeviceId } from "@/lib/auth";
import { useAccessToken } from "@/hooks/use-access-token";

type Lesson = {
  id: number;
  course_id: number;
  course_title: string;
  course_slug: string;
  title: string;
  content_type: "VIDEO" | "READING";
  reading_content: string;
  is_preview: boolean;
  duration_seconds: number | null;
  has_quiz: boolean;
};

type StreamPayload = {
  session_id: string;
  playback_token: string;
  playback_url: string;
};

type ProgressPayload = {
  last_position_seconds: number;
  completed: boolean;
};

type CourseLessonsPayload = {
  lessons: Array<{ id: number }>;
};
type ExamEligibility = {
  can_take_final_exam: boolean;
  final_exam_exists?: boolean;
  next_step?: string;
};

export default function LessonPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ id: string }>();
  const lessonId = useMemo(() => Number(params.id), [params.id]);
  const accessToken = useAccessToken();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [stream, setStream] = useState<StreamPayload | null>(null);
  const [nextLessonId, setNextLessonId] = useState<number | null>(null);
  const [status, setStatus] = useState("Loading...");
  const [error, setError] = useState("");
  const [watchPercent, setWatchPercent] = useState(0);
  const [examEligibility, setExamEligibility] = useState<ExamEligibility | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const deviceIdRef = useRef<string>("");
  const progressKey = useMemo(() => {
    const token = accessToken || getAccessToken();
    const fallback = `lesson-progress-anon-${lessonId}`;
    if (!token || typeof window === "undefined") return fallback;
    try {
      const payloadBase64 = token.split(".")[1];
      if (!payloadBase64) return fallback;
      const normalized = payloadBase64.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
      const decoded = window.atob(padded);
      const payload = JSON.parse(decoded) as { user_id?: number | string; sub?: number | string };
      const userScope = payload.user_id ?? payload.sub;
      return userScope ? `lesson-progress-user-${String(userScope)}-${lessonId}` : fallback;
    } catch {
      return fallback;
    }
  }, [accessToken, lessonId]);

  const getEffectiveDuration = useCallback(() => {
    const knownDuration = lesson?.duration_seconds ?? null;
    const playerDuration =
      videoRef.current && Number.isFinite(videoRef.current.duration) ? videoRef.current.duration : 0;
    return knownDuration && knownDuration > 0 ? knownDuration : playerDuration;
  }, [lesson?.duration_seconds]);

  const persistLocalProgress = useCallback((seconds: number) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(progressKey, String(Math.max(0, Math.floor(seconds))));
  }, [progressKey]);

  const syncProgress = useCallback(async (completedOverride?: boolean) => {
    if (!lesson || !accessToken || !videoRef.current) return;
    const current = Math.floor(videoRef.current.currentTime || 0);
    const effectiveDuration = getEffectiveDuration();
    const playbackPosition = videoRef.current.currentTime || 0;
    const playbackCompleted = effectiveDuration > 0 && (videoRef.current.ended || playbackPosition >= effectiveDuration);
    const reachedNinetyPercent = effectiveDuration > 0 && playbackPosition >= effectiveDuration * 0.9;
    const completed =
      typeof completedOverride === "boolean"
        ? completedOverride
        : lesson.has_quiz
          ? effectiveDuration > 0 && (videoRef.current.currentTime || 0) >= effectiveDuration * 0.95
          : reachedNinetyPercent || playbackCompleted;
    persistLocalProgress(current);
    await apiFetch(
      `/lessons/${lesson.id}/progress/`,
      {
        method: "POST",
        body: JSON.stringify({
          last_position_seconds: current,
          completed,
        }),
      },
      accessToken,
    );
  }, [accessToken, getEffectiveDuration, lesson, persistLocalProgress]);

  const markCompleted = async () => {
    await syncProgress(true);
    if (lesson && accessToken) {
      try {
        const eligibility = await apiFetch<ExamEligibility>(
          `/courses/${lesson.course_id}/exam-eligibility/`,
          {},
          accessToken,
        );
        setExamEligibility(eligibility);
      } catch {
        setExamEligibility(null);
      }
    }
  };

  useEffect(() => {
    if (!accessToken && !getAccessToken()) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
  }, [accessToken, pathname, router]);

  useEffect(() => {
    const token = accessToken || getAccessToken();
    if (!token) {
      return;
    }
    if (!Number.isFinite(lessonId)) {
      return;
    }
    apiFetch<Lesson>(`/lessons/${lessonId}/`, {}, token)
      .then(setLesson)
      .catch((err) => {
        const message = err instanceof ApiError ? err.message : "Failed to load lesson.";
        setError(message);
        setStatus("Unavailable");
      });
  }, [lessonId, accessToken]);

  useEffect(() => {
    if (!lesson || !accessToken) return;
    apiFetch<CourseLessonsPayload>(`/courses/${lesson.course_id}/lessons/`, {}, accessToken)
      .then((payload) => {
        const ordered = payload.lessons;
        const currentIdx = ordered.findIndex((item) => item.id === lesson.id);
        setNextLessonId(currentIdx >= 0 && currentIdx < ordered.length - 1 ? ordered[currentIdx + 1].id : null);
      })
      .catch(() => {
        setNextLessonId(null);
      });
  }, [lesson, accessToken]);

  useEffect(() => {
    if (!lesson || !accessToken) return;
    apiFetch<ExamEligibility>(`/courses/${lesson.course_id}/exam-eligibility/`, {}, accessToken)
      .then(setExamEligibility)
      .catch(() => setExamEligibility(null));
  }, [lesson, accessToken]);

  useEffect(() => {
    if (!lesson || lesson.content_type !== "READING" || !accessToken) {
      return;
    }
    void apiFetch(
      `/lessons/${lesson.id}/progress/`,
      { method: "POST", body: JSON.stringify({ last_position_seconds: 0, completed: true }) },
      accessToken,
    );
  }, [lesson, accessToken]);

  useEffect(() => {
    if (!lesson) {
      return;
    }
    if (lesson.content_type !== "VIDEO") {
      return;
    }

    if (!accessToken) {
      return;
    }

    const deviceId = getOrCreateDeviceId();
    deviceIdRef.current = deviceId;

    const start = async () => {
      try {
        const progress = await apiFetch<ProgressPayload>(`/lessons/${lesson.id}/progress/`, {}, accessToken);
        const streamData = await apiFetch<StreamPayload>(
          `/lessons/${lesson.id}/stream-access/`,
          { method: "POST", body: JSON.stringify({ device_id: deviceId }) },
          accessToken,
        );
        setStream(streamData);
        setStatus("Streaming");
        if (videoRef.current) {
          const localSaved =
            typeof window !== "undefined" ? Number(window.localStorage.getItem(progressKey) || "0") : 0;
          const startAt = Math.max(progress.last_position_seconds || 0, Number.isFinite(localSaved) ? localSaved : 0);
          videoRef.current.currentTime = startAt;
        }
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "Unable to start stream.";
        setError(message);
        setStatus("Unavailable");
      }
    };

    start();
  }, [lesson, accessToken, progressKey]);

  useEffect(() => {
    if (!lesson || lesson.content_type !== "VIDEO") {
      return;
    }
    if (!stream || !videoRef.current) {
      return;
    }

    const src = `${API_ORIGIN}${stream.playback_url}?token=${encodeURIComponent(stream.playback_token)}`;
    const video = videoRef.current;
    let hls: Hls | null = null;

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
    } else if (Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(video);
    }

    return () => {
      if (hls) {
        hls.destroy();
      }
    };
  }, [lesson, stream]);

  useEffect(() => {
    if (!lesson || lesson.content_type !== "VIDEO") {
      return;
    }
    if (!stream || !lesson) {
      return;
    }
    if (!accessToken) {
      return;
    }

    const heartbeatId = window.setInterval(async () => {
      try {
        await apiFetch(
          "/stream/heartbeat/",
          {
            method: "POST",
            body: JSON.stringify({
              session_id: stream.session_id,
              device_id: deviceIdRef.current,
              lesson_id: lesson.id,
            }),
          },
          accessToken,
        );
      } catch {
        setStatus("Stream expired or replaced on another device.");
      }
    }, 25000);

    const renewId = window.setInterval(async () => {
      try {
        const renewed = await apiFetch<StreamPayload>(
          "/stream/renew/",
          {
            method: "POST",
            body: JSON.stringify({
              session_id: stream.session_id,
              device_id: deviceIdRef.current,
              lesson_id: lesson.id,
            }),
          },
          accessToken,
        );
        setStream(renewed);
      } catch {
        setStatus("Unable to renew stream token.");
      }
    }, 90000);

    return () => {
      window.clearInterval(heartbeatId);
      window.clearInterval(renewId);
    };
  }, [stream, lesson, accessToken]);

  useEffect(() => {
    if (!lesson) {
      return;
    }
    if (lesson.content_type !== "VIDEO") {
      return;
    }
    if (!accessToken) {
      return;
    }

    const progressTimer = window.setInterval(() => {
      if (!videoRef.current) {
        return;
      }
      void syncProgress();
    }, 15000);

    return () => {
      window.clearInterval(progressTimer);
    };
  }, [lesson, accessToken, syncProgress]);

  useEffect(() => {
    if (!lesson || lesson.content_type !== "VIDEO" || !videoRef.current) return;
    const video = videoRef.current;

    const updateWatchProgress = () => {
      const effectiveDuration = getEffectiveDuration();
      if (effectiveDuration > 0) {
        setWatchPercent(Math.min(100, Math.max(0, Math.round(((video.currentTime || 0) / effectiveDuration) * 100))));
      }
      persistLocalProgress(video.currentTime || 0);
    };

    const onPause = () => {
      void syncProgress();
    };

    const onBeforeUnload = () => {
      const token = accessToken || getAccessToken();
      if (!lesson || !token || !videoRef.current) return;
      const current = Math.floor(videoRef.current.currentTime || 0);
      const effectiveDuration = getEffectiveDuration();
      const reachedNinetyPercent = effectiveDuration > 0 && (videoRef.current.currentTime || 0) >= effectiveDuration * 0.9;
      const completed = lesson.has_quiz
        ? effectiveDuration > 0 && (videoRef.current.currentTime || 0) >= effectiveDuration * 0.95
        : reachedNinetyPercent || Boolean(videoRef.current.ended);
      persistLocalProgress(current);
      const payload = JSON.stringify({ last_position_seconds: current, completed });
      void fetch(`${API_ORIGIN}/api/lessons/${lesson.id}/progress/`, {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: payload,
      });
    };

    video.addEventListener("timeupdate", updateWatchProgress);
    video.addEventListener("pause", onPause);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      video.removeEventListener("timeupdate", updateWatchProgress);
      video.removeEventListener("pause", onPause);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [lesson, accessToken, getEffectiveDuration, persistLocalProgress, syncProgress]);

  const renderReadingContent = (content: string) => {
    const source = (content || "").trim();
    if (!source) {
      return <p className="muted">No reading content yet.</p>;
    }

    const lines = source.split(/\r?\n/);
    const blocks: ReactNode[] = [];
    let listItems: string[] = [];
    let codeLines: string[] = [];
    let codeLanguage = "";
    let inCodeBlock = false;
    let index = 0;

    const flushList = () => {
      if (listItems.length === 0) return;
      blocks.push(
        <ul key={`list-${index++}`} className="list-disc space-y-1 pl-6">
          {listItems.map((item, itemIndex) => (
            <li key={`list-item-${index}-${itemIndex}`}>{item}</li>
          ))}
        </ul>,
      );
      listItems = [];
    };

    const flushCode = () => {
      if (codeLines.length === 0) return;
      blocks.push(
        <pre
          key={`code-${index++}`}
          className="overflow-x-auto rounded-xl border border-slate-300 bg-slate-900/95 p-4 text-sm text-slate-100"
        >
          <code data-lang={codeLanguage || undefined}>{codeLines.join("\n")}</code>
        </pre>,
      );
      codeLines = [];
      codeLanguage = "";
    };

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();

      if (inCodeBlock) {
        if (trimmed === "/code") {
          flushCode();
          inCodeBlock = false;
          continue;
        }
        codeLines.push(rawLine);
        continue;
      }

      if (trimmed.length === 0) {
        flushList();
        continue;
      }

      if (trimmed.startsWith("/code")) {
        flushList();
        inCodeBlock = true;
        codeLanguage = trimmed.slice(5).trim();
        codeLines = [];
        continue;
      }

      if (trimmed.startsWith("/h1 ")) {
        flushList();
        blocks.push(
          <h1 key={`h1-${index++}`} className="text-2xl font-semibold tracking-tight">
            {trimmed.slice(4).trim()}
          </h1>,
        );
        continue;
      }

      if (trimmed.startsWith("/h2 ")) {
        flushList();
        blocks.push(
          <h2 key={`h2-${index++}`} className="text-xl font-semibold tracking-tight">
            {trimmed.slice(4).trim()}
          </h2>,
        );
        continue;
      }

      if (trimmed.startsWith("/l ")) {
        listItems.push(trimmed.slice(3).trim());
        continue;
      }

      if (trimmed.startsWith("/c ")) {
        flushList();
        blocks.push(
          <p
            key={`comment-${index++}`}
            className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-600"
          >
            {trimmed.slice(3).trim()}
          </p>,
        );
        continue;
      }

      if (trimmed.startsWith("/p ")) {
        flushList();
        blocks.push(
          <p key={`p-${index++}`} className="leading-7">
            {trimmed.slice(3).trim()}
          </p>,
        );
        continue;
      }

      flushList();
      blocks.push(
        <p key={`text-${index++}`} className="leading-7">
          {trimmed}
        </p>,
      );
    }

    flushList();
    if (inCodeBlock) {
      flushCode();
    }

    return <div className="space-y-3">{blocks}</div>;
  };

  return (
    <main className="page-wrap fade-up">
      {lesson && (
        <nav className="mb-2 text-xs muted" aria-label="Breadcrumb">
          <Link href="/dashboard" className="hover:underline">
            Dashboard
          </Link>
          <span className="px-1">{">"}</span>
          <Link href={`/courses/${lesson.course_slug}`} className="hover:underline">
            {lesson.course_title}
          </Link>
          <span className="px-1">{">"}</span>
          <span>{lesson.title}</span>
        </nav>
      )}
      {lesson && <h1 className="text-2xl font-semibold md:text-3xl">{lesson.title}</h1>}
      <p className="mt-2 text-sm muted">{lesson?.content_type === "READING" ? "Reading lesson" : status}</p>
      {error && <p className="mt-3 rounded-lg border border-red-300 bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}
      {lesson?.content_type === "VIDEO" ? (
        <div className="mt-5">
          <div className="surface overflow-hidden bg-black">
            <video
              ref={videoRef}
              controls
              className="aspect-video w-full"
              onEnded={() => {
                void markCompleted();
                setStatus("Marked as completed");
              }}
            />
          </div>
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-xs muted">
              <span>Lesson progress</span>
              <span>{watchPercent}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: "color-mix(in srgb, var(--border) 70%, transparent)" }}>
              <div className="h-full transition-all" style={{ width: `${watchPercent}%`, background: "var(--accent)" }} />
            </div>
          </div>
        </div>
      ) : (
        <article className="surface prose mt-5 max-w-none p-5">
          {renderReadingContent(lesson?.reading_content || "")}
        </article>
      )}
      {!nextLessonId && examEligibility?.can_take_final_exam ? (
        <button
          type="button"
          className="btn btn-primary mt-4"
          onClick={() => {
            if (lesson) {
              router.push(`/final-exam/${lesson.course_id}`);
            }
          }}
        >
          Take Final Exam
        </button>
      ) : lesson && lesson.has_quiz ? (
        <Link
          href={`/lessons/${lesson.id}/quiz`}
          className="btn btn-primary mt-4"
        >
          Take Lesson Quiz
        </Link>
      ) : (
        <button
          type="button"
          className="btn btn-secondary mt-4 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!nextLessonId}
          onClick={() => {
            if (nextLessonId) router.push(`/lessons/${nextLessonId}`);
            else router.push("/dashboard");
          }}
        >
          {nextLessonId ? "Next Lesson" : "Back to Dashboard"}
        </button>
      )}
      {!nextLessonId && !lesson?.has_quiz && examEligibility && !examEligibility.can_take_final_exam && (
        <p className="mt-2 text-xs muted">
          {examEligibility.next_step || "Final exam is still locked or not published yet."}
        </p>
      )}
    </main>
  );
}
