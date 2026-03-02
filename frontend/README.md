# MerxyLab Frontend

Next.js frontend for MerxyLab LMS MVP.

## Start

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

## Required Env

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000/api
```

## Main Routes

- `/` home + course catalog
- `/login` / `/register`
- `/dashboard` student dashboard
- `/profile` student profile + exam readiness + certificate actions
- `/courses/[slug]` course page
- `/lessons/[id]` lesson page
- `/lessons/[id]/quiz` lesson quiz
- `/final-exam/[courseId]` final exam
- `/verify/[code]` public certificate verify page
- `/admin-students` admin student management
- `/admin-ui` custom admin management UI
- `/admin-schedule` admin course schedule management

## Notes

- Frontend expects backend auth + API on port `8000`.
- Quiz data is served by backend from MongoDB when configured.
- Admin routes include a global floating upload/transcode tracker panel during active jobs.
