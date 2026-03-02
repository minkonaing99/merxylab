"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { ApiError, apiFetch } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";

export type AdminUploadStatus = "UPLOADING" | "QUEUED" | "PROCESSING" | "RETRYING" | "COMPLETED" | "FAILED";

export type AdminTrackedUploadJob = {
  key: string;
  job_id?: number;
  lesson_id?: number;
  video_name: string;
  course_label: string;
  lesson_label: string;
  status: AdminUploadStatus;
  progress_percent: number;
  attempt_count: number;
  max_attempts: number;
  error_message?: string;
  updated_at: number;
};

type UploadJobApiPayload = {
  id: number;
  lesson_id: number;
  status: "QUEUED" | "PROCESSING" | "RETRYING" | "COMPLETED" | "FAILED";
  progress_percent: number;
  attempt_count: number;
  max_attempts: number;
  error_message?: string;
};

type UploadMeta = {
  videoName: string;
  courseLabel: string;
  lessonLabel: string;
};

type AdminUploadTrackerContextValue = {
  jobs: AdminTrackedUploadJob[];
  beginUploading: (meta: UploadMeta) => string;
  updateUploadingProgress: (localKey: string, progressPercent: number) => void;
  markUploadFailed: (localKey: string, message: string) => void;
  bindServerJob: (localKey: string, job: UploadJobApiPayload) => string;
  upsertServerJob: (job: UploadJobApiPayload) => void;
  clearJob: (keyOrJobId: string | number) => void;
};

const AdminUploadTrackerContext = createContext<AdminUploadTrackerContextValue | null>(null);

const ACTIVE_STATUSES: AdminUploadStatus[] = ["UPLOADING", "QUEUED", "PROCESSING", "RETRYING"];

function isActiveStatus(status: AdminUploadStatus) {
  return ACTIVE_STATUSES.includes(status);
}

function normalizeProgress(status: AdminUploadStatus, progress: number) {
  const clamped = Math.max(0, Math.min(100, Math.round(progress)));
  if (status === "UPLOADING") return clamped;
  if (status === "QUEUED") return Math.max(5, clamped);
  return clamped;
}

function statusLabel(status: AdminUploadStatus) {
  switch (status) {
    case "UPLOADING":
      return "Uploading";
    case "QUEUED":
      return "Queued";
    case "PROCESSING":
      return "Processing";
    case "RETRYING":
      return "Retrying";
    case "COMPLETED":
      return "Completed";
    case "FAILED":
      return "Failed";
    default:
      return status;
  }
}

export function AdminUploadTrackerProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [jobs, setJobs] = useState<AdminTrackedUploadJob[]>([]);

  const beginUploading = useCallback((meta: UploadMeta) => {
    const localKey = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setJobs((prev) => [
      ...prev,
      {
        key: localKey,
        video_name: meta.videoName,
        course_label: meta.courseLabel,
        lesson_label: meta.lessonLabel,
        status: "UPLOADING",
        progress_percent: 0,
        attempt_count: 0,
        max_attempts: 0,
        updated_at: Date.now(),
      },
    ]);
    return localKey;
  }, []);

  const updateUploadingProgress = useCallback((localKey: string, progressPercent: number) => {
    setJobs((prev) =>
      prev.map((job) =>
        job.key === localKey
          ? {
              ...job,
              status: "UPLOADING",
              progress_percent: normalizeProgress("UPLOADING", progressPercent),
              updated_at: Date.now(),
            }
          : job,
      ),
    );
  }, []);

  const markUploadFailed = useCallback((localKey: string, message: string) => {
    setJobs((prev) =>
      prev.filter((job) => job.key !== localKey).concat({
        key: localKey,
        video_name: prev.find((job) => job.key === localKey)?.video_name ?? "Video",
        course_label: prev.find((job) => job.key === localKey)?.course_label ?? "Course",
        lesson_label: prev.find((job) => job.key === localKey)?.lesson_label ?? "Lesson",
        status: "FAILED",
        progress_percent: 0,
        attempt_count: 0,
        max_attempts: 0,
        error_message: message,
        updated_at: Date.now(),
      }),
    );
    window.setTimeout(() => {
      setJobs((prev) => prev.filter((job) => job.key !== localKey));
    }, 2500);
  }, []);

  const bindServerJob = useCallback((localKey: string, job: UploadJobApiPayload) => {
    const serverKey = String(job.id);
    setJobs((prev) => {
      const local = prev.find((item) => item.key === localKey);
      const serverItem: AdminTrackedUploadJob = {
        key: serverKey,
        job_id: job.id,
        lesson_id: job.lesson_id,
        video_name: local?.video_name ?? "Video",
        course_label: local?.course_label ?? "Course",
        lesson_label: local?.lesson_label ?? `Lesson ${job.lesson_id}`,
        status: job.status,
        progress_percent: normalizeProgress(job.status, job.progress_percent),
        attempt_count: job.attempt_count,
        max_attempts: job.max_attempts,
        error_message: job.error_message,
        updated_at: Date.now(),
      };
      return prev.filter((item) => item.key !== localKey && item.key !== serverKey).concat(serverItem);
    });
    return serverKey;
  }, []);

  const upsertServerJob = useCallback((job: UploadJobApiPayload) => {
    const key = String(job.id);
    setJobs((prev) => {
      const existing = prev.find((item) => item.key === key);
      if (!existing) return prev;
      const next: AdminTrackedUploadJob = {
        ...existing,
        key,
        job_id: job.id,
        lesson_id: job.lesson_id,
        status: job.status,
        progress_percent: normalizeProgress(job.status, job.progress_percent),
        attempt_count: job.attempt_count,
        max_attempts: job.max_attempts,
        error_message: job.error_message,
        updated_at: Date.now(),
      };
      if (!isActiveStatus(next.status)) {
        return prev.filter((item) => item.key !== key);
      }
      return prev.map((item) => (item.key === key ? next : item));
    });
  }, []);

  const clearJob = useCallback((keyOrJobId: string | number) => {
    const key = String(keyOrJobId);
    setJobs((prev) => prev.filter((job) => job.key !== key));
  }, []);

  useEffect(() => {
    const activeServerJobs = jobs.filter((job) => isActiveStatus(job.status) && typeof job.job_id === "number");
    if (!activeServerJobs.length) return;
    const token = getAccessToken();
    if (!token) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const results = await Promise.all(
          activeServerJobs.map(async (job) => {
            try {
              return await apiFetch<UploadJobApiPayload>(`/admin/upload-jobs/${job.job_id}/`, {}, token);
            } catch (err) {
              if (err instanceof ApiError && err.status === 404) return null;
              throw err;
            }
          }),
        );
        if (cancelled) return;
        for (const payload of results) {
          if (!payload) continue;
          upsertServerJob(payload);
        }
      } catch {
        // Keep previous state; next poll will retry.
      }
    };

    void tick();
    const interval = window.setInterval(() => {
      void tick();
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [jobs, upsertServerJob]);

  const activeJobs = useMemo(
    () =>
      jobs
        .filter((job) => isActiveStatus(job.status))
        .sort((a, b) => a.updated_at - b.updated_at),
    [jobs],
  );

  const showPanel = pathname.startsWith("/admin") && activeJobs.length > 0;

  return (
    <AdminUploadTrackerContext.Provider
      value={{
        jobs,
        beginUploading,
        updateUploadingProgress,
        markUploadFailed,
        bindServerJob,
        upsertServerJob,
        clearJob,
      }}
    >
      {children}
      {showPanel && (
        <aside className="fixed bottom-4 right-4 z-[70] w-[360px] max-w-[calc(100vw-1.5rem)] rounded-xl border border-slate-300 bg-white/95 p-3 shadow-2xl backdrop-blur">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Video Processing</p>
          <div className="max-h-72 space-y-2 overflow-auto pr-1">
            {activeJobs.map((job) => (
              <div key={job.key} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <p className="truncate text-sm font-semibold text-slate-900">{job.video_name}</p>
                <p className="truncate text-xs text-slate-600">
                  {job.course_label} / {job.lesson_label}
                </p>
                <div className="mt-1.5 flex items-center justify-between text-xs text-slate-600">
                  <span>
                    {statusLabel(job.status)}
                    {job.max_attempts > 0 ? ` • Attempt ${job.attempt_count}/${job.max_attempts}` : ""}
                  </span>
                  <span>{Math.max(0, Math.min(100, job.progress_percent))}%</span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full transition-all duration-500 ${
                      job.status === "RETRYING" ? "bg-amber-500" : job.status === "UPLOADING" ? "bg-blue-500" : "bg-emerald-600"
                    }`}
                    style={{ width: `${Math.max(0, Math.min(100, job.progress_percent))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </aside>
      )}
    </AdminUploadTrackerContext.Provider>
  );
}

export function useAdminUploadTracker() {
  const ctx = useContext(AdminUploadTrackerContext);
  if (!ctx) {
    throw new Error("useAdminUploadTracker must be used inside AdminUploadTrackerProvider");
  }
  return ctx;
}

