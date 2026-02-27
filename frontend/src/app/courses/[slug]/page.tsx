"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { useAccessToken } from "@/hooks/use-access-token";

type Lesson = {
  id: number;
  title: string;
  order: number;
  is_preview: boolean;
  locked: boolean;
};

type Section = {
  id: number;
  title: string;
  order: number;
  lessons: Lesson[];
};

type CourseDetail = {
  id: number;
  title: string;
  description: string;
  level: string;
  enrolled: boolean;
  sections: Section[];
};

export default function CourseDetailPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ slug: string }>();
  const slug = useMemo(() => params.slug, [params.slug]);
  const accessToken = useAccessToken();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadCourse = useCallback(async () => {
    try {
      const data = await apiFetch<CourseDetail>(
        `/courses/${slug}/`,
        {},
        accessToken,
      );
      setCourse(data);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to load course.";
      setError(message);
    }
  }, [accessToken, slug]);

  useEffect(() => {
    loadCourse();
  }, [loadCourse]);

  const enroll = async () => {
    if (!course) {
      return;
    }
    if (!accessToken) {
      router.push(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/courses/${course.id}/enroll/`, { method: "POST", body: "{}" }, accessToken);
      await loadCourse();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Enrollment failed.";
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      {!course && !error && <p>Loading course...</p>}
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {course && (
        <>
          <h1 className="text-3xl font-semibold">{course.title}</h1>
          <p className="mt-2 text-sm text-slate-600">{course.level || "General"}</p>
          <p className="mt-3 text-slate-700">{course.description}</p>
          {!course.enrolled && (
            <button
              type="button"
              onClick={enroll}
              disabled={busy}
              className="mt-4 rounded-md bg-amber-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {busy ? "Enrolling..." : "Enroll For Free"}
            </button>
          )}
          {course.enrolled && (
            <p className="mt-4 inline-block rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Enrolled
            </p>
          )}

          <section className="mt-8 space-y-4">
            {course.sections.map((section) => (
              <article key={section.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-semibold">
                  {section.order}. {section.title}
                </h2>
                <ul className="mt-3 space-y-2">
                  {section.lessons.map((lesson) => (
                    <li key={lesson.id} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
                      <div>
                        <p className="text-sm font-medium">
                          {lesson.order}. {lesson.title}
                        </p>
                        <p className="text-xs text-slate-600">
                          {lesson.is_preview ? "Preview" : lesson.locked ? "Locked" : "Unlocked"}
                        </p>
                      </div>
                      {!lesson.locked ? (
                        <Link
                          href={`/lessons/${lesson.id}`}
                          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white"
                        >
                          Open
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-500">Enroll required</span>
                      )}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
