# Student Cumulative Dashboard (Node.js + MongoDB Atlas)
Student dashboard that imports semester Excel results, stores normalized records in MongoDB Atlas, and retrieves cumulative summaries by roll number.

## Features
- Excel ingestion for semester sheets (`1-1` to `4-1`)
- Cohort-aware cumulative rules:
  - `B91` (regular): `1-1` to `4-1`
  - `B95` (lateral): `2-1` to `4-1`
- Roll number parsing supports alphanumeric endings such as `22B91A05A0`, `22B91A05A1`
- Dashboard views:
  - student profile
  - final cumulative CGPA
  - backlog metrics
  - semester performance
  - permission letter history
  - manual backlog correction (mark subject as pass)
- REST APIs for import, summary, permissions, and health

## Project structure
- `src/server.js` - Express entrypoint + API routes
- `src/db.js` - MongoDB connection utilities
- `src/models.js` - Mongoose models
- `src/ingestion.js` - Excel parsing + import persistence
- `src/summaryService.js` - summary computation service
- `src/subjectService.js` - manual subject/backlog update service
- `src/permissionsService.js` - permission CRUD service
- `public/index.html` - dashboard UI
- `public/static/` - frontend assets
- `scripts/import-results.js` - CLI import helper
- `render.yaml` - Render deployment blueprint

## Local setup
1. Create env file:
   - Copy `.env.example` to `.env`
   - Set `MONGODB_URI`
   - The app auto-loads `.env` values via `dotenv`
2. Install dependencies:
   - `npm install`
3. Start server:
   - `npm run dev`
4. Open:
   - `http://127.0.0.1:8000`

## Environment variables
- `MONGODB_URI` (required): MongoDB Atlas connection string
- `PORT` (optional): server port (defaults to `8000` locally; Render injects this automatically)

## Data import
### From dashboard
Use **Import Results** and submit an Excel file path.

### From CLI
- `npm run import:results -- "F:\student-dashboard\22B SERIES CSE RESULT ANALYSIS - Copy.xlsx"`

## Manual backlog correction
1. Search a student roll number.
2. In **Backlog Subjects (Manual Update)** click **Mark Pass** for the cleared subject.
3. The app updates that subject and recomputes related semester metrics (backlog count / SGPA / points).

## Core APIs
- `POST /api/import/results`
- `GET /api/students/{roll_no}/summary`
- `GET /api/students/{roll_no}/permissions`
- `POST /api/students/{roll_no}/permissions`
- `PUT /api/permissions/{permission_id}`
- `DELETE /api/permissions/{permission_id}`
- `PUT /api/subjects/{subject_id}` (manual subject update / mark pass)
- `GET /api/health`

## Deploy to Render
1. Push this project to GitHub/GitLab.
2. In Render, create a **Web Service** from the repo.
3. Use:
   - Build command: `npm install`
   - Start command: `npm start`
4. Add environment variable:
   - `MONGODB_URI` = your Atlas URI
5. Deploy and open your Render URL.
