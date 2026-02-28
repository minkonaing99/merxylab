"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { API_BASE_URL, apiFetch } from "@/lib/api";
import { useAccessToken } from "@/hooks/use-access-token";

type Course = {
  id: number;
  title: string;
  slug: string;
  description: string;
  level: string;
};

export default function HomePage() {
  const accessToken = useAccessToken();
  const isAuthed = Boolean(accessToken);
  const [courses, setCourses] = useState<Course[]>([]);
  const [health, setHealth] = useState("checking");

  useEffect(() => {
    apiFetch<{ status?: string }>("/health/")
      .then((res) => setHealth(res.status ?? "unknown"))
      .catch(() => setHealth("backend unreachable"));

    apiFetch<Course[]>("/courses/")
      .then((res) => setCourses(res))
      .catch(() => setCourses([]));
  }, []);

  return (
    <div className="min-h-screen">
      <main className="page-wrap flex flex-col gap-8 py-10">
        <section className="surface fade-up p-7 md:p-10">
          <p className="text-xs uppercase tracking-[0.2em] muted">MerxyLab</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">
            Minimal learning platform with secure streaming
          </h1>
          <p className="mt-3 text-sm muted">
            API: <code>{API_BASE_URL}</code> | Health: <strong>{health}</strong>
          </p>
          {!isAuthed ? (
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link href="/login" className="btn btn-primary soft-pulse">
                Login First
              </Link>
              <Link href="/register" className="btn btn-secondary">
                Create Account
              </Link>
            </div>
          ) : (
            <div className="mt-6">
              <Link href="/dashboard" className="btn btn-primary">
                Go to Dashboard
              </Link>
            </div>
          )}
        </section>

        <section className="fade-up-delay">
          <h2 className="mb-4 text-2xl font-semibold">Course Catalog</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {courses.map((course) => (
              <article key={course.id} className="surface p-5 transition-transform duration-200 hover:-translate-y-1">
                <p className="mb-2 text-xs uppercase tracking-wide muted">{course.level || "General"}</p>
                <h3 className="text-xl font-semibold">{course.title}</h3>
                <p className="mt-2 line-clamp-3 text-sm muted">{course.description}</p>
                <Link
                  href={`/courses/${course.slug}`}
                  className="btn btn-primary mt-4"
                >
                  View Course
                </Link>
              </article>
            ))}
            {courses.length === 0 && (
              <p className="surface p-6 text-sm muted">
                No courses found.
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
