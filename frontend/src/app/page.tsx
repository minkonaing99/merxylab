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
        <section className="surface fade-up overflow-hidden p-7 md:p-10">
          <div className="grid gap-6 md:grid-cols-[1.3fr_1fr] md:items-center">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] muted">MerxyLab</p>
              <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">
                Learn practical skills with guided lessons, quizzes, and certificates
              </h1>
              <p className="mt-4 max-w-2xl text-sm md:text-base muted">
                Structured learning paths keep students focused from lesson one to final exam, while instructors manage everything in one place.
              </p>
              {!isAuthed ? (
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <Link href="/register" className="btn btn-primary soft-pulse">
                    Start Learning
                  </Link>
                  <Link href="/login" className="btn btn-secondary">
                    I already have an account
                  </Link>
                </div>
              ) : (
                <div className="mt-6">
                  <Link href="/dashboard" className="btn btn-primary">
                    Continue Learning
                  </Link>
                </div>
              )}
              <div className="mt-6 flex flex-wrap items-center gap-3 text-xs muted">
                <span className="surface-soft px-3 py-1.5">Progressive lesson unlocks</span>
                <span className="surface-soft px-3 py-1.5">Final exam + certificate</span>
                <span className="surface-soft px-3 py-1.5">Secure HLS streaming</span>
              </div>
            </div>
            <aside className="surface-soft p-5">
              <p className="text-xs uppercase tracking-wider muted">Trusted by learners</p>
              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-2xl font-semibold">95%</p>
                  <p className="text-xs muted">Quiz pass rate</p>
                </div>
                <div>
                  <p className="text-2xl font-semibold">4.8/5</p>
                  <p className="text-xs muted">Average rating</p>
                </div>
                <div>
                  <p className="text-2xl font-semibold">24h</p>
                  <p className="text-xs muted">Instructor response</p>
                </div>
              </div>
              <p className="mt-4 text-sm muted">
                API: <code>{API_BASE_URL}</code>
              </p>
              <p className="mt-1 text-sm muted">
                System health: <strong>{health}</strong>
              </p>
              <p className="mt-4 text-sm">
                &ldquo;The structured path and progress tracking helped me finish courses consistently.&rdquo;
              </p>
              <p className="mt-2 text-xs muted">Student testimonial</p>
            </aside>
          </div>
        </section>

        <section className="fade-up-delay">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold">Course Catalog</h2>
              <p className="mt-1 text-sm muted">Pick a track and start from the first lesson.</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {courses.map((course) => (
              <article key={course.id} className="surface p-5 transition-transform duration-200 hover:-translate-y-1">
                <p className="mb-2 text-xs uppercase tracking-wide muted">{course.level || "General"}</p>
                <h3 className="text-xl font-semibold">{course.title}</h3>
                <p className="mt-2 line-clamp-3 text-sm muted">{course.description}</p>
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
