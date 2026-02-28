# Production Handoff Checklist (MerxyLab)

This document is for the next engineer preparing deployment.

## 1) Current Status
- Backend checks: pass (`manage.py check`, tests pass).
- Frontend checks: pass (`npm run lint`, `npm run build`).
- Added production-oriented Django settings toggles:
  - `STATIC_ROOT`, `MEDIA_URL`
  - `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`
  - `SECURE_SSL_REDIRECT`, `SECURE_HSTS_*`
  - optional `USE_X_FORWARDED_PROTO`
- Fixed top-nav hydration mismatch risk by rendering auth nav only after client mount.
- Removed real password from `backend/.env.example` (placeholder only).

## 2) Required Environment (Production)

Backend required:
- `DJANGO_SECRET_KEY` (strong random)
- `DJANGO_DEBUG=false`
- `DJANGO_ALLOWED_HOSTS=<your-domain>,<api-domain>`
- MySQL vars: `MYSQL_*`
- CORS/CSRF:
  - `CORS_ALLOWED_ORIGINS=https://<frontend-domain>`
  - `CSRF_TRUSTED_ORIGINS=https://<frontend-domain>`
- Security flags:
  - `SESSION_COOKIE_SECURE=true`
  - `CSRF_COOKIE_SECURE=true`
  - `SECURE_SSL_REDIRECT=true`
  - `SECURE_HSTS_SECONDS=31536000`
  - `SECURE_HSTS_INCLUDE_SUBDOMAINS=true`
  - `SECURE_HSTS_PRELOAD=true`
  - `USE_X_FORWARDED_PROTO=true` (if behind reverse proxy)

Optional but recommended:
- Mongo:
  - `MONGO_URI=mongodb://...`
  - `MONGO_DB=merxylab`
- FFmpeg/FFprobe:
  - `FFMPEG_BIN`, `FFPROBE_BIN` if not in system PATH

Frontend required:
- `NEXT_PUBLIC_API_BASE_URL=https://<api-domain>/api`

## 3) Pre-Deploy Validation Commands

From repo root:

```powershell
.\.venv\Scripts\python backend\manage.py check
.\.venv\Scripts\python backend\manage.py check --deploy
.\.venv\Scripts\python backend\manage.py test core
.\.venv\Scripts\python backend\manage.py collectstatic --noinput
```

From `frontend/`:

```powershell
npm run lint
npm run build
```

## 4) Deploy-Time Commands

Backend:

```powershell
.\.venv\Scripts\python backend\manage.py migrate
.\.venv\Scripts\python backend\manage.py collectstatic --noinput
```

One-time data sync (if Mongo enabled and SQL has legacy quiz payloads):

```powershell
.\.venv\Scripts\python backend\manage.py sync_quiz_to_mongo
```

## 5) Runtime Smoke Tests

- `GET /api/health/` returns healthy response.
- Login works (admin and student).
- Admin can:
  - create course/lesson
  - upload video
  - create/manage quiz
- Student can:
  - enroll
  - access only unlocked lessons
  - pass/fail quiz with retry/cooldown policy
  - play lesson video

## 6) Ownership Notes For Next Person

- Single source of truth for quiz content is Mongo (when enabled).
- SQL still stores relational progress/attempt/session data.
- Uploaded/transcoded video segments are local media artifacts; use object storage in real production.
- JWT tokens are currently browser localStorage-based. Move to httpOnly secure cookies for stronger XSS resistance in a future hardening cycle.
