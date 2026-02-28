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
type ExamEligibility = {
  can_take_final_exam: boolean;
  final_exam_exists?: boolean;
  progress?: { completion_rate: number };
};

export default function CourseDetailPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ slug: string }>();
  const slug = useMemo(() => params.slug, [params.slug]);
  const accessToken = useAccessToken();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [examEligibility, setExamEligibility] = useState<ExamEligibility | null>(null);
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

  useEffect(() => {
    if (!course?.enrolled || !accessToken) {
      setExamEligibility(null);
      return;
    }
    apiFetch<ExamEligibility>(`/courses/${course.id}/exam-eligibility/`, {}, accessToken)
      .then(setExamEligibility)
      .catch(() => setExamEligibility(null));
  }, [course?.enrolled, course?.id, accessToken]);

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
    <main className="page-wrap fade-up">
      {!course && !error && <p>Loading course...</p>}
      {error && <p className="rounded-lg border border-red-300 bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}
      {course && (
        <>
          <div className="surface p-6 md:p-8">
            <h1 className="text-3xl font-semibold md:text-4xl">{course.title}</h1>
            <p className="mt-2 text-sm muted">{course.level || "General"}</p>
            <p className="mt-3 muted">{course.description}</p>
          {!course.enrolled && (
            <button
              type="button"
              onClick={enroll}
              disabled={busy}
              className="btn btn-primary mt-5 disabled:opacity-60"
            >
              {busy ? "Enrolling..." : "Enroll For Free"}
            </button>
          )}
          {course.enrolled && (
            <p className="mt-5 inline-block rounded-lg border border-emerald-300 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-500">
              Enrolled
            </p>
          )}
          {course.enrolled && examEligibility?.can_take_final_exam && (
            <div className="mt-4">
              <Link href={`/final-exam/${course.id}`} className="btn btn-primary">
                Take Final Exam
              </Link>
            </div>
          )}
          {course.enrolled && examEligibility && !examEligibility.can_take_final_exam && (
            <p className="mt-4 text-xs muted">
              Final exam unlock progress: {examEligibility.progress?.completion_rate ?? 0}%
            </p>
          )}
          </div>

          <section className="mt-8 space-y-4 fade-up-delay">
            {course.sections.map((section) => (
              <article key={section.id} className="surface p-5">
                <h2 className="text-lg font-semibold">
                  {section.order}. {section.title}
                </h2>
                <ul className="mt-3 space-y-2">
                  {section.lessons.map((lesson) => (
                    <li key={lesson.id} className="surface-soft flex items-center justify-between px-3 py-2">
                      <div>
                        <p className="text-sm font-medium">
                          {lesson.order}. {lesson.title}
                        </p>
                        <p className="text-xs muted">
                          {lesson.is_preview ? "Preview" : lesson.locked ? "Locked" : "Unlocked"}
                        </p>
                      </div>
                      {!lesson.locked ? (
                        <Link
                          href={`/lessons/${lesson.id}`}
                          className="btn btn-primary px-3 py-1.5 text-xs"
                        >
                          Open
                        </Link>
                      ) : (
                        <span className="text-xs muted">Enroll required</span>
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
