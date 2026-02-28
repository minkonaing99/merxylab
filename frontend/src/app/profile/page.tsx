"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { useAccessToken } from "@/hooks/use-access-token";

type ProfilePayload = {
  full_name: string;
  date_of_birth: string | null;
  credits?: number;
  passport_number: string;
  passport_photo_url: string;
  phone_number: string;
  country: string;
  city: string;
  address: string;
  verification_status: "PENDING" | "VERIFIED" | "REJECTED";
  verification_note: string;
  completion_flags: Record<string, boolean>;
  profile_completed: boolean;
};

type Enrollment = {
  course: { id: number; title: string };
};

type Eligibility = {
  course_id: number;
  can_take_final_exam: boolean;
  certificate_ready: boolean;
  progress: {
    completion_rate: number;
    completed_lessons: number;
    total_lessons: number;
  };
};

type FormState = {
  full_name: string;
  date_of_birth: string;
  passport_number: string;
  phone_number: string;
  country: string;
  city: string;
  address: string;
};

const EMPTY_FORM: FormState = {
  full_name: "",
  date_of_birth: "",
  passport_number: "",
  phone_number: "",
  country: "",
  city: "",
  address: "",
};

export default function ProfilePage() {
  const router = useRouter();
  const pathname = usePathname();
  const accessToken = useAccessToken();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [passportPhoto, setPassportPhoto] = useState<File | null>(null);
  const [passportPhotoUrl, setPassportPhotoUrl] = useState("");
  const [verificationStatus, setVerificationStatus] = useState<ProfilePayload["verification_status"]>("PENDING");
  const [verificationNote, setVerificationNote] = useState("");
  const [credits, setCredits] = useState(0);
  const [profileCompleted, setProfileCompleted] = useState(false);
  const [completionFlags, setCompletionFlags] = useState<Record<string, boolean>>({});
  const [eligibilityRows, setEligibilityRows] = useState<Array<Eligibility & { course_title: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const flagList = useMemo(
    () => [
      { key: "has_full_name", label: "Full name" },
      { key: "has_date_of_birth", label: "Birthday" },
      { key: "has_passport_number", label: "Passport number" },
      { key: "has_passport_photo", label: "Passport photo" },
    ],
    [],
  );

  useEffect(() => {
    const token = accessToken || getAccessToken();
    if (!token) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }

    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const [profile, me, enrollments] = await Promise.all([
          apiFetch<ProfilePayload>("/me/profile/", {}, token),
          apiFetch<{ role: string }>("/me/", {}, token),
          apiFetch<Enrollment[]>("/me/enrollments/", {}, token),
        ]);
        if (me.role === "admin") {
          router.replace("/admin-ui");
          return;
        }
        setForm({
          full_name: profile.full_name || "",
          date_of_birth: profile.date_of_birth || "",
          passport_number: profile.passport_number || "",
          phone_number: profile.phone_number || "",
          country: profile.country || "",
          city: profile.city || "",
          address: profile.address || "",
        });
        setPassportPhotoUrl(profile.passport_photo_url || "");
        setVerificationStatus(profile.verification_status);
        setVerificationNote(profile.verification_note || "");
        setCredits(profile.credits ?? 0);
        setCompletionFlags(profile.completion_flags || {});
        setProfileCompleted(Boolean(profile.profile_completed));

        const activeCourses = enrollments.map((entry) => entry.course);
        const eligibilityResults = await Promise.all(
          activeCourses.map(async (course) => {
            try {
              const row = await apiFetch<Eligibility>(`/courses/${course.id}/exam-eligibility/`, {}, token);
              return { ...row, course_title: course.title };
            } catch {
              return null;
            }
          }),
        );
        setEligibilityRows(eligibilityResults.filter((row): row is Eligibility & { course_title: string } => Boolean(row)));
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "Failed to load profile.";
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [accessToken, pathname, router]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const token = accessToken || getAccessToken();
    if (!token) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = new FormData();
      payload.append("full_name", form.full_name);
      payload.append("date_of_birth", form.date_of_birth);
      payload.append("passport_number", form.passport_number);
      payload.append("phone_number", form.phone_number);
      payload.append("country", form.country);
      payload.append("city", form.city);
      payload.append("address", form.address);
      if (passportPhoto) {
        payload.append("passport_photo", passportPhoto);
      }

      const updated = await apiFetch<ProfilePayload>("/me/profile/", { method: "PATCH", body: payload }, token);
      setPassportPhotoUrl(updated.passport_photo_url || "");
      setVerificationStatus(updated.verification_status);
      setVerificationNote(updated.verification_note || "");
      setCredits(updated.credits ?? 0);
      setCompletionFlags(updated.completion_flags || {});
      setProfileCompleted(Boolean(updated.profile_completed));
      setPassportPhoto(null);
      setNotice("Profile saved successfully.");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to save profile.";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  if (!accessToken && !getAccessToken()) {
    return <main className="page-wrap">Redirecting to login...</main>;
  }

  return (
    <main className="page-wrap fade-up">
      <h1 className="text-3xl font-semibold md:text-4xl">Student Profile</h1>
      <p className="mt-2 text-sm muted">
        Complete this profile for future certificate issuance after final exam pass.
      </p>
      <div className="mt-3 inline-flex items-center rounded-full border border-emerald-300 bg-emerald-500/10 px-3 py-1 text-sm text-emerald-600">
        Remaining Credits: <strong className="ml-1">{credits}</strong>
      </div>

      {loading && <p className="mt-6 text-sm muted">Loading profile...</p>}
      {error && <p className="mt-4 rounded-lg border border-red-300 bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}
      {notice && <p className="mt-4 rounded-lg border border-emerald-300 bg-emerald-500/10 p-3 text-sm text-emerald-500">{notice}</p>}

      {!loading && (
        <>
          <section className="surface mt-6 p-5">
            <h2 className="text-xl font-semibold">Verification Status</h2>
            <p className="mt-2 text-sm muted">
              Status: <strong>{verificationStatus}</strong>
            </p>
            {verificationNote && <p className="mt-1 text-sm muted">Note: {verificationNote}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {flagList.map((item) => (
                <span
                  key={item.key}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    completionFlags[item.key] ? "border-emerald-300 bg-emerald-500/10 text-emerald-500" : "border-slate-300 bg-slate-500/10 muted"
                  }`}
                >
                  {item.label}
                </span>
              ))}
            </div>
            <p className="mt-3 text-sm">
              Profile completed: <strong>{profileCompleted ? "Yes" : "No"}</strong>
            </p>
          </section>

          <form onSubmit={onSubmit} className="surface mt-6 grid gap-4 p-5 md:grid-cols-2">
            <label className="text-sm">
              Full name
              <input className="input" value={form.full_name} onChange={(e) => setForm((v) => ({ ...v, full_name: e.target.value }))} required />
            </label>
            <label className="text-sm">
              Birthday
              <input type="date" className="input" value={form.date_of_birth} onChange={(e) => setForm((v) => ({ ...v, date_of_birth: e.target.value }))} required />
            </label>
            <label className="text-sm">
              Passport number
              <input className="input" value={form.passport_number} onChange={(e) => setForm((v) => ({ ...v, passport_number: e.target.value }))} required />
            </label>
            <label className="text-sm">
              Phone number
              <input className="input" value={form.phone_number} onChange={(e) => setForm((v) => ({ ...v, phone_number: e.target.value }))} />
            </label>
            <label className="text-sm">
              Country
              <input className="input" value={form.country} onChange={(e) => setForm((v) => ({ ...v, country: e.target.value }))} />
            </label>
            <label className="text-sm">
              City
              <input className="input" value={form.city} onChange={(e) => setForm((v) => ({ ...v, city: e.target.value }))} />
            </label>
            <label className="text-sm md:col-span-2">
              Address
              <textarea className="input min-h-24" value={form.address} onChange={(e) => setForm((v) => ({ ...v, address: e.target.value }))} />
            </label>
            <label className="text-sm md:col-span-2">
              Passport photo (.jpg, .jpeg, .png, .webp, max 5MB)
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.webp"
                className="input"
                onChange={(e) => setPassportPhoto(e.target.files?.[0] ?? null)}
              />
            </label>
            {passportPhotoUrl && (
              <div className="md:col-span-2">
                <p className="mb-2 text-sm muted">Current uploaded passport photo:</p>
                <img src={passportPhotoUrl} alt="Passport preview" className="max-h-56 rounded-xl border" />
              </div>
            )}
            <div className="md:col-span-2">
              <button className="btn btn-primary" disabled={saving}>
                {saving ? "Saving..." : "Save Profile"}
              </button>
            </div>
          </form>

          <section className="surface mt-6 p-5">
            <h2 className="text-xl font-semibold">Final Exam Readiness</h2>
            <p className="mt-2 text-sm muted">
              Final exam will be enabled only after all lessons are completed and all lesson quizzes are passed.
            </p>
            <div className="mt-4 space-y-2">
              {eligibilityRows.map((row) => (
                <div key={row.course_id} className="surface-soft flex flex-wrap items-center justify-between gap-3 p-3">
                  <div>
                    <p className="text-sm font-semibold">{row.course_title}</p>
                    <p className="text-xs muted">
                      Progress: {row.progress.completed_lessons}/{row.progress.total_lessons} ({row.progress.completion_rate}%)
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className={`rounded-full border px-3 py-1 ${row.can_take_final_exam ? "border-emerald-300 bg-emerald-500/10 text-emerald-500" : "border-slate-300 bg-slate-500/10 muted"}`}>
                      {row.can_take_final_exam ? "Exam Unlocked" : "Exam Locked"}
                    </span>
                    <span className={`rounded-full border px-3 py-1 ${row.certificate_ready ? "border-emerald-300 bg-emerald-500/10 text-emerald-500" : "border-slate-300 bg-slate-500/10 muted"}`}>
                      {row.certificate_ready ? "Certificate Ready" : "Certificate Pending"}
                    </span>
                    {row.can_take_final_exam && (
                      <button
                        type="button"
                        className="btn btn-primary px-3 py-1"
                        onClick={() => router.push(`/final-exam/${row.course_id}`)}
                      >
                        Take Final Exam
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {eligibilityRows.length === 0 && <p className="text-sm muted">No enrolled courses yet.</p>}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
