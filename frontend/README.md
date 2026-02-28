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
- `/courses/[slug]` course page
- `/lessons/[id]` lesson page
- `/lessons/[id]/quiz` lesson quiz
- `/admin-ui` custom admin management UI

## Notes

- Frontend expects backend auth + API on port `8000`.
- Quiz data is served by backend from MongoDB when configured.
