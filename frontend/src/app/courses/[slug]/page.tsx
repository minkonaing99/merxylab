"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { useAccessToken } from "@/hooks/use-access-token";
import { getAccessToken } from "@/lib/auth";
import { downloadCertificateTemplate } from "@/lib/certificate";

type Lesson = {
  id: number;
  title: string;
  order: number;
  is_preview: boolean;
  locked: boolean;
  has_quiz?: boolean;
  quiz_status?: "PASSED" | "FAILED" | null;
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
type CertificateResponse = {
  issued: boolean;
  certificate?: {
    certificate_code: string;
    verification_code?: string;
    verification_url?: string;
    signed_payload?: string;
    issued_at: string;
  };
};
type MePayload = {
  full_name?: string;
  username: string;
};

export default function CourseDetailPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ slug: string }>();
  const slug = useMemo(() => params.slug, [params.slug]);
  const accessToken = useAccessToken();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [examEligibility, setExamEligibility] = useState<ExamEligibility | null>(null);
  const [certificate, setCertificate] = useState<CertificateResponse | null>(null);
  const [studentName, setStudentName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadCourse = useCallback(async (token: string) => {
    try {
      const data = await apiFetch<CourseDetail>(
        `/courses/${slug}/`,
        {},
        token,
      );
      setCourse(data);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to load course.";
      setError(message);
    }
  }, [slug]);

  useEffect(() => {
    const token = accessToken || getAccessToken();
    if (!token) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    void loadCourse(token);
    apiFetch<MePayload>("/me/", {}, token)
      .then((me) => setStudentName((me.full_name || "").trim() || me.username))
      .catch(() => setStudentName(""));
  }, [accessToken, loadCourse, pathname, router]);

  useEffect(() => {
    if (!course?.enrolled || !accessToken) {
      setExamEligibility(null);
      setCertificate(null);
      return;
    }
    Promise.all([
      apiFetch<ExamEligibility>(`/courses/${course.id}/exam-eligibility/`, {}, accessToken),
      apiFetch<CertificateResponse>(`/courses/${course.id}/certificate/`, {}, accessToken).catch(
        () => ({ issued: false } as CertificateResponse),
      ),
    ])
      .then(([eligibility, cert]) => {
        setExamEligibility(eligibility);
        setCertificate(cert);
      })
      .catch(() => setExamEligibility(null));
  }, [course?.enrolled, course?.id, accessToken]);

  const downloadCertificateFile = () => {
    if (!course || !certificate?.issued) return;
    downloadCertificateTemplate({
      courseTitle: course.title,
      certificateCode: certificate.certificate?.certificate_code,
      verificationCode: certificate.certificate?.verification_code,
      verificationUrl: certificate.certificate?.verification_url,
      signedPayload: certificate.certificate?.signed_payload,
      issuedAt: certificate.certificate?.issued_at,
      studentName: studentName || "Student",
    });
  };

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
      await loadCourse(accessToken);
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
              {busy ? "Enrolling..." : "Enroll"}
            </button>
          )}
          {course.enrolled && (
            <p className="mt-5 inline-block rounded-lg border border-emerald-300 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-500">
              Enrolled
            </p>
          )}
          {course.enrolled && certificate?.issued ? (
            <div className="mt-4">
              <button type="button" className="btn btn-primary" onClick={downloadCertificateFile}>
                Download Certificate
              </button>
            </div>
          ) : course.enrolled && examEligibility?.can_take_final_exam && (
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
                    <li key={lesson.id} className="surface-soft flex min-h-14 items-center justify-between px-3 py-2">
                      <div>
                        <p className="text-sm font-medium">
                          {lesson.order}. {lesson.title}
                        </p>
                        {!lesson.locked && lesson.quiz_status === "PASSED" && (
                          <p className="mt-1 text-xs font-medium text-emerald-600">Passed</p>
                        )}
                        {!lesson.locked && lesson.quiz_status === "FAILED" && (
                          <p className="mt-1 text-xs font-medium text-red-600">Failed</p>
                        )}
                      </div>
                      {!lesson.locked ? (
                        <Link
                          href={`/lessons/${lesson.id}`}
                          className="btn btn-primary min-w-20 px-3 py-1.5 text-xs"
                        >
                          Open
                        </Link>
                      ) : (
                        <span className="btn btn-secondary min-w-20 cursor-not-allowed px-3 py-1.5 text-xs opacity-70">
                          Locked
                        </span>
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
