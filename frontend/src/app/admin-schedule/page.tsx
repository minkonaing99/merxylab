"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ApiError, apiFetch } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { useAccessToken } from "@/hooks/use-access-token";
import { setTheme } from "@/lib/theme";

type CourseRow = {
  id: number;
  title: string;
  slug: string;
  is_published: boolean;
  publish_at?: string | null;
  unpublish_at?: string | null;
  enrollment_count?: number;
};

type DraftRow = {
  publish_at: string;
  unpublish_at: string;
};

const toDateTimeLocalValue = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const toIsoFromDateTimeLocal = (value: string) => (value ? new Date(value).toISOString() : null);

function getCourseStatus(course: CourseRow): { label: string; className: string } {
  const now = Date.now();
  const publishAt = course.publish_at ? new Date(course.publish_at).getTime() : null;
  const unpublishAt = course.unpublish_at ? new Date(course.unpublish_at).getTime() : null;

  if (!course.is_published) {
    return { label: "Draft", className: "border-slate-300 bg-slate-100 text-slate-700" };
  }
  if (publishAt && now < publishAt) {
    return { label: "Scheduled", className: "border-amber-300 bg-amber-500/10 text-amber-700" };
  }
  if (unpublishAt && now >= unpublishAt) {
    return { label: "Unpublished by schedule", className: "border-slate-300 bg-slate-100 text-slate-700" };
  }
  return { label: "Live", className: "border-emerald-300 bg-emerald-500/10 text-emerald-700" };
}

export default function AdminSchedulePage() {
  const router = useRouter();
  const pathname = usePathname();
  const accessToken = useAccessToken();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [drafts, setDrafts] = useState<Record<number, DraftRow>>({});
  const [savingCourseId, setSavingCourseId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setTheme("light");
  }, []);

  const loadCourses = useCallback(async (token: string) => {
    const rows = await apiFetch<CourseRow[]>("/admin/courses/", {}, token);
    setCourses(rows);
    const nextDrafts: Record<number, DraftRow> = {};
    for (const course of rows) {
      nextDrafts[course.id] = {
        publish_at: toDateTimeLocalValue(course.publish_at),
        unpublish_at: toDateTimeLocalValue(course.unpublish_at),
      };
    }
    setDrafts(nextDrafts);
  }, []);

  useEffect(() => {
    const token = accessToken || getAccessToken();
    if (!token) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    apiFetch<{ role?: string }>("/me/", {}, token)
      .then(async (me) => {
        if (me.role !== "admin") {
          setIsAdmin(false);
          router.replace("/dashboard");
          return;
        }
        setIsAdmin(true);
        await loadCourses(token);
      })
      .catch(() => {
        setIsAdmin(false);
        router.replace("/dashboard");
      });
  }, [accessToken, loadCourses, pathname, router]);

  const sortedCourses = useMemo(() => [...courses].sort((a, b) => a.id - b.id), [courses]);

  const saveSchedule = async (event: FormEvent<HTMLFormElement>, courseId: number) => {
    event.preventDefault();
    const token = accessToken || getAccessToken();
    if (!token) return;
    setSavingCourseId(courseId);
    setError("");
    setNotice("");
    try {
      const draft = drafts[courseId] ?? { publish_at: "", unpublish_at: "" };
      const selectedCourse = courses.find((item) => item.id === courseId);
      const hasSchedule = Boolean(draft.publish_at || draft.unpublish_at);
      await apiFetch(
        `/admin/courses/${courseId}/`,
        {
          method: "PATCH",
          body: JSON.stringify({
            is_published: hasSchedule ? true : Boolean(selectedCourse?.is_published),
            publish_at: toIsoFromDateTimeLocal(draft.publish_at),
            unpublish_at: toIsoFromDateTimeLocal(draft.unpublish_at),
          }),
        },
        token,
      );
      await loadCourses(token);
      setNotice(hasSchedule ? "Schedule updated and publish mode enabled." : "Schedule updated.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update schedule.");
    } finally {
      setSavingCourseId(null);
    }
  };

  const quickUpdate = async (courseId: number, payload: Record<string, unknown>, successMessage: string) => {
    const token = accessToken || getAccessToken();
    if (!token) return;
    setSavingCourseId(courseId);
    setError("");
    setNotice("");
    try {
      await apiFetch(`/admin/courses/${courseId}/`, { method: "PATCH", body: JSON.stringify(payload) }, token);
      await loadCourses(token);
      setNotice(successMessage);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update course status.");
    } finally {
      setSavingCourseId(null);
    }
  };

  if (isAdmin === null) {
    return <main className="admin-theme-scope page-wrap">Checking access...</main>;
  }

  return (
    <main className="admin-theme-scope page-wrap fade-up">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold md:text-4xl">Course Schedule Control</h1>
          <p className="mt-2 text-sm muted">
            Set publish/unpublish dates, publish instantly, or unpublish instantly.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => router.push("/admin-ui")}
        >
          Back to Admin UI
        </button>
      </div>

      {error && <p className="mt-4 rounded-lg border border-red-300 bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}
      {notice && <p className="mt-4 rounded-lg border border-emerald-300 bg-emerald-500/10 p-3 text-sm text-emerald-500">{notice}</p>}

      <section className="mt-6 grid gap-4">
        {sortedCourses.length === 0 && (
          <div className="surface p-5">
            <p className="text-sm muted">No courses yet. Create a course first in Admin UI.</p>
          </div>
        )}

        {sortedCourses.map((course) => {
          const status = getCourseStatus(course);
          const draft = drafts[course.id] ?? { publish_at: "", unpublish_at: "" };
          const busy = savingCourseId === course.id;
          return (
            <article key={course.id} className="surface p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">{course.title}</h2>
                  <p className="mt-1 text-xs muted">
                    Slug: {course.slug} | Enrollments: {course.enrollment_count ?? 0}
                  </p>
                </div>
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${status.className}`}>
                  {status.label}
                </span>
              </div>

              <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={(e) => saveSchedule(e, course.id)}>
                <label className="text-sm font-medium">
                  Publish at
                  <input
                    className="input"
                    type="datetime-local"
                    value={draft.publish_at}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [course.id]: { ...(prev[course.id] ?? { publish_at: "", unpublish_at: "" }), publish_at: e.target.value },
                      }))
                    }
                  />
                </label>
                <label className="text-sm font-medium">
                  Unpublish at
                  <input
                    className="input"
                    type="datetime-local"
                    value={draft.unpublish_at}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [course.id]: { ...(prev[course.id] ?? { publish_at: "", unpublish_at: "" }), unpublish_at: e.target.value },
                      }))
                    }
                  />
                </label>
                <div className="md:col-span-2 flex flex-wrap gap-2">
                  <button className="btn btn-primary" type="submit" disabled={busy}>
                    {busy && savingCourseId === course.id ? "Saving..." : "Save Schedule"}
                  </button>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      quickUpdate(
                        course.id,
                        { is_published: true, publish_at: null, unpublish_at: null },
                        `"${course.title}" is now live.`,
                      )
                    }
                  >
                    Publish Now
                  </button>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      quickUpdate(
                        course.id,
                        { is_published: false },
                        `"${course.title}" is now unpublished.`,
                      )
                    }
                  >
                    Unpublish Now
                  </button>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      quickUpdate(
                        course.id,
                        { publish_at: null, unpublish_at: null },
                        `Schedule cleared for "${course.title}".`,
                      )
                    }
                  >
                    Clear Dates
                  </button>
                </div>
              </form>
            </article>
          );
        })}
      </section>
    </main>
  );
}
