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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#ffedd5,_transparent_40%),linear-gradient(#f8fafc,_#f1f5f9)] text-slate-900">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10">
        <section className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-amber-700">MerxyLab</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">Learn with protected streaming and quizzes</h1>
          <p className="mt-3 text-sm text-slate-600">
            API: <code>{API_BASE_URL}</code> | Health: <strong>{health}</strong>
          </p>
          {!isAuthed ? (
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link href="/login" className="rounded-md bg-slate-900 px-5 py-2 text-sm font-medium text-white">
                Login First
              </Link>
              <Link href="/register" className="rounded-md border border-slate-300 px-5 py-2 text-sm font-medium">
                Create Account
              </Link>
            </div>
          ) : (
            <div className="mt-6">
              <Link href="/dashboard" className="rounded-md bg-emerald-700 px-5 py-2 text-sm font-medium text-white">
                Go to Dashboard
              </Link>
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Course Catalog</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {courses.map((course) => (
              <article key={course.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="mb-2 text-xs uppercase tracking-wide text-amber-700">{course.level || "General"}</p>
                <h3 className="text-xl font-semibold">{course.title}</h3>
                <p className="mt-2 line-clamp-3 text-sm text-slate-600">{course.description}</p>
                <Link
                  href={`/courses/${course.slug}`}
                  className="mt-4 inline-block rounded-md bg-amber-700 px-4 py-2 text-sm font-medium text-white"
                >
                  View Course
                </Link>
              </article>
            ))}
            {courses.length === 0 && (
              <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
                No courses found.
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
