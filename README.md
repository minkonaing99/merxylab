# MerxyLab

MerxyLab is a structured online teaching platform built for practical skill programs where learners progress step-by-step and instructors maintain strong control over delivery quality.

## What's New (v1.2.0)

- Async video processing with Celery + Redis (upload queue + background transcoding).
- Course scheduling controls (publish/unpublish windows).
- Stronger auth/exam rate-limit and lockout controls.
- Final exam anti-cheat baseline (fullscreen/session behavior + tab-switch handling).
- Public certificate verification page (`/verify/{code}`) with QR flow.
- Signed certificate payload + admin revoke/reissue + verification audit logs.
- Certificate issuance/view requires approved student profile verification.
- Certificate PDF is now pre-generated and saved on server when final exam is passed.
- Certificate verification URLs now point to frontend verify page via `FRONTEND_BASE_URL` (for example `http://localhost:3000/verify/{code}`).
- If student passed final exam before profile approval, certificate is issued automatically after profile becomes verified (no retake required).

## Tech Stack

- Frontend: Next.js (App Router), TypeScript, Tailwind CSS
- Backend: Django + Django REST Framework + JWT authentication
- Relational data: MySQL
- Quiz document store: MongoDB (optional)
- Media processing: FFmpeg + FFprobe
- Background jobs: Celery + Redis
- Certificate PDF rendering: Playwright (Chromium)

## Student Learning Flow

1. Student enrolls in a course.
2. Lessons unlock progressively.
3. Lessons without quiz are completed by watch-progress threshold.
4. Lessons with quiz require pass to continue.
5. Final exam unlocks after course progression requirements are satisfied.
6. Certificate is issued only when final exam is passed and profile is verified.
7. Certificate PDF is generated and stored server-side for direct download.

## Certificate Trust + PDF

- Public API verify endpoint: `GET /api/verify/{verification_code}/`
- Public frontend verify page: `/verify/{verification_code}`
- Certificate identity fields:
  - `certificate_code`
  - `verification_code`
  - signed payload
- Stored PDF file:
  - `certificate_pdf` on certificate model
  - generated at issuance
  - regenerated automatically if missing on download request
- Backend env:
  - `FRONTEND_BASE_URL` controls certificate/public verify link origin

## Commands

### Install backend dependencies

```bash
pip install -r backend/requirements.txt
playwright install chromium
```

### Migrate

```bash
python backend/manage.py migrate
```

### Run tests

```bash
python backend/manage.py test core.tests.CoreApiFlowTests
```

### Backfill old signature fields

```bash
python backend/manage.py backfill_certificate_signatures
```
