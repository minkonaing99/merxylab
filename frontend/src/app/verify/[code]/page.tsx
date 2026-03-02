"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";

type VerifyResponse = {
  valid: boolean;
  status: "valid" | "revoked" | "invalid_signature" | "not_found";
  detail: string;
  certificate?: {
    certificate_code: string;
    verification_code: string;
    student_name: string;
    course_title: string;
    issued_at: string;
    revoked_at?: string | null;
    revoked_reason?: string;
    signature_version: number;
    signed_payload: string;
    signature_state: string;
  };
};

export default function VerifyCertificatePage() {
  const params = useParams<{ code: string }>();
  const code = useMemo(() => String(params.code || "").trim(), [params.code]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState<VerifyResponse | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await apiFetch<VerifyResponse>(`/verify/${encodeURIComponent(code)}/`);
        setPayload(res);
      } catch (err) {
        if (err instanceof ApiError && err.payload && typeof err.payload === "object" && !Array.isArray(err.payload)) {
          setPayload(err.payload as VerifyResponse);
          setError(err.message);
        } else {
          setError("Unable to verify certificate.");
        }
      } finally {
        setLoading(false);
      }
    };
    if (code) void load();
  }, [code]);

  const statusTone =
    payload?.status === "valid"
      ? "border-emerald-300 bg-emerald-500/10 text-emerald-600"
      : payload?.status === "revoked"
        ? "border-amber-300 bg-amber-500/10 text-amber-700"
        : "border-red-300 bg-red-500/10 text-red-600";

  return (
    <main className="page-wrap fade-up">
      <h1 className="text-3xl font-semibold md:text-4xl">Certificate Verification</h1>
      <p className="mt-2 text-sm muted">Public trust check for MerxyLab certificates.</p>

      {loading && <p className="mt-6 text-sm muted">Verifying certificate...</p>}
      {!loading && payload && (
        <section className="surface mt-6 p-5">
          <div className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${statusTone}`}>
            {payload.status === "valid" ? "Valid Certificate" : payload.status.replaceAll("_", " ").toUpperCase()}
          </div>
          <p className="mt-3 text-sm">{payload.detail}</p>

          {payload.certificate && (
            <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
              <div className="surface-soft p-3">
                <p className="muted">Student</p>
                <p className="font-medium">{payload.certificate.student_name}</p>
              </div>
              <div className="surface-soft p-3">
                <p className="muted">Course</p>
                <p className="font-medium">{payload.certificate.course_title}</p>
              </div>
              <div className="surface-soft p-3">
                <p className="muted">Certificate Code</p>
                <p className="font-medium">{payload.certificate.certificate_code}</p>
              </div>
              <div className="surface-soft p-3">
                <p className="muted">Issued At</p>
                <p className="font-medium">{new Date(payload.certificate.issued_at).toLocaleString()}</p>
              </div>
              <div className="surface-soft p-3 md:col-span-2">
                <p className="muted">Signed Payload (v{payload.certificate.signature_version})</p>
                <pre className="mt-2 overflow-auto whitespace-pre-wrap break-all rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                  {payload.certificate.signed_payload}
                </pre>
              </div>
            </div>
          )}
        </section>
      )}
      {!loading && !payload && (
        <p className="mt-6 rounded-lg border border-red-300 bg-red-500/10 p-3 text-sm text-red-600">
          {error || "Certificate not found."}
        </p>
      )}

      <div className="mt-6">
        <Link href="/" className="btn btn-secondary">
          Back to Home
        </Link>
      </div>
    </main>
  );
}
