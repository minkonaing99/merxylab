"use client";

import Link from "next/link";
import { useMemo, useState, useEffect } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { useAccessToken } from "@/hooks/use-access-token";
import { downloadCertificateTemplate } from "@/lib/certificate";

type CertificateResponse = {
  issued: boolean;
  certificate?: {
    certificate_code: string;
    verification_code?: string;
    verification_url?: string;
    signed_payload?: string;
    issued_at: string;
    revoked_at?: string | null;
    revoked_reason?: string;
  };
};

type VerifyResponse = {
  valid: boolean;
  status: "valid" | "revoked" | "invalid_signature" | "not_found";
  detail: string;
  certificate?: {
    student_name: string;
    course_title: string;
    issued_at: string;
  };
};

type MePayload = {
  username: string;
  full_name?: string;
};

type EligibilityPayload = {
  course_title?: string;
};

export default function StudentCertificatePage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ courseId: string }>();
  const courseId = useMemo(() => Number(params.courseId), [params.courseId]);
  const accessToken = useAccessToken();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [studentName, setStudentName] = useState("Student");
  const [courseTitle, setCourseTitle] = useState("Course");
  const [certificate, setCertificate] = useState<CertificateResponse["certificate"] | null>(null);
  const [verifyStatus, setVerifyStatus] = useState<VerifyResponse | null>(null);
  const publicVerifyUrl = useMemo(() => {
    if (!certificate?.verification_code) return "";
    if (typeof window === "undefined") return `/verify/${certificate.verification_code}`;
    return `${window.location.origin}/verify/${certificate.verification_code}`;
  }, [certificate?.verification_code]);

  useEffect(() => {
    const token = accessToken || getAccessToken();
    if (!token) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    if (!Number.isFinite(courseId)) {
      setError("Invalid course.");
      setLoading(false);
      return;
    }

    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const [me, certRes, eligibility] = await Promise.all([
          apiFetch<MePayload>("/me/", {}, token),
          apiFetch<CertificateResponse>(`/courses/${courseId}/certificate/`, {}, token),
          apiFetch<EligibilityPayload>(`/courses/${courseId}/exam-eligibility/`, {}, token).catch(() => ({ course_title: "Course" })),
        ]);
        const name = (me.full_name || "").trim() || me.username || "Student";
        setStudentName(name);
        setCourseTitle(eligibility.course_title || "Course");

        if (!certRes.issued || !certRes.certificate) {
          setError("Certificate is not issued yet for this course.");
          setCertificate(null);
          setVerifyStatus(null);
          return;
        }
        setCertificate(certRes.certificate);

        if (certRes.certificate.verification_code) {
          const verify = await apiFetch<VerifyResponse>(`/verify/${certRes.certificate.verification_code}/`);
          setVerifyStatus(verify);
          if (verify.certificate?.course_title) setCourseTitle(verify.certificate.course_title);
          if (verify.certificate?.student_name) setStudentName(verify.certificate.student_name);
        }
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "Failed to load certificate.";
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [accessToken, courseId, pathname, router]);

  const statusLabel = verifyStatus?.status || "not_found";
  const statusClass =
    statusLabel === "valid"
      ? "border-emerald-300 bg-emerald-500/10 text-emerald-600"
      : statusLabel === "revoked"
        ? "border-amber-300 bg-amber-500/10 text-amber-700"
        : "border-red-300 bg-red-500/10 text-red-600";

  const qrImageUrl = publicVerifyUrl
    ? `https://quickchart.io/qr?size=180&text=${encodeURIComponent(publicVerifyUrl)}`
    : "";

  const copyVerificationLink = async () => {
    if (!publicVerifyUrl) return;
    try {
      await navigator.clipboard.writeText(publicVerifyUrl);
      setNotice("Verification link copied.");
    } catch {
      setNotice("Unable to copy link on this browser.");
    }
  };

  return (
    <main className="page-wrap fade-up">
      <h1 className="text-3xl font-semibold md:text-4xl">Certificate Verification Summary</h1>
      <p className="mt-2 text-sm muted">
        This page explains your certification status and how others can verify it.
      </p>

      {loading && <p className="mt-6 text-sm muted">Loading certificate...</p>}
      {error && <p className="mt-4 rounded-lg border border-red-300 bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}
      {notice && <p className="mt-4 rounded-lg border border-emerald-300 bg-emerald-500/10 p-3 text-sm text-emerald-600">{notice}</p>}

      {!loading && certificate && (
        <>
          <section className="surface mt-6 p-5">
            <p className="mb-3 text-sm font-semibold">MerxyLab Certification</p>
            <div className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${statusClass}`}>
              {statusLabel === "valid" ? "Certificate Verified" : statusLabel.replaceAll("_", " ").toUpperCase()}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="surface-soft p-3">
                <p className="muted text-xs">Student</p>
                <p className="font-medium">{studentName}</p>
              </div>
              <div className="surface-soft p-3">
                <p className="muted text-xs">Course</p>
                <p className="font-medium">{courseTitle}</p>
              </div>
              <div className="surface-soft p-3">
                <p className="muted text-xs">Certificate Code</p>
                <p className="font-medium">{certificate.certificate_code}</p>
              </div>
              <div className="surface-soft p-3">
                <p className="muted text-xs">Issued At</p>
                <p className="font-medium">{new Date(certificate.issued_at).toLocaleString()}</p>
              </div>
            </div>
            {verifyStatus && (
              <p className="mt-3 text-sm muted">{verifyStatus.detail}</p>
            )}
            {statusLabel === "revoked" && certificate.revoked_reason && (
              <p className="mt-2 text-sm text-amber-700">Reason: {certificate.revoked_reason}</p>
            )}
          </section>

          <section className="surface mt-6 grid gap-4 p-5 md:grid-cols-[1fr_auto]">
            <div>
              <h2 className="text-lg font-semibold">How Your Certification Works</h2>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm muted">
                <li>Your certificate is issued after you pass the final exam.</li>
                <li>Each certificate has a unique verification code and signed payload.</li>
                <li>Anyone can verify authenticity through your public verification link.</li>
                <li>If revoked or reissued by admin, verification status updates immediately.</li>
              </ul>
              <p className="mt-3 break-all text-xs muted">
                Verification URL: {publicVerifyUrl || "Not available"}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    downloadCertificateTemplate({
                      courseTitle,
                      certificateCode: certificate.certificate_code,
                      verificationCode: certificate.verification_code,
                      verificationUrl: publicVerifyUrl,
                      issuedAt: certificate.issued_at,
                      studentName,
                    })
                  }
                >
                  Download Certificate
                </button>
                <button type="button" className="btn btn-secondary" onClick={copyVerificationLink}>
                  Copy Verification Link
                </button>
                {publicVerifyUrl && (
                  <Link href={publicVerifyUrl} className="btn btn-secondary" target="_blank">
                    Open Public Verify Page
                  </Link>
                )}
              </div>
            </div>
            <div className="surface-soft flex w-full max-w-[220px] flex-col items-center justify-center rounded-xl p-3">
              {qrImageUrl ? (
                <img src={qrImageUrl} alt="Certificate QR code" className="h-44 w-44 rounded border border-slate-200 bg-white p-1" />
              ) : (
                <p className="text-xs muted">No QR available</p>
              )}
              <p className="mt-2 text-xs muted">Scan to verify</p>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
