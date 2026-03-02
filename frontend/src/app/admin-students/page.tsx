"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { useAccessToken } from "@/hooks/use-access-token";
import { setTheme } from "@/lib/theme";

type StudentRow = {
  user_id: number;
  username: string;
  email: string;
  full_name?: string;
  verification_status?: "PENDING" | "VERIFIED" | "REJECTED";
  has_passport_photo?: boolean;
  role: string;
  credits: number;
  enrollments: number;
  owned_courses?: string[];
};

type WalletPayload = {
  student: { id: number; username: string; email: string };
  wallet: { balance_credits: number; updated_at: string };
  transactions: Array<{
    id: number;
    amount: number;
    balance_after: number;
    kind: string;
    note: string;
    course_title?: string;
    created_by_username?: string;
    created_at: string;
  }>;
  enrollments: Array<{
    id: number;
    course: { title: string };
    status: string;
    payment_provider: string;
  }>;
};
type StudentProfilePayload = {
  student: { id: number; username: string; email: string };
  profile: {
    full_name: string;
    date_of_birth: string | null;
    passport_number: string;
    passport_photo_url: string;
    phone_number: string;
    country: string;
    city: string;
    address: string;
    verification_status: "PENDING" | "VERIFIED" | "REJECTED";
    verification_note: string;
    profile_completed: boolean;
  };
};

export default function AdminStudentsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const accessToken = useAccessToken();
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);
  const [walletDetail, setWalletDetail] = useState<WalletPayload | null>(null);
  const [studentProfile, setStudentProfile] = useState<StudentProfilePayload | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    setTheme("light");
  }, []);

  const loadStudents = useCallback(async (token: string) => {
    const rows = await apiFetch<StudentRow[]>("/admin/students/", {}, token);
    setStudents(rows);
  }, []);

  const loadWallet = useCallback(async (token: string, userId: number) => {
    const payload = await apiFetch<WalletPayload>(`/admin/students/${userId}/wallet/`, {}, token);
    setWalletDetail(payload);
  }, []);
  const loadProfile = useCallback(async (token: string, userId: number) => {
    const payload = await apiFetch<StudentProfilePayload>(`/admin/students/${userId}/profile/`, {}, token);
    setStudentProfile(payload);
  }, []);

  useEffect(() => {
    const token = accessToken || getAccessToken();
    if (!token) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    apiFetch<{ role?: string }>("/me/", {}, token)
      .then(async (me) => {
        if (me.role !== "admin") {
          setIsAdmin(false);
          router.replace("/dashboard");
          return;
        }
        setIsAdmin(true);
        await loadStudents(token);
      })
      .catch(() => {
        setIsAdmin(false);
        router.replace("/dashboard");
      });
  }, [accessToken, loadStudents, pathname, router]);

  useEffect(() => {
    const token = accessToken || getAccessToken();
    if (!token || !selectedStudentId) return;
    loadWallet(token, selectedStudentId).catch(() => setWalletDetail(null));
    loadProfile(token, selectedStudentId).catch(() => setStudentProfile(null));
  }, [accessToken, loadProfile, loadWallet, selectedStudentId]);

  const adjustCredits = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const token = accessToken || getAccessToken();
    if (!token || !selectedStudentId) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await apiFetch(
        `/admin/students/${selectedStudentId}/wallet/adjust/`,
        { method: "POST", body: JSON.stringify({ amount: Number(amount), note }) },
        token,
      );
      await loadStudents(token);
      await loadWallet(token, selectedStudentId);
      setAmount("");
      setNote("");
      setNotice("Credits updated.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to adjust credits.");
    } finally {
      setLoading(false);
    }
  };

  const reviewProfile = async (action: "approve" | "deny") => {
    const token = accessToken || getAccessToken();
    if (!token || !selectedStudentId) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const payload = await apiFetch<{ detail: string }>(
        `/admin/students/${selectedStudentId}/profile/review/`,
        { method: "POST", body: JSON.stringify({ action, note: reviewNote }) },
        token,
      );
      await loadStudents(token);
      await loadProfile(token, selectedStudentId);
      setNotice(payload.detail);
      if (action === "approve") {
        setReviewNote("");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to review profile.");
    } finally {
      setLoading(false);
    }
  };

  if (isAdmin === null) {
    return <main className="admin-theme-scope page-wrap">Checking access...</main>;
  }

  return (
    <main className="admin-theme-scope page-wrap fade-up">
      <h1 className="text-3xl font-semibold md:text-4xl">Student Credit Management</h1>
      <p className="mt-2 text-sm muted">Manage student profile verification, passport review, balances, and enrollment payment status.</p>
      {error && <p className="mt-4 rounded-lg border border-red-300 bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}
      {notice && <p className="mt-4 rounded-lg border border-emerald-300 bg-emerald-500/10 p-3 text-sm text-emerald-500">{notice}</p>}

      <section className="mt-6 surface p-5">
        <h2 className="text-lg font-semibold">Student Profile Verification</h2>
        {!studentProfile && <p className="mt-3 text-sm muted">Select a student to review profile and passport details.</p>}
        {studentProfile && (
          <>
            <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
              <p><strong>Full Name:</strong> {studentProfile.profile.full_name || "-"}</p>
              <p><strong>Date of Birth:</strong> {studentProfile.profile.date_of_birth || "-"}</p>
              <p><strong>Passport Number:</strong> {studentProfile.profile.passport_number || "-"}</p>
              <p><strong>Phone:</strong> {studentProfile.profile.phone_number || "-"}</p>
              <p><strong>Country/City:</strong> {studentProfile.profile.country || "-"} / {studentProfile.profile.city || "-"}</p>
              <p><strong>Current Status:</strong> {studentProfile.profile.verification_status}</p>
              <p className="md:col-span-2"><strong>Address:</strong> {studentProfile.profile.address || "-"}</p>
              <p className="md:col-span-2"><strong>Admin Note:</strong> {studentProfile.profile.verification_note || "-"}</p>
            </div>
            <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-medium">Passport Photo</p>
              {studentProfile.profile.passport_photo_url ? (
                <img
                  src={studentProfile.profile.passport_photo_url}
                  alt="Passport"
                  className="mt-2 max-h-80 w-full max-w-md rounded border object-contain"
                />
              ) : (
                <p className="mt-2 text-xs muted">No passport photo uploaded.</p>
              )}
            </div>
            {studentProfile.profile.passport_photo_url && studentProfile.profile.verification_status !== "VERIFIED" ? (
              <div className="mt-3 grid gap-2">
                <input
                  className="input"
                  placeholder="Review note (optional for approve, recommended for deny)"
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                />
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button type="button" className="btn btn-primary" disabled={loading} onClick={() => reviewProfile("approve")}>
                    Approve
                  </button>
                  <button type="button" className="btn btn-danger" disabled={loading} onClick={() => reviewProfile("deny")}>
                    Deny (Require Re-upload)
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs muted">
                {studentProfile.profile.verification_status === "VERIFIED"
                  ? "Profile is already approved."
                  : "Approval actions are available after the student uploads a passport photo."}
              </p>
            )}
          </>
        )}
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="surface p-5">
          <h2 className="text-lg font-semibold">Students</h2>
          <div className="mt-3 grid gap-3 md:hidden">
            {students.map((student) => (
              <article key={student.user_id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{student.username}</p>
                    <p className="text-xs muted">{student.email || "no email"}</p>
                    {student.full_name && <p className="text-xs muted">{student.full_name}</p>}
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${
                    student.verification_status === "VERIFIED"
                      ? "bg-emerald-100 text-emerald-700"
                      : student.verification_status === "REJECTED"
                        ? "bg-red-100 text-red-700"
                        : "bg-amber-100 text-amber-700"
                  }`}>
                    {student.verification_status || "PENDING"}
                  </span>
                </div>
                <div className="mt-2 text-sm">
                  <p><strong>Credits:</strong> {student.credits}</p>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(student.owned_courses ?? []).slice(0, 3).map((course) => (
                    <span key={course} className="rounded-full bg-white px-2 py-0.5 text-xs">
                      {course}
                    </span>
                  ))}
                  {(student.owned_courses ?? []).length === 0 && <span className="text-xs muted">No owned courses</span>}
                  {(student.owned_courses ?? []).length > 3 && (
                    <span className="text-xs muted">+{(student.owned_courses ?? []).length - 3} more</span>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-secondary mt-3 w-full px-3 py-1 text-xs"
                  onClick={() => setSelectedStudentId(student.user_id)}
                >
                  Manage
                </button>
              </article>
            ))}
            {students.length === 0 && <p className="text-sm muted">No students found.</p>}
          </div>
          <div className="mt-3 hidden overflow-x-auto md:block">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b text-slate-600">
                <tr>
                  <th className="py-2 pr-4">Username</th>
                  <th className="py-2 pr-4">Verification</th>
                  <th className="py-2 pr-4">Credits</th>
                  <th className="py-2 pr-4">Owned Courses</th>
                  <th className="py-2 pr-0">Action</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.user_id} className="border-b last:border-0">
                    <td className="py-2 pr-4">
                      <div className="font-medium">{student.username}</div>
                      <div className="text-xs muted">{student.email || "no email"}</div>
                      {student.full_name && <div className="text-xs muted">{student.full_name}</div>}
                    </td>
                    <td className="py-2 pr-4">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${
                        student.verification_status === "VERIFIED"
                          ? "bg-emerald-100 text-emerald-700"
                          : student.verification_status === "REJECTED"
                            ? "bg-red-100 text-red-700"
                            : "bg-amber-100 text-amber-700"
                      }`}>
                        {student.verification_status || "PENDING"}
                      </span>
                    </td>
                    <td className="py-2 pr-4">{student.credits}</td>
                    <td className="py-2 pr-4">
                      <div className="flex flex-wrap gap-1">
                        {(student.owned_courses ?? []).slice(0, 3).map((course) => (
                          <span key={course} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                            {course}
                          </span>
                        ))}
                        {(student.owned_courses ?? []).length === 0 && <span className="text-xs muted">None</span>}
                        {(student.owned_courses ?? []).length > 3 && (
                          <span className="text-xs muted">+{(student.owned_courses ?? []).length - 3} more</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-0">
                      <button
                        type="button"
                        className="btn btn-secondary px-3 py-1 text-xs"
                        onClick={() => setSelectedStudentId(student.user_id)}
                      >
                        Manage
                      </button>
                    </td>
                  </tr>
                ))}
                {students.length === 0 && (
                  <tr>
                    <td className="py-3 text-sm muted" colSpan={5}>No students found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="surface p-5">
          <h2 className="text-lg font-semibold">Wallet Detail</h2>
          {!walletDetail && <p className="mt-3 text-sm muted">Select a student from the left table.</p>}
          {walletDetail && (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <p>Student: <strong>{walletDetail.student.username}</strong></p>
                <p>Balance: <strong>{walletDetail.wallet.balance_credits}</strong></p>
              </div>
              <form onSubmit={adjustCredits} className="mt-3 grid gap-2">
                <input
                  type="number"
                  className="input"
                  placeholder="Amount (+add / -deduct)"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
                <input
                  className="input"
                  placeholder="Note (optional)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <button className="btn btn-primary" disabled={loading}>
                  {loading ? "Saving..." : "Apply Credit Adjustment"}
                </button>
              </form>

              <h3 className="mt-5 text-sm font-semibold">Recent Transactions</h3>
              <div className="mt-2 max-h-64 overflow-y-auto rounded border border-slate-200">
                <ul className="divide-y divide-slate-200 text-sm">
                  {walletDetail.transactions.map((tx) => (
                    <li key={tx.id} className="p-3">
                      <div className="flex items-center justify-between">
                        <span className={tx.amount >= 0 ? "text-emerald-600" : "text-red-600"}>
                          {tx.amount >= 0 ? `+${tx.amount}` : tx.amount}
                        </span>
                        <span className="text-xs muted">After: {tx.balance_after}</span>
                      </div>
                      <p className="text-xs muted">
                        {tx.kind} {tx.course_title ? `| ${tx.course_title}` : ""} {tx.note ? `| ${tx.note}` : ""}
                      </p>
                    </li>
                  ))}
                  {walletDetail.transactions.length === 0 && <li className="p-3 text-xs muted">No transactions yet.</li>}
                </ul>
              </div>

              <h3 className="mt-5 text-sm font-semibold">Owned Courses</h3>
              <div className="mt-2 max-h-40 overflow-y-auto rounded border border-slate-200 p-2">
                <ul className="space-y-1 text-sm">
                  {walletDetail.enrollments.map((enrollment) => (
                    <li key={enrollment.id} className="flex items-start justify-between gap-2 rounded bg-slate-50 px-2 py-1">
                      <span className="min-w-0 flex-1 break-words">{enrollment.course.title}</span>
                      <span className="text-xs muted">{enrollment.status}</span>
                    </li>
                  ))}
                  {walletDetail.enrollments.length === 0 && <li className="text-xs muted">No enrolled courses.</li>}
                </ul>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
