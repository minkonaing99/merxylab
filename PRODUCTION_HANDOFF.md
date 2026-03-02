# MerxyLab Production Handoff

## 1. Current Baseline
- Backend: Django + DRF + JWT auth
- Frontend: Next.js App Router
- SQL: MySQL
- Optional document storage: MongoDB for quiz definitions
- Media: local filesystem HLS output (FFmpeg pipeline)

Current seed policy:
- `seed_mvp` creates admin-only baseline user:
  - `merxy / Tkhantnaing1`
- No demo students/courses/lessons are seeded.

## 2. Required Production Environment

Backend required:
- `DJANGO_SECRET_KEY` (strong random)
- `DJANGO_DEBUG=false`
- `DJANGO_ALLOWED_HOSTS=<api-domain>`
- `MYSQL_*` connection values
- `CORS_ALLOWED_ORIGINS=https://<frontend-domain>`
- `CSRF_TRUSTED_ORIGINS=https://<frontend-domain>`
- `SESSION_COOKIE_SECURE=true`
- `CSRF_COOKIE_SECURE=true`
- `SECURE_SSL_REDIRECT=true`
- `SECURE_HSTS_SECONDS=31536000`
- `SECURE_HSTS_INCLUDE_SUBDOMAINS=true`
- `SECURE_HSTS_PRELOAD=true`
- `USE_X_FORWARDED_PROTO=true` (if reverse proxy terminates TLS)

Optional but recommended:
- `MONGO_URI`, `MONGO_DB`, `MONGO_TIMEOUT_MS`
- `FFMPEG_BIN`, `FFPROBE_BIN` if not in PATH

Frontend required:
- `NEXT_PUBLIC_API_BASE_URL=https://<api-domain>/api`

## 3. Pre-Deploy Checks

Backend:
```powershell
.\.venv\Scripts\python backend\manage.py check
.\.venv\Scripts\python backend\manage.py check --deploy
.\.venv\Scripts\python backend\manage.py test core
```

Frontend:
```powershell
cd frontend
npm run lint
npm run build
```

## 4. Deployment Commands
```powershell
.\.venv\Scripts\python backend\manage.py migrate
.\.venv\Scripts\python backend\manage.py collectstatic --noinput
.\.venv\Scripts\python backend\manage.py seed_mvp
```

If Mongo is enabled and you need to sync legacy SQL quiz payloads:
```powershell
.\.venv\Scripts\python backend\manage.py sync_quiz_to_mongo
```

## 5. Smoke Test Checklist
- `GET /api/health/` returns `{"status":"ok"}`
- Admin login works in frontend and Django admin
- Admin can create course/lesson/quiz/final exam
- Video upload/transcoding works (FFmpeg present)
- Student can register and enroll using credits
- Progression lock works across lessons/quizzes
- Final exam unlock + certificate issuance flow works
- Admin student verification approve/deny flow works

## 6. Operational Notes
- Quiz source of truth is Mongo when configured; SQL quiz payload is cleared to avoid duplication.
- SQL remains source of truth for relational entities and user progress.
- Course/Lesson delete now performs media cleanup (HLS files) and quiz payload cleanup.
- Profile deny clears stored passport photo file and sets verification note.

## 7. Hardening Next (Recommended)
- Move JWT storage from localStorage to httpOnly secure cookies.
- Move media to object storage (S3-compatible) + CDN.
- Add centralized logging/monitoring and alerting.
- Add rate limiting and audit logs around admin-critical actions.
