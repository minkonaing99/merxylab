# MerxyLab

MerxyLab is a learning platform MVP with a Django API backend and Next.js frontend.
It supports role-based access (`admin`, `student`), course enrollment, lesson progression locks, protected video streaming, and quiz-based lesson gating.

## Highlights

- JWT authentication and role-aware UI flows
- Admin course builder UI (`/admin-ui`) for:
  - creating courses and lessons
  - uploading/transcoding lesson videos to HLS
  - creating and managing quizzes
- Student flow with:
  - enroll/continue dashboard
  - locked lesson progression (previous lesson + quiz pass requirements)
  - quiz retries with cooldown policy
- Protected HLS playback with lease/session/token checks
- MongoDB-backed quiz document storage (Mongo is source of truth when enabled)

## Tech Stack

- Frontend: Next.js (App Router), TypeScript, Tailwind CSS
- Backend: Django 6, Django REST Framework, SimpleJWT
- SQL DB: MySQL
- Document DB: MongoDB (quiz documents)
- Media pipeline: FFmpeg/FFprobe for HLS transcoding

## Project Structure

- `backend/` Django API, models, migrations, management commands
- `frontend/` Next.js app and UI

## Core API Areas

- Auth: login/register/logout/me
- Courses: catalog, detail, enrollment, lesson list
- Lessons: detail, progress, stream access
- Quiz: fetch lesson quiz, submit, attempts
- Admin: course/lesson/quiz CRUD, enrollments, insights, video upload

## Data Notes

- SQL stores users, courses, lessons, enrollments, lesson progress, quiz attempts, and stream sessions.
- Quiz definitions are stored in MongoDB collection: `lesson_quizzes`.
- When Mongo is enabled, SQL `quiz_payload` is cleared to avoid duplicate source-of-truth data.

## Notes

- This repository includes application code only.
- Local secrets and local run notes are excluded from version control.
