"use client";

import Hls from "hls.js";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { API_ORIGIN, apiFetch, ApiError } from "@/lib/api";
import { getAccessToken, getOrCreateDeviceId } from "@/lib/auth";
import { useAccessToken } from "@/hooks/use-access-token";

type Lesson = {
  id: number;
  course_id: number;
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const deviceIdRef = useRef<string>("");

  const markCompleted = async () => {
    if (!lesson || !accessToken) return;
    const currentTime = Math.floor(videoRef.current?.currentTime || 0);
    await apiFetch(
      `/lessons/${lesson.id}/progress/`,
      {
        method: "POST",
        body: JSON.stringify({ last_position_seconds: currentTime, completed: true }),
      },
      accessToken,
    );
  };

  useEffect(() => {
    if (!accessToken && !getAccessToken()) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
  }, [accessToken, pathname, router]);

  useEffect(() => {
    if (!accessToken) {
      return;
    }
    if (!Number.isFinite(lessonId)) {
      return;
    }
    apiFetch<Lesson>(`/lessons/${lessonId}/`, {}, accessToken)
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
          videoRef.current.currentTime = progress.last_position_seconds || 0;
        }
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "Unable to start stream.";
        setError(message);
        setStatus("Unavailable");
      }
    };

    start();
  }, [lesson, accessToken]);

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
      const knownDuration = lesson.duration_seconds ?? null;
      const playerDuration = Number.isFinite(videoRef.current.duration) ? videoRef.current.duration : 0;
      const effectiveDuration = knownDuration && knownDuration > 0 ? knownDuration : playerDuration;
      void apiFetch(
        `/lessons/${lesson.id}/progress/`,
        {
          method: "POST",
          body: JSON.stringify({
            last_position_seconds: Math.floor(videoRef.current.currentTime || 0),
            completed: effectiveDuration > 0 && (videoRef.current.currentTime || 0) >= effectiveDuration * 0.95,
          }),
        },
        accessToken,
      );
    }, 15000);

    return () => {
      window.clearInterval(progressTimer);
    };
  }, [lesson, accessToken]);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      {!accessToken && !getAccessToken() && <p className="text-sm text-slate-600">Redirecting to login...</p>}
      {lesson && <h1 className="text-2xl font-semibold">{lesson.title}</h1>}
      <p className="mt-2 text-sm text-slate-600">{lesson?.content_type === "READING" ? "Reading lesson" : status}</p>
      {error && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {lesson?.content_type === "VIDEO" ? (
        <div className="mt-5 overflow-hidden rounded-xl border border-slate-300 bg-black">
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
      ) : (
        <article className="prose mt-5 max-w-none rounded-xl border border-slate-200 bg-white p-5">
          <div className="whitespace-pre-wrap text-slate-800">{lesson?.reading_content || "No reading content yet."}</div>
        </article>
      )}
      {lesson && lesson.has_quiz ? (
        <Link
          href={`/lessons/${lesson.id}/quiz`}
          className="mt-4 inline-block rounded-md bg-amber-700 px-4 py-2 text-sm font-medium text-white"
        >
          Take Lesson Quiz
        </Link>
      ) : (
        <button
          type="button"
          className="mt-4 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!nextLessonId}
          onClick={() => {
            if (nextLessonId) router.push(`/lessons/${nextLessonId}`);
            else router.push("/dashboard");
          }}
        >
          {nextLessonId ? "Next Lesson" : "Back to Dashboard"}
        </button>
      )}
    </main>
  );
}
