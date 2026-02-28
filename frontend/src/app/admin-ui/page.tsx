"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { API_BASE_URL, ApiError, apiFetch } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { useAccessToken } from "@/hooks/use-access-token";

type Course = {
  id: number;
  title: string;
  slug: string;
  description: string;
  level: string;
  is_published: boolean;
  enrollment_count?: number;
};

type Section = { id: number; course_id: number; title: string; order: number };
type Lesson = {
  id: number;
  title: string;
  order: number;
  content_type: "VIDEO" | "READING";
  course_id: number;
  section_id: number;
  section_title: string;
  is_preview: boolean;
  hls_master_path?: string;
  reading_content?: string;
};

type Quiz = {
  id: number;
  lesson_id: number;
  lesson_title: string;
  course_title: string;
  passing_score?: number;
  time_limit_sec?: number | null;
};
type EnrollmentRow = {
  id: number;
  status: string;
  enrolled_at: string;
  user: { id: number; username: string; email: string };
};

type AdminInsights = {
  totals: {
    courses: number;
    published_courses: number;
    students: number;
    enrollments: number;
    lessons: number;
    quizzes: number;
    quiz_attempts: number;
    quiz_passes: number;
    pass_rate: number;
  };
  courses: Array<{
    course_id: number;
    title: string;
    slug: string;
    is_published: boolean;
    enrollments: number;
    lessons: number;
    quizzes: number;
    quiz_attempts: number;
    quiz_passes: number;
    pass_rate: number;
  }>;
};

type QuizChoiceForm = { text: string; is_correct: boolean };
type QuizQuestionForm = {
  prompt: string;
  order: number;
  choices: QuizChoiceForm[];
};

type FeedbackTarget =
  | "global"
  | "step1-course"
  | "step2-lesson"
  | "step3-upload"
  | "step4-quiz"
  | "manage-course"
  | "manage-lesson"
  | "manage-quiz";

export default function AdminUiPage() {
  const router = useRouter();
  const pathname = usePathname();
  const accessToken = useAccessToken();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{
    target: FeedbackTarget;
    type: "success" | "error";
    message: string;
  } | null>(null);

  const [courses, setCourses] = useState<Course[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [insights, setInsights] = useState<AdminInsights | null>(null);

  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);
  const [selectedLessonIdForVideo, setSelectedLessonIdForVideo] = useState<number | null>(null);
  const [selectedLessonIdForQuiz, setSelectedLessonIdForQuiz] = useState<number | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPhase, setUploadPhase] = useState<"idle" | "uploading" | "processing">("idle");
  const [dragOver, setDragOver] = useState(false);
  const [courseEnrollments, setCourseEnrollments] = useState<EnrollmentRow[]>([]);
  const [showEnrollmentsForCourseId, setShowEnrollmentsForCourseId] = useState<number | null>(null);

  const [courseForm, setCourseForm] = useState({
    title: "",
    slug: "",
    description: "",
    level: "Beginner",
    is_published: true,
  });

  const [lessonForm, setLessonForm] = useState({
    section_id: "",
    section_title: "",
    section_order: 1,
    title: "",
    order: 1,
    content_type: "VIDEO" as "VIDEO" | "READING",
    is_preview: false,
    reading_content: "",
  });

  const [quizForm, setQuizForm] = useState({
    passing_score: 70,
    time_limit_sec: "",
    questions: [
      {
        prompt: "",
        order: 1,
        choices: [
          { text: "", is_correct: true },
          { text: "", is_correct: false },
        ],
      },
    ] as QuizQuestionForm[],
  });
  const [editCourseForm, setEditCourseForm] = useState({
    id: "",
    title: "",
    slug: "",
    level: "",
    description: "",
    is_published: false,
  });
  const [editLessonForm, setEditLessonForm] = useState({
    id: "",
    title: "",
    order: 1,
    content_type: "VIDEO" as "VIDEO" | "READING",
    is_preview: false,
    reading_content: "",
  });
  const [editQuizForm, setEditQuizForm] = useState({
    id: "",
    passing_score: 70,
    time_limit_sec: "",
  });

  const selectedCourseSections = useMemo(
    () => sections.filter((section) => section.course_id === selectedCourseId),
    [sections, selectedCourseId],
  );
  const selectedCourseLessons = useMemo(
    () => lessons.filter((lesson) => lesson.course_id === selectedCourseId),
    [lessons, selectedCourseId],
  );

  const renderFeedback = (target: FeedbackTarget) => {
    if (!feedback || feedback.target !== target) return null;
    return (
      <p
        className={`mt-3 rounded-md p-3 text-sm ${
          feedback.type === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
        }`}
      >
        {feedback.message}
      </p>
    );
  };

  const loadData = useCallback(async () => {
    if (!accessToken) return;
    const [courseData, lessonData, quizData, insightData] = await Promise.all([
      apiFetch<Course[]>("/admin/courses/", {}, accessToken),
      apiFetch<Lesson[]>("/admin/lessons/", {}, accessToken),
      apiFetch<Quiz[]>("/admin/quizzes/", {}, accessToken),
      apiFetch<AdminInsights>("/admin/insights/", {}, accessToken),
    ]);
    setCourses(courseData);
    setLessons(lessonData);
    setQuizzes(quizData);
    setInsights(insightData);
  }, [accessToken]);

  useEffect(() => {
    const token = accessToken || getAccessToken();
    if (!token) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    apiFetch<{ role?: string }>("/me/", {}, token)
      .then((me) => {
        if (me.role !== "admin") {
          setIsAdmin(false);
          router.replace("/dashboard");
          return;
        }
        setIsAdmin(true);
      })
      .catch(() => {
        setIsAdmin(false);
        router.replace("/dashboard");
      });
  }, [accessToken, pathname, router]);

  useEffect(() => {
    if (isAdmin !== true) return;
    void loadData().catch((err) => {
      setFeedback({
        target: "global",
        type: "error",
        message: err instanceof ApiError ? err.message : "Failed to load admin data.",
      });
    });
  }, [isAdmin, loadData]);

  useEffect(() => {
    if (!accessToken || selectedCourseId == null || isAdmin !== true) {
      setSections([]);
      return;
    }
    apiFetch<Section[]>(`/admin/sections/?course_id=${selectedCourseId}`, {}, accessToken)
      .then(setSections)
      .catch(() => setSections([]));
  }, [accessToken, isAdmin, selectedCourseId]);

  const runAction = async (action: () => Promise<void>, successMessage: string, target: FeedbackTarget) => {
    setLoading(true);
    setFeedback(null);
    try {
      await action();
      setFeedback({ target, type: "success", message: successMessage });
      await loadData();
    } catch (err) {
      setFeedback({ target, type: "error", message: err instanceof ApiError ? err.message : "Action failed." });
    } finally {
      setLoading(false);
    }
  };

  const createCourse = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!accessToken) return;
    await runAction(
      async () => {
        const created = await apiFetch<Course>(
          "/admin/courses/",
          { method: "POST", body: JSON.stringify({ ...courseForm, price_cents: 0 }) },
          accessToken,
        );
        setSelectedCourseId(created.id);
        setCourseForm({ title: "", slug: "", description: "", level: "Beginner", is_published: true });
      },
      "Course created. Continue with Step 2.",
      "step1-course",
    );
  };

  const createLesson = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!accessToken || selectedCourseId == null) return;
    await runAction(
      async () => {
        const payload: Record<string, unknown> = {
          course_id: selectedCourseId,
          title: lessonForm.title,
          order: lessonForm.order,
          content_type: lessonForm.content_type,
          is_preview: lessonForm.is_preview,
          reading_content: lessonForm.content_type === "READING" ? lessonForm.reading_content : "",
        };
        if (lessonForm.section_id) {
          payload.section_id = Number(lessonForm.section_id);
        } else {
          payload.section_title = lessonForm.section_title;
          payload.section_order = lessonForm.section_order;
        }
        await apiFetch("/admin/lessons/", { method: "POST", body: JSON.stringify(payload) }, accessToken);
        setLessonForm({
          section_id: "",
          section_title: "",
          section_order: 1,
          title: "",
          order: lessonForm.order + 1,
          content_type: "VIDEO",
          is_preview: false,
          reading_content: "",
        });
      },
      "Lesson created.",
      "step2-lesson",
    );
  };

  const uploadVideo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!accessToken || !videoFile || !selectedLessonIdForVideo) return;
    setLoading(true);
    setFeedback(null);
    setUploadProgress(0);
    setUploadPhase("uploading");
    try {
      await new Promise<void>((resolve, reject) => {
        const formData = new FormData();
        formData.append("lesson_id", String(selectedLessonIdForVideo));
        formData.append("video", videoFile);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${API_BASE_URL}/admin/upload-video/`);
        xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable) return;
          const percent = Math.round((e.loaded / e.total) * 100);
          setUploadProgress(percent);
          if (percent >= 100) {
            setUploadPhase("processing");
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            setUploadProgress(100);
            setUploadPhase("idle");
            resolve();
            return;
          }
          try {
            const payload = JSON.parse(xhr.responseText) as { detail?: string };
            reject(new Error(payload.detail || `Upload failed (${xhr.status})`));
          } catch {
            reject(new Error(`Upload failed (${xhr.status})`));
          }
        };
        xhr.onerror = () => reject(new Error("Network error during upload."));
        xhr.send(formData);
      });

      setVideoFile(null);
      setFeedback({ target: "step3-upload", type: "success", message: "Video uploaded and converted to HLS." });
      await loadData();
    } catch (err) {
      setFeedback({ target: "step3-upload", type: "error", message: err instanceof Error ? err.message : "Video upload failed." });
    } finally {
      setLoading(false);
      window.setTimeout(() => {
        setUploadProgress(0);
        setUploadPhase("idle");
      }, 1200);
    }
  };

  const addQuestion = () => {
    setQuizForm((prev) => ({
      ...prev,
      questions: [
        ...prev.questions,
        {
          prompt: "",
          order: prev.questions.length + 1,
          choices: [
            { text: "", is_correct: true },
            { text: "", is_correct: false },
          ],
        },
      ],
    }));
  };

  const updateQuestion = (index: number, patch: Partial<QuizQuestionForm>) => {
    setQuizForm((prev) => {
      const next = [...prev.questions];
      next[index] = { ...next[index], ...patch };
      return { ...prev, questions: next };
    });
  };

  const updateChoice = (qIndex: number, cIndex: number, patch: Partial<QuizChoiceForm>) => {
    setQuizForm((prev) => {
      const nextQuestions = [...prev.questions];
      const choices = [...nextQuestions[qIndex].choices];
      choices[cIndex] = { ...choices[cIndex], ...patch };
      nextQuestions[qIndex] = { ...nextQuestions[qIndex], choices };
      return { ...prev, questions: nextQuestions };
    });
  };

  const addChoice = (qIndex: number) => {
    setQuizForm((prev) => {
      const nextQuestions = [...prev.questions];
      nextQuestions[qIndex] = {
        ...nextQuestions[qIndex],
        choices: [...nextQuestions[qIndex].choices, { text: "", is_correct: false }],
      };
      return { ...prev, questions: nextQuestions };
    });
  };

  const createQuiz = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!accessToken || !selectedLessonIdForQuiz) return;

    const hasCorrectPerQuestion = quizForm.questions.every((q) => q.choices.some((c) => c.is_correct));
    if (!hasCorrectPerQuestion) {
      setFeedback({ target: "step4-quiz", type: "error", message: "Each question needs at least one correct answer." });
      return;
    }

    await runAction(
      async () => {
        await apiFetch(
          "/admin/quizzes/",
          {
            method: "POST",
            body: JSON.stringify({
              lesson_id: selectedLessonIdForQuiz,
              passing_score: quizForm.passing_score,
              time_limit_sec: quizForm.time_limit_sec ? Number(quizForm.time_limit_sec) : null,
              questions: quizForm.questions,
            }),
          },
          accessToken,
        );
      },
      "Quiz created.",
      "step4-quiz",
    );
  };

  const loadEnrollmentsForCourse = async (courseId: number) => {
    if (!accessToken) return;
    setFeedback(null);
    try {
      const payload = await apiFetch<{ enrollments: EnrollmentRow[] }>(
        `/admin/courses/${courseId}/enrollments/`,
        {},
        accessToken,
      );
      setShowEnrollmentsForCourseId(courseId);
      setCourseEnrollments(payload.enrollments);
    } catch (err) {
      setFeedback({ target: "manage-course", type: "error", message: err instanceof ApiError ? err.message : "Failed to load enrollments." });
    }
  };

  const saveCourseEdits = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!accessToken || !editCourseForm.id) return;
    await runAction(
      async () => {
        await apiFetch(
          `/admin/courses/${editCourseForm.id}/`,
          {
            method: "PATCH",
            body: JSON.stringify({
              title: editCourseForm.title,
              slug: editCourseForm.slug,
              level: editCourseForm.level,
              description: editCourseForm.description,
              is_published: editCourseForm.is_published,
            }),
          },
          accessToken,
        );
      },
      "Course updated.",
      "manage-course",
    );
  };

  const deleteCourse = async () => {
    if (!accessToken || !editCourseForm.id) return;
    if (!window.confirm("Delete this course and all its lessons/quizzes?")) return;
    await runAction(
      async () => {
        await apiFetch(`/admin/courses/${editCourseForm.id}/`, { method: "DELETE" }, accessToken);
        setEditCourseForm({ id: "", title: "", slug: "", level: "", description: "", is_published: false });
      },
      "Course deleted.",
      "manage-course",
    );
  };

  const saveLessonEdits = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!accessToken || !editLessonForm.id) return;
    await runAction(
      async () => {
        await apiFetch(
          `/admin/lessons/${editLessonForm.id}/`,
          {
            method: "PATCH",
            body: JSON.stringify({
              title: editLessonForm.title,
              order: editLessonForm.order,
              content_type: editLessonForm.content_type,
              is_preview: editLessonForm.is_preview,
              reading_content: editLessonForm.content_type === "READING" ? editLessonForm.reading_content : "",
            }),
          },
          accessToken,
        );
      },
      "Lesson updated.",
      "manage-lesson",
    );
  };

  const deleteLesson = async () => {
    if (!accessToken || !editLessonForm.id) return;
    if (!window.confirm("Delete this lesson?")) return;
    await runAction(
      async () => {
        await apiFetch(`/admin/lessons/${editLessonForm.id}/`, { method: "DELETE" }, accessToken);
        setEditLessonForm({ id: "", title: "", order: 1, content_type: "VIDEO", is_preview: false, reading_content: "" });
      },
      "Lesson deleted.",
      "manage-lesson",
    );
  };

  const saveQuizEdits = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!accessToken || !editQuizForm.id) return;
    await runAction(
      async () => {
        await apiFetch(
          `/admin/quizzes/${editQuizForm.id}/`,
          {
            method: "PATCH",
            body: JSON.stringify({
              passing_score: editQuizForm.passing_score,
              time_limit_sec: editQuizForm.time_limit_sec ? Number(editQuizForm.time_limit_sec) : null,
            }),
          },
          accessToken,
        );
      },
      "Quiz updated.",
      "manage-quiz",
    );
  };

  const deleteQuiz = async () => {
    if (!accessToken || !editQuizForm.id) return;
    if (!window.confirm("Delete this quiz?")) return;
    await runAction(
      async () => {
        await apiFetch(`/admin/quizzes/${editQuizForm.id}/`, { method: "DELETE" }, accessToken);
        setEditQuizForm({ id: "", passing_score: 70, time_limit_sec: "" });
      },
      "Quiz deleted.",
      "manage-quiz",
    );
  };

  if (isAdmin === null) {
    return <main className="mx-auto w-full max-w-6xl px-4 py-8">Checking access...</main>;
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 className="text-3xl font-semibold">Teacher Course Builder</h1>
      <p className="mt-2 text-sm text-slate-600">
        Follow the steps in order: 1) Course 2) Lesson 3) Video 4) Quiz
      </p>
      {renderFeedback("global")}

      {insights && (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Course Insights</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg bg-slate-50 p-3 text-sm">Courses: <strong>{insights.totals.courses}</strong></div>
            <div className="rounded-lg bg-slate-50 p-3 text-sm">Published: <strong>{insights.totals.published_courses}</strong></div>
            <div className="rounded-lg bg-slate-50 p-3 text-sm">Students: <strong>{insights.totals.students}</strong></div>
            <div className="rounded-lg bg-slate-50 p-3 text-sm">Enrollments: <strong>{insights.totals.enrollments}</strong></div>
            <div className="rounded-lg bg-slate-50 p-3 text-sm">Lessons: <strong>{insights.totals.lessons}</strong></div>
            <div className="rounded-lg bg-slate-50 p-3 text-sm">Quizzes: <strong>{insights.totals.quizzes}</strong></div>
            <div className="rounded-lg bg-slate-50 p-3 text-sm">Quiz Attempts: <strong>{insights.totals.quiz_attempts}</strong></div>
            <div className="rounded-lg bg-slate-50 p-3 text-sm">Pass Rate: <strong>{insights.totals.pass_rate}%</strong></div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b text-slate-600">
                <tr>
                  <th className="py-2 pr-4">Course</th>
                  <th className="py-2 pr-4">Enrollments</th>
                  <th className="py-2 pr-4">Lessons</th>
                  <th className="py-2 pr-4">Quizzes</th>
                  <th className="py-2 pr-4">Attempts</th>
                  <th className="py-2 pr-4">Passes</th>
                  <th className="py-2 pr-4">Pass Rate</th>
                </tr>
              </thead>
              <tbody>
                {insights.courses.map((course) => (
                  <tr key={course.course_id} className="border-b last:border-0">
                    <td className="py-2 pr-4">
                      <div className="font-medium">{course.title}</div>
                      <div className="text-xs text-slate-500">{course.slug}</div>
                    </td>
                    <td className="py-2 pr-4">{course.enrollments}</td>
                    <td className="py-2 pr-4">{course.lessons}</td>
                    <td className="py-2 pr-4">{course.quizzes}</td>
                    <td className="py-2 pr-4">{course.quiz_attempts}</td>
                    <td className="py-2 pr-4">{course.quiz_passes}</td>
                    <td className="py-2 pr-4">{course.pass_rate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <form onSubmit={createCourse} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Step 1: Create Course</h2>
          <input className="mt-3 w-full rounded border px-3 py-2" placeholder="Course title" value={courseForm.title} onChange={(e) => setCourseForm((v) => ({ ...v, title: e.target.value }))} required />
          <input className="mt-2 w-full rounded border px-3 py-2" placeholder="Course slug (example: python-basics)" value={courseForm.slug} onChange={(e) => setCourseForm((v) => ({ ...v, slug: e.target.value }))} required />
          <input className="mt-2 w-full rounded border px-3 py-2" placeholder="Level (Beginner/Intermediate)" value={courseForm.level} onChange={(e) => setCourseForm((v) => ({ ...v, level: e.target.value }))} />
          <textarea className="mt-2 w-full rounded border px-3 py-2" placeholder="Course description" value={courseForm.description} onChange={(e) => setCourseForm((v) => ({ ...v, description: e.target.value }))} />
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={courseForm.is_published} onChange={(e) => setCourseForm((v) => ({ ...v, is_published: e.target.checked }))} />
            Publish immediately
          </label>
          <button disabled={loading} className="mt-3 rounded bg-slate-900 px-4 py-2 text-sm text-white">Create Course</button>
          {renderFeedback("step1-course")}
        </form>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Choose Working Course</h2>
          <select
            className="mt-3 w-full rounded border px-3 py-2"
            value={selectedCourseId ?? ""}
            onChange={(e) => setSelectedCourseId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Select course</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-slate-500">All next steps use this selected course.</p>
        </div>

        <form onSubmit={createLesson} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Step 2: Add Lesson</h2>
          <select className="mt-3 w-full rounded border px-3 py-2" value={lessonForm.section_id} onChange={(e) => setLessonForm((v) => ({ ...v, section_id: e.target.value }))}>
            <option value="">Create new section below</option>
            {selectedCourseSections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.title} (Section {section.order})
              </option>
            ))}
          </select>
          {!lessonForm.section_id && (
            <>
              <input className="mt-2 w-full rounded border px-3 py-2" placeholder="New section title" value={lessonForm.section_title} onChange={(e) => setLessonForm((v) => ({ ...v, section_title: e.target.value }))} required />
              <input type="number" min={1} className="mt-2 w-full rounded border px-3 py-2" placeholder="Section order" value={lessonForm.section_order} onChange={(e) => setLessonForm((v) => ({ ...v, section_order: Number(e.target.value) }))} required />
            </>
          )}
          <input className="mt-2 w-full rounded border px-3 py-2" placeholder="Lesson title" value={lessonForm.title} onChange={(e) => setLessonForm((v) => ({ ...v, title: e.target.value }))} required />
          <input type="number" min={1} className="mt-2 w-full rounded border px-3 py-2" placeholder="Lesson order" value={lessonForm.order} onChange={(e) => setLessonForm((v) => ({ ...v, order: Number(e.target.value) }))} required />
          <select className="mt-2 w-full rounded border px-3 py-2" value={lessonForm.content_type} onChange={(e) => setLessonForm((v) => ({ ...v, content_type: e.target.value as "VIDEO" | "READING" }))}>
            <option value="VIDEO">Video Lesson</option>
            <option value="READING">Reading Lesson</option>
          </select>
          {lessonForm.content_type === "READING" && (
            <textarea
              className="mt-2 w-full rounded border px-3 py-2"
              placeholder="Reading content"
              value={lessonForm.reading_content}
              onChange={(e) => setLessonForm((v) => ({ ...v, reading_content: e.target.value }))}
              required
            />
          )}
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={lessonForm.is_preview} onChange={(e) => setLessonForm((v) => ({ ...v, is_preview: e.target.checked }))} />
            Preview lesson (free without enrollment)
          </label>
          <button disabled={loading || selectedCourseId == null} className="mt-3 rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-60">Save Lesson</button>
          {renderFeedback("step2-lesson")}
        </form>

        <form onSubmit={uploadVideo} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Step 3: Upload Lesson Video</h2>
          <select
            className="mt-3 w-full rounded border px-3 py-2"
            value={selectedLessonIdForVideo ?? ""}
            onChange={(e) => setSelectedLessonIdForVideo(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Select lesson</option>
            {selectedCourseLessons.filter((lesson) => lesson.content_type === "VIDEO").map((lesson) => (
              <option key={lesson.id} value={lesson.id}>
                {lesson.title} ({lesson.section_title})
              </option>
            ))}
          </select>
          <label
            className={`mt-3 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-8 text-center ${
              dragOver ? "border-amber-600 bg-amber-50" : "border-slate-300 bg-slate-50"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              setVideoFile(e.dataTransfer.files?.[0] ?? null);
            }}
          >
            <input
              type="file"
              accept=".mp4,.mov,.mkv,.webm,video/mp4,video/quicktime,video/webm"
              className="hidden"
              onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
            />
            <p className="text-sm font-medium text-slate-800">Drag video here or click to choose</p>
            <p className="mt-1 text-xs text-slate-500">Supported: mp4, mov, mkv, webm</p>
            {videoFile && <p className="mt-2 text-xs text-emerald-700">Selected: {videoFile.name}</p>}
          </label>
          <button disabled={loading || !videoFile || !selectedLessonIdForVideo} className="mt-3 rounded bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-60">
            {loading ? "Processing..." : "Upload & Convert"}
          </button>
          {(uploadProgress > 0 || (loading && Boolean(videoFile) && Boolean(selectedLessonIdForVideo))) && (
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
                <span>
                  {uploadPhase === "processing" ? "Processing video" : "Upload progress"}
                </span>
                <span>{uploadPhase === "processing" ? "Please wait..." : `${uploadProgress}%`}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                {uploadPhase === "processing" ? (
                  <div className="h-full w-1/3 animate-pulse bg-amber-600" />
                ) : (
                  <div className="h-full bg-emerald-600 transition-all" style={{ width: `${uploadProgress}%` }} />
                )}
              </div>
            </div>
          )}
          {renderFeedback("step3-upload")}
        </form>

        <form onSubmit={createQuiz} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="text-lg font-semibold">Step 4: Build Quiz</h2>
          <select
            className="mt-3 w-full rounded border px-3 py-2"
            value={selectedLessonIdForQuiz ?? ""}
            onChange={(e) => setSelectedLessonIdForQuiz(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Select lesson</option>
            {selectedCourseLessons.map((lesson) => (
              <option key={lesson.id} value={lesson.id}>
                {lesson.title}
              </option>
            ))}
          </select>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <input type="number" min={0} max={100} className="w-full rounded border px-3 py-2" value={quizForm.passing_score} onChange={(e) => setQuizForm((v) => ({ ...v, passing_score: Number(e.target.value) }))} placeholder="Passing score (0-100)" />
            <input type="number" min={1} className="w-full rounded border px-3 py-2" value={quizForm.time_limit_sec} onChange={(e) => setQuizForm((v) => ({ ...v, time_limit_sec: e.target.value }))} placeholder="Time limit in seconds (optional)" />
          </div>

          <div className="mt-4 space-y-3">
            {quizForm.questions.map((question, qIndex) => (
              <div key={qIndex} className="rounded-lg border border-slate-200 p-3">
                <input className="w-full rounded border px-3 py-2" placeholder={`Question ${qIndex + 1}`} value={question.prompt} onChange={(e) => updateQuestion(qIndex, { prompt: e.target.value })} />
                <div className="mt-2 space-y-2">
                  {question.choices.map((choice, cIndex) => (
                    <div key={cIndex} className="flex items-center gap-2">
                      <input className="flex-1 rounded border px-3 py-2" placeholder={`Choice ${cIndex + 1}`} value={choice.text} onChange={(e) => updateChoice(qIndex, cIndex, { text: e.target.value })} />
                      <label className="flex items-center gap-1 text-xs">
                        <input type="checkbox" checked={choice.is_correct} onChange={(e) => updateChoice(qIndex, cIndex, { is_correct: e.target.checked })} />
                        Correct
                      </label>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => addChoice(qIndex)} className="mt-2 rounded border border-slate-300 px-2 py-1 text-xs">
                  + Add Choice
                </button>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={addQuestion} className="rounded border border-slate-300 px-3 py-1.5 text-sm">
              + Add Question
            </button>
            <button disabled={loading || !selectedLessonIdForQuiz} className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-60">
              Save Quiz
            </button>
          </div>
          {renderFeedback("step4-quiz")}
        </form>
      </section>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Current Content Summary</h2>
        <p className="mt-2 text-sm text-slate-600">
          Courses: {courses.length} | Lessons: {lessons.length} | Quizzes: {quizzes.length}
        </p>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Manage Course + Enrollments</h2>
          <select
            className="mt-3 w-full rounded border px-3 py-2"
            value={editCourseForm.id}
            onChange={(e) => {
              const id = Number(e.target.value);
              const course = courses.find((c) => c.id === id);
              if (!course) return;
              setEditCourseForm({
                id: String(course.id),
                title: course.title,
                slug: course.slug,
                level: course.level,
                description: course.description,
                is_published: Boolean(course.is_published),
              });
            }}
          >
            <option value="">Select course</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title} ({course.enrollment_count ?? 0} enrolled)
              </option>
            ))}
          </select>
          {editCourseForm.id && (
            <>
              <form onSubmit={saveCourseEdits} className="mt-3 space-y-2">
                <input className="w-full rounded border px-3 py-2" value={editCourseForm.title} onChange={(e) => setEditCourseForm((v) => ({ ...v, title: e.target.value }))} />
                <input className="w-full rounded border px-3 py-2" value={editCourseForm.slug} onChange={(e) => setEditCourseForm((v) => ({ ...v, slug: e.target.value }))} />
                <input className="w-full rounded border px-3 py-2" value={editCourseForm.level} onChange={(e) => setEditCourseForm((v) => ({ ...v, level: e.target.value }))} />
                <textarea className="w-full rounded border px-3 py-2" value={editCourseForm.description} onChange={(e) => setEditCourseForm((v) => ({ ...v, description: e.target.value }))} />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editCourseForm.is_published} onChange={(e) => setEditCourseForm((v) => ({ ...v, is_published: e.target.checked }))} />
                  Published
                </label>
                <div className="flex gap-2">
                  <button className="rounded bg-slate-900 px-3 py-2 text-sm text-white" type="submit">Save Course</button>
                  <button className="rounded bg-red-700 px-3 py-2 text-sm text-white" type="button" onClick={deleteCourse}>Delete Course</button>
                  <button
                    className="rounded border border-slate-300 px-3 py-2 text-sm"
                    type="button"
                    onClick={() => loadEnrollmentsForCourse(Number(editCourseForm.id))}
                  >
                    View Enrollments
                  </button>
                </div>
              </form>
              {renderFeedback("manage-course")}
              {showEnrollmentsForCourseId === Number(editCourseForm.id) && (
                <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-medium">Enrolled Students ({courseEnrollments.length})</p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-700">
                    {courseEnrollments.map((row) => (
                      <li key={row.id}>
                        {row.user.username} ({row.user.email || "no email"}) - {row.status}
                      </li>
                    ))}
                    {courseEnrollments.length === 0 && <li>No students enrolled yet.</li>}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Manage Lesson + Video</h2>
          <select
            className="mt-3 w-full rounded border px-3 py-2"
            value={editLessonForm.id}
            onChange={(e) => {
              const id = Number(e.target.value);
              const lesson = lessons.find((l) => l.id === id);
              if (!lesson) return;
              setEditLessonForm({
                id: String(lesson.id),
                title: lesson.title,
                order: lesson.order ?? 1,
                content_type: lesson.content_type,
                is_preview: lesson.is_preview,
                reading_content: lesson.reading_content || "",
              });
              if (lesson.content_type === "VIDEO") {
                setSelectedLessonIdForVideo(lesson.id);
              }
            }}
          >
            <option value="">Select lesson</option>
            {lessons.map((lesson) => (
              <option key={lesson.id} value={lesson.id}>
                {lesson.title} ({lesson.section_title}) {lesson.content_type === "READING" ? "[Reading]" : ""}
              </option>
            ))}
          </select>
          {editLessonForm.id && (
            <>
              <form onSubmit={saveLessonEdits} className="mt-3 space-y-2">
                <input className="w-full rounded border px-3 py-2" value={editLessonForm.title} onChange={(e) => setEditLessonForm((v) => ({ ...v, title: e.target.value }))} />
                <input type="number" min={1} className="w-full rounded border px-3 py-2" value={editLessonForm.order} onChange={(e) => setEditLessonForm((v) => ({ ...v, order: Number(e.target.value) }))} />
                <select className="w-full rounded border px-3 py-2" value={editLessonForm.content_type} onChange={(e) => setEditLessonForm((v) => ({ ...v, content_type: e.target.value as "VIDEO" | "READING" }))}>
                  <option value="VIDEO">Video Lesson</option>
                  <option value="READING">Reading Lesson</option>
                </select>
                {editLessonForm.content_type === "READING" && (
                  <textarea className="w-full rounded border px-3 py-2" value={editLessonForm.reading_content} onChange={(e) => setEditLessonForm((v) => ({ ...v, reading_content: e.target.value }))} />
                )}
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editLessonForm.is_preview} onChange={(e) => setEditLessonForm((v) => ({ ...v, is_preview: e.target.checked }))} />
                  Preview
                </label>
                <div className="flex gap-2">
                  <button className="rounded bg-slate-900 px-3 py-2 text-sm text-white" type="submit">Save Lesson</button>
                  <button className="rounded bg-red-700 px-3 py-2 text-sm text-white" type="button" onClick={deleteLesson}>Delete Lesson</button>
                </div>
              </form>
              {renderFeedback("manage-lesson")}
            </>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="text-lg font-semibold">Manage Quiz</h2>
          <select
            className="mt-3 w-full rounded border px-3 py-2"
            value={editQuizForm.id}
            onChange={(e) => {
              const id = Number(e.target.value);
              const quiz = quizzes.find((q) => q.id === id);
              if (!quiz) return;
              setEditQuizForm({
                id: String(quiz.id),
                passing_score: quiz.passing_score ?? 70,
                time_limit_sec: quiz.time_limit_sec ? String(quiz.time_limit_sec) : "",
              });
            }}
          >
            <option value="">Select quiz</option>
            {quizzes.map((quiz) => (
              <option key={quiz.id} value={quiz.id}>
                {quiz.lesson_title} ({quiz.course_title})
              </option>
            ))}
          </select>
          {editQuizForm.id && (
            <>
              <form onSubmit={saveQuizEdits} className="mt-3 grid gap-2 md:grid-cols-3">
                <input type="number" min={0} max={100} className="rounded border px-3 py-2" value={editQuizForm.passing_score} onChange={(e) => setEditQuizForm((v) => ({ ...v, passing_score: Number(e.target.value) }))} />
                <input type="number" min={1} className="rounded border px-3 py-2" value={editQuizForm.time_limit_sec} onChange={(e) => setEditQuizForm((v) => ({ ...v, time_limit_sec: e.target.value }))} placeholder="Time limit sec" />
                <div className="flex gap-2">
                  <button className="rounded bg-slate-900 px-3 py-2 text-sm text-white" type="submit">Save Quiz</button>
                  <button className="rounded bg-red-700 px-3 py-2 text-sm text-white" type="button" onClick={deleteQuiz}>Delete Quiz</button>
                </div>
              </form>
              {renderFeedback("manage-quiz")}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
