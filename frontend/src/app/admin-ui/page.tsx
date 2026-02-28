"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { API_BASE_URL, ApiError, apiFetch } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { useAccessToken } from "@/hooks/use-access-token";
import { setTheme } from "@/lib/theme";

type Course = {
  id: number;
  title: string;
  slug: string;
  description: string;
  level: string;
  price_cents?: number;
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

type FinalExamChoiceForm = { text: string; is_correct: boolean; order: number };
type FinalExamQuestionForm = {
  id?: number;
  prompt: string;
  order: number;
  choices: FinalExamChoiceForm[];
};
type FinalExamPayload = {
  id: number;
  course_id: number;
  title: string;
  passing_score: number;
  time_limit_sec: number | null;
  is_published: boolean;
  questions: Array<{
    id: number;
    prompt: string;
    order: number;
    choices: Array<{ id: number; text: string; order: number; is_correct?: boolean }>;
  }>;
};

type FeedbackTarget =
  | "global"
  | "step1-course"
  | "step2-lesson"
  | "step3-upload"
  | "step4-quiz"
  | "step5-final-exam"
  | "manage-final-exam"
  | "manage-course"
  | "manage-lesson"
  | "manage-quiz";

type AdminView = "build" | "manage" | "insights";
const COURSE_LEVEL_OPTIONS = ["Beginner", "Intermediate", "Advanced"] as const;
const NEW_COURSE_SELECTOR_VALUE = "__new__";
const FINAL_EXAM_JSON_SAMPLE = `[
  {
    "question": "What happens if you call pop() on an empty list?",
    "choices": {
      "A": "Returns None",
      "B": "Returns 0",
      "C": "Raises an error",
      "D": "Removes the last element"
    },
    "correct": "C"
  },
  {
    "question": "Which of the following best describes a stack?",
    "choices": {
      "A": "You can access any element directly",
      "B": "Only the top element can be accessed",
      "C": "Items are sorted automatically",
      "D": "It stores only numbers"
    },
    "correct": "B"
  }
]`;

export default function AdminUiPage() {
  const router = useRouter();
  const pathname = usePathname();
  const accessToken = useAccessToken();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [activeView, setActiveView] = useState<AdminView>("build");
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
  const [isCreatingNewCourse, setIsCreatingNewCourse] = useState(false);
  const [selectedLessonIdForVideo, setSelectedLessonIdForVideo] = useState<number | null>(null);
  const [selectedLessonIdForQuiz, setSelectedLessonIdForQuiz] = useState<number | null>(null);
  const [step3ReadingContent, setStep3ReadingContent] = useState("");
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
    price_cents: 0,
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
    price_cents: 0,
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
  const [finalExamForm, setFinalExamForm] = useState({
    title: "Final Exam",
    passing_score: 70,
    time_limit_sec: "",
    is_published: false,
    questions: [
      {
        prompt: "",
        order: 1,
        choices: [
          { text: "", is_correct: true, order: 1 },
          { text: "", is_correct: false, order: 2 },
        ],
      },
    ] as FinalExamQuestionForm[],
  });
  const [finalExamInputMode, setFinalExamInputMode] = useState<"manual" | "json">("manual");
  const [finalExamJsonInput, setFinalExamJsonInput] = useState(FINAL_EXAM_JSON_SAMPLE);
  const [finalExamExists, setFinalExamExists] = useState(false);

  useEffect(() => {
    setTheme("light");
  }, []);

  const selectedCourseSections = useMemo(
    () => sections.filter((section) => section.course_id === selectedCourseId),
    [sections, selectedCourseId],
  );
  const selectedCourseLessons = useMemo(
    () => lessons.filter((lesson) => lesson.course_id === selectedCourseId),
    [lessons, selectedCourseId],
  );
  const selectedStep3Lesson = useMemo(
    () => selectedCourseLessons.find((lesson) => lesson.id === selectedLessonIdForVideo) ?? null,
    [selectedCourseLessons, selectedLessonIdForVideo],
  );
  const step3Mode = selectedStep3Lesson?.content_type ?? lessonForm.content_type;
  const step3DraftReadingContent = lessonForm.reading_content;
  const selectedCourseLessonIds = useMemo(
    () => new Set(selectedCourseLessons.map((lesson) => lesson.id)),
    [selectedCourseLessons],
  );
  const selectedCourseQuizzes = useMemo(
    () => quizzes.filter((quiz) => selectedCourseLessonIds.has(quiz.lesson_id)),
    [quizzes, selectedCourseLessonIds],
  );
  const hasUploadedVideo = useMemo(
    () => selectedCourseLessons.some((lesson) => Boolean(lesson.hls_master_path)),
    [selectedCourseLessons],
  );
  const workflowStatus = useMemo(
    () => {
      if (!selectedCourseId) {
        return {
          step1: false,
          step2: false,
          step3: false,
          step4: false,
          step5: false,
        };
      }
      return {
        step1: true,
        step2: selectedCourseLessons.length > 0,
        step3: hasUploadedVideo,
        step4: selectedCourseQuizzes.length > 0,
        step5: finalExamExists,
      };
    },
    [selectedCourseId, selectedCourseLessons.length, hasUploadedVideo, selectedCourseQuizzes.length, finalExamExists],
  );

  const loadFinalExamForCourse = useCallback(
    async (courseId: number) => {
      if (!accessToken) return;
      const exam = await apiFetch<FinalExamPayload>(`/admin/courses/${courseId}/final-exam/`, {}, accessToken);
      setFinalExamExists(true);
      setFinalExamForm({
        title: exam.title || "Final Exam",
        passing_score: exam.passing_score ?? 70,
        time_limit_sec: exam.time_limit_sec ? String(exam.time_limit_sec) : "",
        is_published: Boolean(exam.is_published),
        questions:
          exam.questions.length > 0
            ? exam.questions.map((question, qIndex) => ({
                id: question.id,
                prompt: question.prompt,
                order: question.order || qIndex + 1,
                choices:
                  question.choices.length > 0
                    ? question.choices.map((choice, cIndex) => ({
                        text: choice.text,
                        is_correct: Boolean(choice.is_correct),
                        order: choice.order || cIndex + 1,
                      }))
                    : [
                        { text: "", is_correct: true, order: 1 },
                        { text: "", is_correct: false, order: 2 },
                      ],
              }))
            : [
                {
                  prompt: "",
                  order: 1,
                  choices: [
                    { text: "", is_correct: true, order: 1 },
                    { text: "", is_correct: false, order: 2 },
                  ],
                },
              ],
      });
    },
    [accessToken],
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

  useEffect(() => {
    if (!selectedStep3Lesson || selectedStep3Lesson.content_type !== "READING") {
      setStep3ReadingContent("");
      return;
    }
    setStep3ReadingContent(selectedStep3Lesson.reading_content || "");
  }, [selectedStep3Lesson]);

  useEffect(() => {
    if (!accessToken || selectedCourseId == null || isAdmin !== true) {
      setFinalExamExists(false);
      setFinalExamForm({
        title: "Final Exam",
        passing_score: 70,
        time_limit_sec: "",
        is_published: false,
        questions: [
          {
            prompt: "",
            order: 1,
            choices: [
              { text: "", is_correct: true, order: 1 },
              { text: "", is_correct: false, order: 2 },
            ],
          },
        ],
      });
      return;
    }

    loadFinalExamForCourse(selectedCourseId)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          setFinalExamExists(false);
          setFinalExamForm({
            title: "Final Exam",
            passing_score: 70,
            time_limit_sec: "",
            is_published: false,
            questions: [
              {
                prompt: "",
                order: 1,
                choices: [
                  { text: "", is_correct: true, order: 1 },
                  { text: "", is_correct: false, order: 2 },
                ],
              },
            ],
          });
          return;
        }
        setFeedback({
          target: "step5-final-exam",
          type: "error",
          message: err instanceof ApiError ? err.message : "Failed to load final exam for selected course.",
        });
      });
  }, [accessToken, isAdmin, loadFinalExamForCourse, selectedCourseId]);

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
          { method: "POST", body: JSON.stringify(courseForm) },
          accessToken,
        );
        setSelectedCourseId(created.id);
        setIsCreatingNewCourse(false);
        setCourseForm({ title: "", slug: "", description: "", level: "Beginner", price_cents: 0, is_published: true });
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
        const createdLesson = await apiFetch<Lesson>("/admin/lessons/", { method: "POST", body: JSON.stringify(payload) }, accessToken);
        setSelectedLessonIdForVideo(createdLesson.id);
        setSelectedLessonIdForQuiz(createdLesson.id);
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

  const saveStep3Reading = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!accessToken || !selectedStep3Lesson || selectedStep3Lesson.content_type !== "READING") return;
    await runAction(
      async () => {
        await apiFetch(
          `/admin/lessons/${selectedStep3Lesson.id}/`,
          {
            method: "PATCH",
            body: JSON.stringify({
              content_type: "READING",
              reading_content: step3ReadingContent,
            }),
          },
          accessToken,
        );
      },
      "Reading content saved.",
      "step3-upload",
    );
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
              price_cents: editCourseForm.price_cents,
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
        setEditCourseForm({ id: "", title: "", slug: "", level: "", description: "", price_cents: 0, is_published: false });
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

  const addFinalExamQuestion = () => {
    setFinalExamForm((prev) => ({
      ...prev,
      questions: [
        ...prev.questions,
        {
          prompt: "",
          order: prev.questions.length + 1,
          choices: [
            { text: "", is_correct: true, order: 1 },
            { text: "", is_correct: false, order: 2 },
          ],
        },
      ],
    }));
  };

  const updateFinalExamQuestion = (index: number, patch: Partial<FinalExamQuestionForm>) => {
    setFinalExamForm((prev) => {
      const next = [...prev.questions];
      next[index] = { ...next[index], ...patch };
      return { ...prev, questions: next };
    });
  };

  const updateFinalExamChoice = (qIndex: number, cIndex: number, patch: Partial<FinalExamChoiceForm>) => {
    setFinalExamForm((prev) => {
      const nextQuestions = [...prev.questions];
      const choices = [...nextQuestions[qIndex].choices];
      choices[cIndex] = { ...choices[cIndex], ...patch };
      nextQuestions[qIndex] = { ...nextQuestions[qIndex], choices };
      return { ...prev, questions: nextQuestions };
    });
  };

  const addFinalExamChoice = (qIndex: number) => {
    setFinalExamForm((prev) => {
      const nextQuestions = [...prev.questions];
      nextQuestions[qIndex] = {
        ...nextQuestions[qIndex],
        choices: [
          ...nextQuestions[qIndex].choices,
          { text: "", is_correct: false, order: nextQuestions[qIndex].choices.length + 1 },
        ],
      };
      return { ...prev, questions: nextQuestions };
    });
  };

  const parseFinalExamJson = (rawJson: string): FinalExamQuestionForm[] => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      throw new Error("Invalid JSON format. Please check brackets, commas, and quotes.");
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("JSON must be a non-empty array of questions.");
    }

    return parsed.map((entry, qIndex) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(`Question #${qIndex + 1} is invalid.`);
      }
      const row = entry as Record<string, unknown>;
      const prompt = typeof row.question === "string" ? row.question.trim() : "";
      if (!prompt) {
        throw new Error(`Question #${qIndex + 1} must include a non-empty 'question' text.`);
      }

      const choicesRaw = row.choices;
      if (!choicesRaw || typeof choicesRaw !== "object" || Array.isArray(choicesRaw)) {
        throw new Error(`Question #${qIndex + 1} must include 'choices' as an object (A/B/C...).`);
      }
      const choiceEntries = Object.entries(choicesRaw as Record<string, unknown>).filter(
        ([, value]) => typeof value === "string" && value.trim().length > 0,
      );
      if (choiceEntries.length < 2) {
        throw new Error(`Question #${qIndex + 1} needs at least 2 non-empty choices.`);
      }

      const correctRaw = typeof row.correct === "string" ? row.correct.trim().toUpperCase() : "";
      if (!correctRaw) {
        throw new Error(`Question #${qIndex + 1} must include 'correct' (example: "B").`);
      }
      const normalizedChoices = choiceEntries.map(([key, value], cIndex) => ({
        key: key.trim().toUpperCase() || String.fromCharCode(65 + cIndex),
        text: String(value).trim(),
      }));
      const hasCorrect = normalizedChoices.some((choice) => choice.key === correctRaw);
      if (!hasCorrect) {
        throw new Error(
          `Question #${qIndex + 1} has 'correct': "${correctRaw}" that does not match provided choice keys.`,
        );
      }

      return {
        prompt,
        order: qIndex + 1,
        choices: normalizedChoices.map((choice, cIndex) => ({
          text: choice.text,
          is_correct: choice.key === correctRaw,
          order: cIndex + 1,
        })),
      };
    });
  };

  const importFinalExamJson = () => {
    try {
      const importedQuestions = parseFinalExamJson(finalExamJsonInput);
      setFinalExamForm((prev) => ({ ...prev, questions: importedQuestions }));
      setFeedback({
        target: "step5-final-exam",
        type: "success",
        message: `Imported ${importedQuestions.length} questions from JSON.`,
      });
    } catch (err) {
      setFeedback({
        target: "step5-final-exam",
        type: "error",
        message: err instanceof Error ? err.message : "Failed to import JSON questions.",
      });
    }
  };

  const saveFinalExam = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!accessToken || !selectedCourseId) return;

    let questionsToSave = finalExamForm.questions;
    if (finalExamInputMode === "json") {
      try {
        questionsToSave = parseFinalExamJson(finalExamJsonInput);
      } catch (err) {
        setFeedback({
          target: "step5-final-exam",
          type: "error",
          message: err instanceof Error ? err.message : "Invalid final exam JSON.",
        });
        return;
      }
      setFinalExamForm((prev) => ({ ...prev, questions: questionsToSave }));
    }

    const validQuestions = questionsToSave.every((question) => {
      const hasCorrect = question.choices.some((choice) => choice.is_correct);
      const hasMinChoices = question.choices.length >= 2;
      return hasCorrect && hasMinChoices;
    });
    if (!validQuestions) {
      setFeedback({
        target: "step5-final-exam",
        type: "error",
        message: "Each final exam question needs at least 2 choices and one correct answer.",
      });
      return;
    }

    await runAction(
      async () => {
        const payload = {
          title: finalExamForm.title,
          passing_score: finalExamForm.passing_score,
          time_limit_sec: finalExamForm.time_limit_sec ? Number(finalExamForm.time_limit_sec) : null,
          is_published: finalExamForm.is_published,
          questions: questionsToSave.map((question, qIndex) => ({
            prompt: question.prompt,
            order: qIndex + 1,
            choices: question.choices.map((choice, cIndex) => ({
              text: choice.text,
              is_correct: choice.is_correct,
              order: cIndex + 1,
            })),
          })),
        };
        const saved = await apiFetch<FinalExamPayload>(
          `/admin/courses/${selectedCourseId}/final-exam/`,
          { method: "PUT", body: JSON.stringify(payload) },
          accessToken,
        );
        setFinalExamExists(true);
        setFinalExamForm({
          title: saved.title,
          passing_score: saved.passing_score ?? 70,
          time_limit_sec: saved.time_limit_sec ? String(saved.time_limit_sec) : "",
          is_published: Boolean(saved.is_published),
          questions: saved.questions.map((question, qIndex) => ({
            id: question.id,
            prompt: question.prompt,
            order: question.order || qIndex + 1,
            choices: question.choices.map((choice, cIndex) => ({
              text: choice.text,
              is_correct: Boolean(choice.is_correct),
              order: choice.order || cIndex + 1,
            })),
          })),
        });
      },
      finalExamExists ? "Final exam updated." : "Final exam created.",
      "step5-final-exam",
    );
  };

  const unpublishFinalExam = async () => {
    if (!accessToken || !selectedCourseId || !finalExamExists) return;
    await runAction(
      async () => {
        await apiFetch(
          `/admin/courses/${selectedCourseId}/final-exam/publish/`,
          { method: "PATCH", body: JSON.stringify({ is_published: false }) },
          accessToken,
        );
        await loadFinalExamForCourse(selectedCourseId);
      },
      "Final exam unpublished.",
      "manage-final-exam",
    );
  };

  const resetFinalExam = async () => {
    if (!accessToken || !selectedCourseId || !finalExamExists) return;
    if (!window.confirm("Reset final exam? This removes all final exam questions and unpublishes it.")) return;
    await runAction(
      async () => {
        await apiFetch(`/admin/courses/${selectedCourseId}/final-exam/reset/`, { method: "POST" }, accessToken);
        await loadFinalExamForCourse(selectedCourseId);
      },
      "Final exam reset. Questions removed and exam unpublished.",
      "manage-final-exam",
    );
  };

  const quickDeleteFinalExamQuestion = async (questionId?: number) => {
    if (!accessToken || !selectedCourseId || !finalExamExists || !questionId) return;
    if (!window.confirm("Delete this final exam question?")) return;
    await runAction(
      async () => {
        await apiFetch(`/admin/final-exam/questions/${questionId}/`, { method: "DELETE" }, accessToken);
        await loadFinalExamForCourse(selectedCourseId);
      },
      "Final exam question deleted.",
      "manage-final-exam",
    );
  };

  if (isAdmin === null) {
    return <main className="admin-theme-scope mx-auto w-full max-w-6xl px-4 py-8">Checking access...</main>;
  }

  return (
    <main className="admin-theme-scope mx-auto w-full max-w-6xl px-4 py-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Admin Control Center</h1>
            <p className="mt-2 text-sm text-slate-600">
              Build course content, manage existing content, and monitor performance from one place.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => setActiveView("build")}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${activeView === "build" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white"}`}
            >
              Build
            </button>
            <button
              type="button"
              onClick={() => setActiveView("manage")}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${activeView === "manage" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white"}`}
            >
              Manage
            </button>
            <button
              type="button"
              onClick={() => setActiveView("insights")}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${activeView === "insights" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white"}`}
            >
              Insights
            </button>
          </div>
        </div>
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Working Course</p>
          <select
            className="w-full rounded border px-3 py-2 text-sm"
            value={selectedCourseId != null ? String(selectedCourseId) : isCreatingNewCourse ? NEW_COURSE_SELECTOR_VALUE : ""}
            onChange={(e) => {
              const value = e.target.value;
              if (!value) {
                setSelectedCourseId(null);
                setIsCreatingNewCourse(false);
                return;
              }
              if (value === NEW_COURSE_SELECTOR_VALUE) {
                setSelectedCourseId(null);
                setIsCreatingNewCourse(true);
                return;
              }
              setSelectedCourseId(Number(value));
              setIsCreatingNewCourse(false);
            }}
          >
            <option value="">Select existing course</option>
            <option value={NEW_COURSE_SELECTOR_VALUE}>+ Create new course (Step 1)</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title}
              </option>
            ))}
          </select>
        </div>
      </section>

      {renderFeedback("global")}

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm">Courses<br /><strong>{courses.length}</strong></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm">Lessons<br /><strong>{lessons.length}</strong></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm">Quizzes<br /><strong>{quizzes.length}</strong></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm">Final Exam<br /><strong>{selectedCourseId && finalExamExists ? "Ready" : "Not Set"}</strong></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm">
          Workflow
          <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
            <span className={`rounded px-2 py-0.5 ${workflowStatus.step1 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>1</span>
            <span className={`rounded px-2 py-0.5 ${workflowStatus.step2 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>2</span>
            <span className={`rounded px-2 py-0.5 ${workflowStatus.step3 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>3</span>
            <span className={`rounded px-2 py-0.5 ${workflowStatus.step4 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>4</span>
            <span className={`rounded px-2 py-0.5 ${workflowStatus.step5 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>5</span>
          </div>
        </div>
      </section>

      {activeView === "insights" && insights && (
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

      {activeView === "build" && <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Build Workflow Checklist</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex items-center justify-between rounded border border-slate-200 px-3 py-2">
              <span>1. Create course</span>
              <span className={workflowStatus.step1 ? "text-emerald-700" : "text-slate-500"}>{workflowStatus.step1 ? "Done" : "Pending"}</span>
            </li>
            <li className="flex items-center justify-between rounded border border-slate-200 px-3 py-2">
              <span>2. Add lessons</span>
              <span className={workflowStatus.step2 ? "text-emerald-700" : "text-slate-500"}>{workflowStatus.step2 ? "Done" : "Pending"}</span>
            </li>
            <li className="flex items-center justify-between rounded border border-slate-200 px-3 py-2">
              <span>3. Upload video</span>
              <span className={workflowStatus.step3 ? "text-emerald-700" : "text-slate-500"}>{workflowStatus.step3 ? "Done" : "Pending"}</span>
            </li>
            <li className="flex items-center justify-between rounded border border-slate-200 px-3 py-2">
              <span>4. Build lesson quiz</span>
              <span className={workflowStatus.step4 ? "text-emerald-700" : "text-slate-500"}>{workflowStatus.step4 ? "Done" : "Pending"}</span>
            </li>
            <li className="flex items-center justify-between rounded border border-slate-200 px-3 py-2">
              <span>5. Build final exam</span>
              <span className={workflowStatus.step5 ? "text-emerald-700" : "text-slate-500"}>{workflowStatus.step5 ? "Done" : "Pending"}</span>
            </li>
          </ul>
        </div>

        {(isCreatingNewCourse || courses.length === 0) && (
          <form onSubmit={createCourse} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Step 1: Create Course</h2>
            <p className="mt-2 text-xs text-slate-500">
              Select a difficulty level so students can understand the course depth before enrolling.
            </p>
            <input className="mt-3 w-full rounded border px-3 py-2" placeholder="Course title" value={courseForm.title} onChange={(e) => setCourseForm((v) => ({ ...v, title: e.target.value }))} required />
            <input className="mt-2 w-full rounded border px-3 py-2" placeholder="Course slug (example: python-basics)" value={courseForm.slug} onChange={(e) => setCourseForm((v) => ({ ...v, slug: e.target.value }))} required />
            <label className="mt-2 block text-xs text-slate-600">Course level</label>
            <select className="mt-1 w-full rounded border px-3 py-2" value={courseForm.level} onChange={(e) => setCourseForm((v) => ({ ...v, level: e.target.value }))}>
              {COURSE_LEVEL_OPTIONS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
            <input type="number" min={0} className="mt-2 w-full rounded border px-3 py-2" placeholder="Required credits to enroll" value={courseForm.price_cents} onChange={(e) => setCourseForm((v) => ({ ...v, price_cents: Number(e.target.value) }))} />
            <textarea className="mt-2 w-full rounded border px-3 py-2" placeholder="Course description" value={courseForm.description} onChange={(e) => setCourseForm((v) => ({ ...v, description: e.target.value }))} />
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={courseForm.is_published} onChange={(e) => setCourseForm((v) => ({ ...v, is_published: e.target.checked }))} />
              Publish immediately
            </label>
            <button disabled={loading} className="mt-3 rounded bg-slate-900 px-4 py-2 text-sm text-white">Create Course</button>
            {renderFeedback("step1-course")}
          </form>
        )}

        {selectedCourseId == null && !isCreatingNewCourse && courses.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Step 1</h2>
            <p className="mt-2 text-sm text-slate-600">
              Select an existing course from the top Working Course selector to continue at Step 2, or choose
              {" "}
              <strong>+ Create new course (Step 1)</strong>
              {" "}
              to start from scratch.
            </p>
          </div>
        )}

        <form onSubmit={createLesson} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Step 2: Add Lesson</h2>
          <p className="mt-2 text-xs text-slate-500">
            `Section order` sets section position in the course. `Lesson order` sets lesson position for students.
          </p>
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
              <label className="mt-2 block text-xs text-slate-600">Section order (1 = first section)</label>
              <input type="number" min={1} className="mt-1 w-full rounded border px-3 py-2" placeholder="Example: 1" value={lessonForm.section_order} onChange={(e) => setLessonForm((v) => ({ ...v, section_order: Number(e.target.value) }))} required />
            </>
          )}
          <input className="mt-2 w-full rounded border px-3 py-2" placeholder="Lesson title" value={lessonForm.title} onChange={(e) => setLessonForm((v) => ({ ...v, title: e.target.value }))} required />
          <label className="mt-2 block text-xs text-slate-600">Lesson order (1 = first lesson)</label>
          <input type="number" min={1} className="mt-1 w-full rounded border px-3 py-2" placeholder="Example: 1" value={lessonForm.order} onChange={(e) => setLessonForm((v) => ({ ...v, order: Number(e.target.value) }))} required />
          <select className="mt-2 w-full rounded border px-3 py-2" value={lessonForm.content_type} onChange={(e) => setLessonForm((v) => ({ ...v, content_type: e.target.value as "VIDEO" | "READING" }))}>
            <option value="VIDEO">Video Lesson</option>
            <option value="READING">Reading Lesson</option>
          </select>
          {lessonForm.content_type === "READING" && (
            <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Reading editor moved to Step 3. Save this lesson, then use Step 3 to write formatted reading content.
            </p>
          )}
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={lessonForm.is_preview} onChange={(e) => setLessonForm((v) => ({ ...v, is_preview: e.target.checked }))} />
            Preview lesson (free without enrollment)
          </label>
          <button disabled={loading || selectedCourseId == null} className="mt-3 rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-60">Save Lesson</button>
          {renderFeedback("step2-lesson")}
        </form>

        <form onSubmit={step3Mode === "READING" && selectedStep3Lesson ? saveStep3Reading : uploadVideo} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">
            {step3Mode === "READING" ? "Step 3: Edit Reading Content" : "Step 3: Upload Lesson Video"}
          </h2>
          <select
            className="mt-3 w-full rounded border px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60"
            value={selectedLessonIdForVideo ?? ""}
            onChange={(e) => setSelectedLessonIdForVideo(e.target.value ? Number(e.target.value) : null)}
            disabled={step3Mode === "READING"}
          >
            <option value="">Select lesson</option>
            {selectedCourseLessons.map((lesson) => (
              <option key={lesson.id} value={lesson.id}>
                {lesson.title} ({lesson.section_title}) [{lesson.content_type}]
              </option>
            ))}
          </select>
          {step3Mode === "READING" ? (
            <>
              <p className="mt-3 text-xs text-slate-500">
                {selectedStep3Lesson
                  ? "Edit reading text here. Slash commands are supported (`/h1`, `/h2`, `/p`, `/l`, `/c`, `/code`)."
                  : "Reading mode detected from Step 2. Save lesson first, then Step 3 will store updates to that lesson."}
              </p>
              <textarea
                className="mt-2 min-h-[220px] w-full rounded border px-3 py-2 font-mono text-sm"
                value={selectedStep3Lesson ? step3ReadingContent : step3DraftReadingContent}
                onChange={(e) => {
                  if (selectedStep3Lesson) {
                    setStep3ReadingContent(e.target.value);
                    return;
                  }
                  setLessonForm((prev) => ({ ...prev, reading_content: e.target.value }));
                }}
                placeholder="Write lesson reading content..."
              />
              {selectedStep3Lesson ? (
                <button disabled={loading || !selectedStep3Lesson} className="mt-3 rounded bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-60">
                  {loading ? "Saving..." : "Save Reading Content"}
                </button>
              ) : (
                <button type="button" disabled className="mt-3 rounded border border-slate-300 bg-slate-50 px-4 py-2 text-sm text-slate-500">
                  Save Lesson in Step 2 First
                </button>
              )}
            </>
          ) : selectedStep3Lesson?.content_type === "VIDEO" ? (
            <>
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
            </>
          ) : (
            <p className="mt-3 text-sm text-slate-500">Select a lesson to continue.</p>
          )}
          {(uploadProgress > 0 || (loading && Boolean(videoFile) && selectedStep3Lesson?.content_type === "VIDEO")) && (
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
          <p className="mt-2 text-xs text-slate-500">
            Passing score means the minimum percentage required to pass this lesson quiz. Default is 70%.
          </p>
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
            <input type="number" min={0} max={100} className="w-full rounded border px-3 py-2" value={quizForm.passing_score} onChange={(e) => setQuizForm((v) => ({ ...v, passing_score: Number(e.target.value) }))} placeholder="Passing score in % (default: 70)" />
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

        <form onSubmit={saveFinalExam} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="text-lg font-semibold">Step 5: Build Final Exam (Course Level)</h2>
          <p className="mt-2 text-xs text-slate-500">
            This is the end-of-course exam. Students can take it only after all lessons + lesson quizzes are completed.
          </p>
          {selectedCourseId == null ? (
            <p className="mt-3 rounded bg-amber-50 p-3 text-sm text-amber-700">
              Select a working course first.
            </p>
          ) : (
            <>
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                <input
                  className="w-full rounded border px-3 py-2"
                  value={finalExamForm.title}
                  onChange={(e) => setFinalExamForm((v) => ({ ...v, title: e.target.value }))}
                  placeholder="Final exam title"
                  required
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="w-full rounded border px-3 py-2"
                  value={finalExamForm.passing_score}
                  onChange={(e) => setFinalExamForm((v) => ({ ...v, passing_score: Number(e.target.value) }))}
                  placeholder="Final exam passing score in % (default: 70)"
                />
                <input
                  type="number"
                  min={1}
                  className="w-full rounded border px-3 py-2"
                  value={finalExamForm.time_limit_sec}
                  onChange={(e) => setFinalExamForm((v) => ({ ...v, time_limit_sec: e.target.value }))}
                  placeholder="Time limit in sec (optional)"
                />
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Final exam passing score is the minimum percentage needed for course completion and certificate issuance.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setFinalExamInputMode("manual")}
                  className={`rounded border px-3 py-2 text-sm ${finalExamInputMode === "manual" ? "bg-slate-900 text-white" : "border-slate-300"}`}
                >
                  Manual Questions
                </button>
                <button
                  type="button"
                  onClick={() => setFinalExamInputMode("json")}
                  className={`rounded border px-3 py-2 text-sm ${finalExamInputMode === "json" ? "bg-slate-900 text-white" : "border-slate-300"}`}
                >
                  Import JSON
                </button>
              </div>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={finalExamForm.is_published}
                  onChange={(e) => setFinalExamForm((v) => ({ ...v, is_published: e.target.checked }))}
                />
                Publish final exam
              </label>

              {finalExamInputMode === "manual" ? (
                <div className="mt-4 space-y-3">
                  {finalExamForm.questions.map((question, qIndex) => (
                    <div key={qIndex} className="rounded-lg border border-slate-200 p-3">
                      <input
                        className="w-full rounded border px-3 py-2"
                        placeholder={`Final exam question ${qIndex + 1}`}
                        value={question.prompt}
                        onChange={(e) => updateFinalExamQuestion(qIndex, { prompt: e.target.value })}
                      />
                      <div className="mt-2 space-y-2">
                        {question.choices.map((choice, cIndex) => (
                          <div key={cIndex} className="flex items-center gap-2">
                            <input
                              className="flex-1 rounded border px-3 py-2"
                              placeholder={`Choice ${cIndex + 1}`}
                              value={choice.text}
                              onChange={(e) => updateFinalExamChoice(qIndex, cIndex, { text: e.target.value })}
                            />
                            <label className="flex items-center gap-1 text-xs">
                              <input
                                type="checkbox"
                                checked={choice.is_correct}
                                onChange={(e) => updateFinalExamChoice(qIndex, cIndex, { is_correct: e.target.checked })}
                              />
                              Correct
                            </label>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => addFinalExamChoice(qIndex)}
                        className="mt-2 rounded border border-slate-300 px-2 py-1 text-xs"
                      >
                        + Add Choice
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-4">
                  <p className="mb-2 text-xs text-slate-500">
                    Paste JSON in this format: question, choices object (A/B/C...), and correct key.
                  </p>
                  <textarea
                    className="min-h-[260px] w-full rounded border px-3 py-2 font-mono text-xs"
                    value={finalExamJsonInput}
                    onChange={(e) => setFinalExamJsonInput(e.target.value)}
                    spellCheck={false}
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" onClick={importFinalExamJson} className="rounded border border-slate-300 px-3 py-1.5 text-sm">
                      Parse JSON
                    </button>
                    <span className="text-xs text-slate-500 self-center">
                      Parsed questions in form: {finalExamForm.questions.length}
                    </span>
                  </div>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {finalExamInputMode === "manual" && (
                  <button type="button" onClick={addFinalExamQuestion} className="rounded border border-slate-300 px-3 py-1.5 text-sm">
                    + Add Question
                  </button>
                )}
                <button disabled={loading || selectedCourseId == null} className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-60">
                  {finalExamExists ? "Update Final Exam" : "Create Final Exam"}
                </button>
              </div>
            </>
          )}
          {renderFeedback("step5-final-exam")}
        </form>

      </section>}

      {(activeView === "build" || activeView === "manage") && <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Current Content Summary</h2>
        <p className="mt-2 text-sm text-slate-600">
          Courses: {courses.length} | Lessons: {lessons.length} | Quizzes: {quizzes.length} | Final Exam: {selectedCourseId && finalExamExists ? "Configured" : "Not Configured"}
        </p>
      </section>}

      {activeView === "manage" && <section className="mt-6 grid gap-4 lg:grid-cols-2">
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
                price_cents: course.price_cents ?? 0,
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
                <select className="w-full rounded border px-3 py-2" value={editCourseForm.level} onChange={(e) => setEditCourseForm((v) => ({ ...v, level: e.target.value }))}>
                  {COURSE_LEVEL_OPTIONS.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
                <input type="number" min={0} className="w-full rounded border px-3 py-2" value={editCourseForm.price_cents} onChange={(e) => setEditCourseForm((v) => ({ ...v, price_cents: Number(e.target.value) }))} placeholder="Required credits to enroll" />
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
                  <>
                    <p className="text-xs text-slate-500">
                      Slash commands supported: `/h1`, `/h2`, `/p`, `/l`, `/c`, `/code` ... `/code`.
                    </p>
                    <textarea className="w-full rounded border px-3 py-2 font-mono text-sm" value={editLessonForm.reading_content} onChange={(e) => setEditLessonForm((v) => ({ ...v, reading_content: e.target.value }))} />
                  </>
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
                <input type="number" min={0} max={100} className="rounded border px-3 py-2" value={editQuizForm.passing_score} onChange={(e) => setEditQuizForm((v) => ({ ...v, passing_score: Number(e.target.value) }))} placeholder="Passing score %" />
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

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="text-lg font-semibold">Manage Final Exam (Quick Actions)</h2>
          <p className="mt-2 text-xs text-slate-500">
            Unpublish, reset question bank, or delete questions one by one.
          </p>
          {selectedCourseId == null ? (
            <p className="mt-3 rounded bg-amber-50 p-3 text-sm text-amber-700">Select a working course first.</p>
          ) : !finalExamExists ? (
            <p className="mt-3 rounded bg-slate-50 p-3 text-sm text-slate-600">
              No final exam configured yet for this course. Use Build view Step 5 first.
            </p>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={unpublishFinalExam} className="rounded border border-slate-300 px-3 py-2 text-sm">
                  Unpublish Final Exam
                </button>
                <button type="button" onClick={resetFinalExam} className="rounded bg-red-700 px-3 py-2 text-sm text-white">
                  Reset Question Bank
                </button>
              </div>
              <div className="mt-4 space-y-2">
                {finalExamForm.questions.map((question, index) => (
                  <div key={`manage-${question.id ?? "new"}-${index}`} className="flex items-start justify-between gap-3 rounded border border-slate-200 bg-slate-50 p-3">
                    <div>
                      <p className="text-sm font-medium">{index + 1}. {question.prompt || "(No question text yet)"}</p>
                      <p className="text-xs text-slate-500">Choices: {question.choices.length}</p>
                    </div>
                    <button
                      type="button"
                      disabled={!question.id}
                      onClick={() => quickDeleteFinalExamQuestion(question.id)}
                      className="rounded border border-red-300 px-3 py-1.5 text-xs text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Delete Question
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          {renderFeedback("manage-final-exam")}
        </div>
      </section>}
    </main>
  );
}
