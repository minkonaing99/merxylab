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
  credits?: number;
  profile_completed?: boolean;
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
  price_cents?: number;
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
    return <main className="page-wrap">Redirecting to login...</main>;
  }

  const enrolledCourseIds = new Set(enrollments.map((item) => item.course.id));
  const availableCourses = catalog.filter((course) => !enrolledCourseIds.has(course.id));

  return (
    <main className="page-wrap fade-up">
      <h1 className="text-3xl font-semibold md:text-4xl">Student Dashboard</h1>
      {me && (
        <p className="mt-2 text-sm muted">
          Signed in as <strong>{me.username}</strong> ({me.role}) | Credits: <strong>{me.credits ?? 0}</strong>
        </p>
      )}
      {me && !me.profile_completed && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-500/10 p-3 text-sm">
          Complete your profile before final exam/certificate.
          {" "}
          <Link href="/profile" className="font-semibold" style={{ color: "var(--accent)" }}>
            Open Profile
          </Link>
        </div>
      )}
      {error && <p className="mt-4 rounded-lg border border-red-300 bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}

      <section className="mt-6">
        <h2 className="mb-3 text-xl font-semibold">Enrolled Courses</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {enrollments.map((entry) => (
            <article key={entry.id} className="surface p-5 transition-transform duration-200 hover:-translate-y-1">
              <p className="text-xs uppercase tracking-wide muted">{entry.status}</p>
              <h3 className="mt-1 text-lg font-semibold">{entry.course.title}</h3>
              <p className="mt-2 text-sm muted">{entry.course.description}</p>
              <Link
                href={`/courses/${entry.course.slug}`}
                className="btn btn-primary mt-4"
              >
                Continue
              </Link>
            </article>
          ))}
          {enrollments.length === 0 && !error && (
            <p className="surface p-6 text-sm muted">
              No enrollments yet. Open a course and click enroll.
            </p>
          )}
        </div>
      </section>

      <section className="mt-8 fade-up-delay">
        <h2 className="mb-3 text-xl font-semibold">Available Courses</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {availableCourses.map((course) => (
            <article key={course.id} className="surface p-5 transition-transform duration-200 hover:-translate-y-1">
              <p className="text-xs uppercase tracking-wide muted">{course.level || "General"}</p>
              <h3 className="mt-1 text-lg font-semibold">{course.title}</h3>
              <p className="mt-2 text-sm muted">{course.description}</p>
              <p className="mt-2 text-xs muted">
                Enrollment fee: <strong>{course.price_cents ?? 0} credits</strong>
              </p>
              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => enrollFromDashboard(course.id)}
                  disabled={enrollingCourseId === course.id}
                  className="btn btn-primary disabled:opacity-60"
                >
                  {enrollingCourseId === course.id ? "Processing..." : (course.price_cents ?? 0) > 0 ? "Buy with Credits" : "Enroll"}
                </button>
                <Link href={`/courses/${course.slug}`} className="btn btn-secondary">
                  View
                </Link>
              </div>
            </article>
          ))}
          {availableCourses.length === 0 && (
            <p className="surface p-6 text-sm muted">
              You are enrolled in all current courses.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
