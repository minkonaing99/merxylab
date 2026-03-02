# MerxyLab

MerxyLab is a structured online teaching platform built for practical skill programs where learners progress step-by-step and instructors maintain strong control over delivery quality.

## Project Purpose

MerxyLab is designed for teaching operations that need more than simple video hosting. It combines gated progression, quiz-based reinforcement, profile verification, and final certification into one workflow.

The platform targets two goals:

- Help students complete courses in the correct order with measurable outcomes.
- Give instructors/admins operational control over content, exams, student verification, and credit-based enrollment.

## Tech Stack

- Frontend: Next.js (App Router), TypeScript, Tailwind CSS
- Backend: Django + Django REST Framework + JWT authentication
- Relational data: MySQL
- Quiz document store: MongoDB (optional)
- Media processing: FFmpeg + FFprobe (HLS conversion)

## Roles and Product Surface

- Student experience:
  - Register/login
  - Browse courses and enroll with credits
  - Watch protected lessons
  - Pass lesson quizzes to unlock next lessons
  - Take final exam when eligible
  - Receive certificate after passing final exam
  - Manage profile and identity verification inputs
- Admin experience:
  - Manage courses, sections, lessons
  - Upload videos and trigger HLS pipeline
  - Create/update lesson quizzes
  - Create/publish final exams
  - Review student profile/passport verification
  - Manage student credit wallets and enrollment state

## How Teaching Works (Student Learning Flow)

1. Student enrolls in a course.
2. Lessons are unlocked progressively (not all at once).
3. For lessons without quiz, completion is based on watch progress.
4. For lessons with quiz, student must pass the quiz to continue.
5. After all lessons and lesson quizzes are completed, final exam is unlocked.
6. Student passes final exam and receives certificate.

This flow enforces real progression and prevents skipping core learning checkpoints.

## Lesson Access and Progression Logic

MerxyLab uses strict unlock logic:

- A lesson is accessible only when prior required conditions are met.
- Video-only lesson completion can be marked when watch progress reaches the threshold (implemented at ~90% watch progress).
- If a previous lesson has a quiz, passing that quiz is mandatory before unlocking next lessons.

This makes lesson order meaningful and keeps course completion standards consistent.

## Video Processing and Protected Playback

### Upload and Processing

When admin uploads lesson video:

- Backend validates processing tools (FFmpeg/FFprobe).
- Video is transcoded to HLS output (manifest + segments).
- Generated HLS path is attached to lesson for playback.

### Playback Security Model

Playback is not a direct public file link:

- Student requests protected playback endpoints.
- Backend issues stream session context with tokenized access.
- Heartbeat endpoints extend active viewing session.
- Manifest/segment access is validated to reduce unauthorized reuse.
- Token propagation is applied for child HLS URLs during playback.

This protects premium course media while preserving smooth HLS playback.

## Quiz System

Lesson quizzes are tied to progression:

- Quiz questions and choices are served through API.
- Submission validates question-choice pairs server-side.
- Score and pass/fail are calculated in backend.
- Passing a quiz updates progression state so next lesson can unlock.

Quiz payload can be sourced from MongoDB when enabled, while relational entities remain in MySQL.

## Final Exam Randomization (Detailed)

Final exam flow includes server-controlled randomization:

- Exam opens only after course completion conditions are satisfied.
- On exam session activation, backend samples a question set from exam bank.
- Question order is shuffled.
- Choice order per question is also shuffled.
- Session stores selected question IDs and choice order map.

Important behavior:

- The randomized set is session-based and reused consistently during that active exam session.
- Submit endpoint validates answers only against that session’s question set and choice mapping.
- Score is calculated server-side; pass threshold determines outcome.
- Retry fee logic can deduct credits for re-attempts where configured.

## Certification Logic

After passing final exam:

- Backend issues (or reuses) course certificate record.
- Certificate is tied to student + course.
- Certificate code is unique.

This ensures one canonical certificate per learner per course.

## Identity and Enrollment Controls

Beyond content delivery, MerxyLab includes operations-grade controls:

- Student profile + passport verification status lifecycle (pending/verified/rejected).
- Admin review notes and re-upload requirements on rejection.
- Credit wallet model for enrollment and exam retry economics.
- Admin wallet adjustment endpoints for support/operations workflows.

## Data Responsibility Split

- MySQL: users, courses, lessons, enrollments, progression, attempts, certificates, wallets.
- MongoDB (optional): quiz definition documents.

This split keeps relational integrity in SQL while allowing flexible quiz document management.

## Why This Project Is Useful for Teaching Teams

MerxyLab is valuable when teaching teams need:

- Structured progression instead of free-form content browsing.
- Measurable competency gates (quiz + exam).
- Controlled media access for paid/private programs.
- Admin workflows for learner verification and financial controls.
- A single platform covering content, assessment, and certification.

## Certificate Trust Rollout (Phase 9)

For production rollout, apply this sequence:

1. Deploy backend code and run migrations:
   - `python backend/manage.py migrate`
2. Backfill existing certificates (safe to run multiple times):
   - `python backend/manage.py backfill_certificate_signatures`
   - Optional preview first: `python backend/manage.py backfill_certificate_signatures --dry-run`
3. Verify public endpoint:
   - `GET /api/verify/{verification_code}/`
4. Verify admin controls:
   - Revoke: `POST /api/admin/certificates/{id}/revoke/`
   - Reissue: `POST /api/admin/certificates/{id}/reissue/`
   - Audit feed: `GET /api/admin/certificates/audit/`
   - Verification event feed: `GET /api/admin/certificates/verification-logs/`

Rollout note:
- Public verify now has IP rate limiting. Tune with:
  - `CERT_VERIFY_RATE_LIMIT`
  - `CERT_VERIFY_RATE_WINDOW_SECONDS`
  - `CERT_VERIFY_RATE_LOCK_SECONDS`

## Acceptance Checklist (Phase 10)

Minimum acceptance criteria before release:

1. QR/verify path
   - Download certificate and scan QR.
   - Verify it opens `/verify/{code}` and shows `valid`.
2. Tamper detection
   - Any signed payload corruption must return `invalid_signature`.
3. Revocation behavior
   - Revoked certificate must return `revoked` in public verify.
4. Reissue behavior
   - Reissued certificate must produce new `certificate_code` and `verification_code`.
   - Old verification code must no longer resolve.
5. Legacy compatibility
   - Certificates missing verification/signature fields are backfilled and become verifiable.
6. Monitoring
   - Verification events visible in admin verification logs.
   - Rate-limited requests logged as `RATE_LIMITED`.

Automated coverage:
- `python backend/manage.py test core.tests.CoreApiFlowTests`
