# MerxyLab

MerxyLab is an online learning platform with:
- Django REST backend (`backend/`)
- Next.js frontend (`frontend/`)
- MySQL for relational data
- Optional MongoDB for quiz document storage
- FFmpeg/FFprobe pipeline for HLS video conversion

## Core Capabilities
- Role-based auth (`admin`, `student`)
- Admin control center (`/admin-ui`) for course/lesson/quiz/final-exam management
- Student progression lock (lesson-by-lesson with quiz gating)
- Protected HLS stream sessions with token + heartbeat
- Student profile verification workflow with admin approve/deny
- Credits-based enrollment model

## Stack
- Frontend: Next.js App Router, TypeScript, Tailwind CSS
- Backend: Django 6, DRF, SimpleJWT
- Databases: MySQL + optional MongoDB (`lesson_quizzes`)
- Media: FFmpeg + FFprobe

## Local Quick Start
1. Configure env files:
   - `backend/.env` from `backend/.env.example`
   - `frontend/.env.local` from `frontend/.env.local.example`
2. Run backend:
   - `.\.venv\Scripts\python backend\manage.py migrate`
   - `.\.venv\Scripts\python backend\manage.py seed_mvp`
   - `.\.venv\Scripts\python backend\manage.py sync_quiz_to_mongo`
   - `.\.venv\Scripts\python backend\manage.py runserver 8000`
3. Run frontend:
   - `cd frontend`
   - `npm install`
   - `npm run dev`

Admin seed account:
- Username: `merxy`
- Password: `Tkhantnaing1`

Detailed local setup: [RUN_LOCAL.md](./RUN_LOCAL.md)  
Fresh-machine setup: [instruction.md](./instruction.md)

## Production Readiness
Use this as the deployment baseline:
- Set production env values (`DJANGO_DEBUG=false`, secure cookies, host allowlist, CORS/CSRF origins).
- Run:
  - `python backend/manage.py check --deploy`
  - `python backend/manage.py migrate`
  - `python backend/manage.py collectstatic --noinput`
  - `npm run build` (frontend)
- Ensure FFmpeg exists on server PATH (or set `FFMPEG_BIN` / `FFPROBE_BIN`).
- Put media/static behind proper serving infra (Nginx/CDN/object storage).

Deployment handoff details: [PRODUCTION_HANDOFF.md](./PRODUCTION_HANDOFF.md)

## Notes
- If `MONGO_URI` + `MONGO_DB` are configured, quiz definitions are sourced from MongoDB.
- SQL remains source of truth for users/courses/enrollments/progress/attempts/sessions.
