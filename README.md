# MerxyLab

MerxyLab is a structured online teaching platform built for practical skill programs where learners progress step-by-step and instructors maintain strong control over delivery quality.

## What's New (v1.1.x)

- Async video processing with Celery + Redis (upload queue + background transcoding).
- Course scheduling controls (publish/unpublish windows).
- Stronger auth/exam rate-limit and lockout controls.
- Final exam anti-cheat baseline (fullscreen/session behavior + tab-switch handling).
- Public certificate verification page (`/verify/{code}`) with QR flow.
- Signed certificate payload + admin revoke/reissue + verification audit logs.
- Certificate issuance/view requires approved student profile verification.

## Project Purpose

MerxyLab is designed for teaching operations that need more than simple video hosting. It combines gated progression, quiz-based reinforcement, profile verification, final exam controls, and certification into one workflow.

## Tech Stack

- Frontend: Next.js (App Router), TypeScript, Tailwind CSS
- Backend: Django + Django REST Framework + JWT authentication
- Relational data: MySQL
- Quiz document store: MongoDB (optional)
- Media processing: FFmpeg + FFprobe
- Background jobs: Celery + Redis

## Roles and Product Surface

- Student:
  - Register/login
  - Browse courses and enroll with credits
  - Watch protected lessons
  - Pass lesson quizzes to unlock next lessons
  - Take final exam when eligible
  - Receive certificate after passing final exam (profile verification required)
  - Manage profile and verification inputs
- Admin:
  - Manage courses, sections, lessons
  - Upload videos and queue HLS transcode jobs
  - Create/update lesson quizzes
  - Create/publish final exams
  - Review passport/profile verification
  - Manage student credits and enrollment state
  - Revoke/reissue certificates and review verify logs

## Student Learning Flow

1. Student enrolls in a course.
2. Lessons unlock progressively.
3. Lessons without quiz are completed by watch-progress threshold.
4. Lessons with quiz require pass to continue.
5. Final exam unlocks after course progression requirements are satisfied.
6. Certificate is issued only when final exam is passed and profile is verified.

## Video Processing

1. Admin uploads a lesson video.
2. Backend validates FFmpeg/FFprobe and enqueues a transcode job.
3. Celery worker processes job in background and outputs HLS files.
4. Lesson playback uses protected stream access tokens.

## Certification Trust

- Public API verify endpoint: `GET /api/verify/{verification_code}/`
- Public frontend verify page: `/verify/{verification_code}`
- Each certificate has:
  - `certificate_code`
  - `verification_code`
  - signed payload (used for authenticity check)
- Admin actions:
  - revoke
  - reissue
  - view certificate audit + verification events

## Security Highlights

- JWT authentication
- Credit-deduction workflows enforced server-side
- Rate limits/lockouts for auth and exam endpoints
- Final exam anti-cheat baseline (fullscreen and tab-switch controls)
- Protected lesson streaming with time-bound access controls

## Commands

### Run tests

```bash
python backend/manage.py test core.tests.CoreApiFlowTests
```

### Backfill old certificates for signed verification fields

```bash
python backend/manage.py backfill_certificate_signatures
```
