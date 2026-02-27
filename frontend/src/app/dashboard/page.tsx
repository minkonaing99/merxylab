"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { useAccessToken } from "@/hooks/use-access-token";

type MePayload = {
  username: string;
  role: string;
  email: string;
};

type Enrollment = {
  id: number;
  course: {
    id: number;
    slug: string;
    title: string;
    description: string;
  };
  status: string;
};

type CourseCatalog = {
  id: number;
  title: string;
  slug: string;
  description: string;
  level: string;
};

export default function DashboardPage() {
  const router = useRouter();
  const pathname = usePathname();
  const accessToken = useAccessToken();
  const [me, setMe] = useState<MePayload | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [catalog, setCatalog] = useState<CourseCatalog[]>([]);
  const [enrollingCourseId, setEnrollingCourseId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const loadData = useCallback(async (token: string) => {
    const [meData, enrollData, catalogData] = await Promise.all([
      apiFetch<MePayload>("/me/", {}, token),
      apiFetch<Enrollment[]>("/me/enrollments/", {}, token),
      apiFetch<CourseCatalog[]>("/courses/", {}, token),
    ]);
    if (meData.role === "admin") {
      router.replace("/admin-ui");
      return;
    }
    setMe(meData);
    setEnrollments(enrollData);
    setCatalog(catalogData);
  }, [router]);

  useEffect(() => {
    const token = accessToken || getAccessToken();
    if (!token) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }

    loadData(token)
      .catch((err) => {
        const message = err instanceof ApiError ? err.message : "Failed to load dashboard.";
        setError(message);
      });
  }, [accessToken, loadData, pathname, router]);

  const enrollFromDashboard = async (courseId: number) => {
    if (!accessToken) {
      return;
    }
    setEnrollingCourseId(courseId);
    setError("");
    try {
      await apiFetch(`/courses/${courseId}/enroll/`, { method: "POST", body: "{}" }, accessToken);
      await loadData(accessToken);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Enrollment failed.";
      setError(message);
    } finally {
      setEnrollingCourseId(null);
    }
  };

  if (!accessToken && !getAccessToken()) {
    return <main className="mx-auto w-full max-w-5xl px-4 py-8">Redirecting to login...</main>;
  }

  const enrolledCourseIds = new Set(enrollments.map((item) => item.course.id));
  const availableCourses = catalog.filter((course) => !enrolledCourseIds.has(course.id));

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <h1 className="text-3xl font-semibold">Student Dashboard</h1>
      {me && (
        <p className="mt-2 text-sm text-slate-600">
          Signed in as <strong>{me.username}</strong> ({me.role})
        </p>
      )}
      {error && <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <section className="mt-6">
        <h2 className="mb-3 text-xl font-semibold">Enrolled Courses</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {enrollments.map((entry) => (
            <article key={entry.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-emerald-700">{entry.status}</p>
              <h3 className="mt-1 text-lg font-semibold">{entry.course.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{entry.course.description}</p>
              <Link
                href={`/courses/${entry.course.slug}`}
                className="mt-4 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
              >
                Continue
              </Link>
            </article>
          ))}
          {enrollments.length === 0 && !error && (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
              No enrollments yet. Open a course and click enroll.
            </p>
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-xl font-semibold">Available Courses</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {availableCourses.map((course) => (
            <article key={course.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-amber-700">{course.level || "General"}</p>
              <h3 className="mt-1 text-lg font-semibold">{course.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{course.description}</p>
              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => enrollFromDashboard(course.id)}
                  disabled={enrollingCourseId === course.id}
                  className="rounded-md bg-amber-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  {enrollingCourseId === course.id ? "Enrolling..." : "Enroll"}
                </button>
                <Link href={`/courses/${course.slug}`} className="rounded-md border border-slate-300 px-4 py-2 text-sm">
                  View
                </Link>
              </div>
            </article>
          ))}
          {availableCourses.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
              You are enrolled in all current courses.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
