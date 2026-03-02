"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { API_BASE_URL, apiFetch } from "@/lib/api";
import { useAccessToken } from "@/hooks/use-access-token";
import { getTheme, subscribeThemeChange } from "@/lib/theme";

type Course = {
  id: number;
  title: string;
  slug: string;
  description: string;
  level: string;
};

export default function HomePage() {
  const accessToken = useAccessToken();
  const clientTheme = useSyncExternalStore(subscribeThemeChange, getTheme, () => "light");
  const isAuthed = Boolean(accessToken);
  const logoSrc = clientTheme === "dark" ? "/merxylab-logo-dark.png" : "/merxylab-logo-light.png";
  const [courses, setCourses] = useState<Course[]>([]);
  const [health, setHealth] = useState("checking");
  const currentYear = new Date().getFullYear();

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
        <section className="surface home-hero fade-up overflow-hidden p-7 md:p-10">
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
            <aside className="surface-soft slow-float p-5">
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
              <p className="mt-4 text-sm">
                &ldquo;The structured path and progress tracking helped me finish courses consistently.&rdquo;
              </p>
              <p className="mt-2 text-xs muted">Student testimonial</p>
            </aside>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <article className="surface card-lift p-5">
            <p className="text-xs uppercase tracking-wide muted">Step 1</p>
            <h3 className="mt-2 text-lg font-semibold">Pick a course</h3>
            <p className="mt-2 text-sm muted">Choose from structured tracks with clear difficulty and progression.</p>
          </article>
          <article className="surface card-lift p-5">
            <p className="text-xs uppercase tracking-wide muted">Step 2</p>
            <h3 className="mt-2 text-lg font-semibold">Finish lessons + quizzes</h3>
            <p className="mt-2 text-sm muted">Unlock content lesson-by-lesson and validate progress with quick checks.</p>
          </article>
          <article className="surface card-lift p-5">
            <p className="text-xs uppercase tracking-wide muted">Step 3</p>
            <h3 className="mt-2 text-lg font-semibold">Pass final exam</h3>
            <p className="mt-2 text-sm muted">Earn a certificate and keep a clean record of your learning achievements.</p>
          </article>
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
              <article key={course.id} className="surface card-lift p-5">
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

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="surface card-lift p-6">
            <p className="text-xs uppercase tracking-wide muted">Platform Features</p>
            <h2 className="mt-2 text-2xl font-semibold">Built for consistency, not chaos</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="surface-soft p-3">
                <p className="font-medium">Role-based access</p>
                <p className="mt-1 text-sm muted">Separate admin and student workflows to keep operations clean.</p>
              </div>
              <div className="surface-soft p-3">
                <p className="font-medium">Credit wallet</p>
                <p className="mt-1 text-sm muted">Transparent balances and transaction history for each student.</p>
              </div>
              <div className="surface-soft p-3">
                <p className="font-medium">Verification workflow</p>
                <p className="mt-1 text-sm muted">Profile checks with approve/deny flow and audit notes.</p>
              </div>
              <div className="surface-soft p-3">
                <p className="font-medium">Progress tracking</p>
                <p className="mt-1 text-sm muted">Lesson completion, quiz status, and exam readiness in one place.</p>
              </div>
            </div>
          </div>

          <div className="surface card-lift p-6">
            <p className="text-xs uppercase tracking-wide muted">FAQ</p>
            <h2 className="mt-2 text-2xl font-semibold">Common questions</h2>
            <div className="mt-4 space-y-3">
              <div className="rounded-lg border p-3">
                <p className="font-medium">Do I need to complete lessons in order?</p>
                <p className="mt-1 text-sm muted">Yes. Lessons are progressively unlocked to keep learning outcomes consistent.</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="font-medium">How do I get a certificate?</p>
                <p className="mt-1 text-sm muted">Finish all lessons, pass lesson quizzes, then pass the final exam.</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="font-medium">Can admins manage student balances?</p>
                <p className="mt-1 text-sm muted">Yes. Admin can adjust credits and review recent wallet transactions.</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="page-wrap py-8">
          <div className="grid gap-6 md:grid-cols-[1.2fr_1fr_1fr]">
            <div>
              <Image
                src={logoSrc}
                alt="MerxyLab Online Learning"
                width={242}
                height={70}
                className="h-10 w-auto"
              />
              <p className="mt-2 max-w-md text-sm muted">
                Practical online learning with structured progression, verified student identity, and measurable outcomes.
              </p>
              <p className="mt-3 text-xs muted">API endpoint: <code>{API_BASE_URL}</code></p>
              <p className="mt-1 text-xs muted">Health status: <strong>{health}</strong></p>
            </div>

            <div>
              <p className="text-sm font-semibold">Explore</p>
              <ul className="mt-3 space-y-2 text-sm">
                <li><Link className="muted hover:text-[var(--foreground)]" href="/">Home</Link></li>
                <li><Link className="muted hover:text-[var(--foreground)]" href="/register">Register</Link></li>
                <li><Link className="muted hover:text-[var(--foreground)]" href="/login">Login</Link></li>
                <li><Link className="muted hover:text-[var(--foreground)]" href="/dashboard">Dashboard</Link></li>
              </ul>
            </div>

            <div>
              <p className="text-sm font-semibold">Platform</p>
              <ul className="mt-3 space-y-2 text-sm muted">
                <li>Protected streaming and gated lessons</li>
                <li>Wallet and course ownership tracking</li>
                <li>Final exam and certificate issuance</li>
                <li>Admin course and student management</li>
              </ul>
            </div>
          </div>

          <div className="mt-6 border-t pt-4 text-xs muted">
            <p>© {currentYear} MerxyLab. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}




