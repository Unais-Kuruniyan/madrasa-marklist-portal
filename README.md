# School / Madrasa Class Mark List Portal

A production-ready, mobile-first web application for teachers to create/configure classes, define subjects (including special combined **Quran & Hifz** evaluation), enter student marks, automatically calculate totals and pass/fail results, store data in Supabase, and print official A4 class mark lists.

---

## Features

- **No Authentication Friction**: Instant access for trusted teachers without passwords or signup flows.
- **Dynamic Per-Class Subjects**: Each class has its own subjects (e.g. Fiqh, Thaskiya, Arabic, English). Add, reorder, or remove subjects dynamically.
- **Quran + Hifz Special Combined Evaluation**:
  - Quran and Hifz are displayed as two component marks but evaluated **together as one subject**.
  - Pass requirement: Combined total `Quran + Hifz >= 40`.
  - Individual components are **not** checked against 40 separately.
- **Automated Pass/Fail & Grand Total**:
  - Pass (`P`): Every normal subject `>= 40` AND (if enabled) `Quran + Hifz Total >= 40`.
  - Fail (`F`): Any normal subject `< 40` OR `Quran + Hifz Total < 40`.
  - Grand Total includes `Quran + Hifz Total` exactly once.
- **Mobile-First Data Entry**: Large touch inputs, live total/result preview, automatic roll number suggestion, keyboard Enter key navigation, and instant reset for consecutive student entries.
- **Professional A4 Printable Mark List**: Official layout formatted with CSS print media queries, boxed class headings, signature lines, and summary statistics.
- **Supabase Persistence**: Normalized database schema with cascading deletes, integrity triggers, and atomic RPC functions.
- **Vercel Cron Keep-Alive**: Built-in scheduled endpoint to keep Supabase Free Tier active without inserting fake data.

---

## Technology Stack

- **Framework**: React 19 + Vite 8
- **Language**: TypeScript 5
- **Styling**: Tailwind CSS v4
- **Backend / Database**: Supabase (PostgreSQL)
- **Deployment**: Vercel (Static SPA + Vercel Cron Serverless Function)
- **Testing**: Vitest

---

## Business Rules Summary

1. **Pass Mark**: Default pass mark for every normal subject is **40**.
2. **Quran & Hifz Rule**:
   - Optional per class.
   - If enabled, Quran and Hifz marks are entered in separate inputs.
   - `Quran + Hifz Total = Quran + Hifz`.
   - The combined total is treated as **one additional subject** and checked against 40.
   - Example: Quran = 15, Hifz = 25 → Total = 40 (PASS).
   - Example: Quran = 35, Hifz = 45 → Total = 80 (PASS).
3. **Grand Total**:
   - Sum of all normal subject marks + `Quran + Hifz Total` (counted ONCE).
4. **Summary Statistics**:
   - `Appeared Students`: Students who have all required marks submitted.
   - `Pass Percentage`: `(Passed Students / Appeared Students) * 100`, rounded to 2 decimal places.

---

## Quick Start (Local Development)

### 1. Install Dependencies

```bash
npm install
```

### 2. Run Tests

```bash
npm run test
```

### 3. Build & Typecheck

```bash
npm run build
```

---

## Supabase Database Setup

1. Log in to [Supabase](https://supabase.com/) and create a new project.
2. Go to the **SQL Editor** tab in your Supabase project dashboard.
3. Click **New query**.
4. Open the file [`supabase/schema.sql`](./supabase/schema.sql) in this repository, copy its entire contents, paste it into the SQL Editor, and click **Run**.
5. Copy your **Project URL** and **Public Anon Key**:
   - Go to **Project Settings** → **API**.
   - Copy `Project URL`.
   - Copy `anon` / `public` API key.

> **CRITICAL SECURITY NOTE**: Never expose the `service_role` secret key in the frontend or environment variables prefixed with `VITE_`. This application uses only the public `anon` key.

---

## Environment Variables Configuration

Copy `.env.example` to `.env` for local development:

```bash
cp .env.example .env
```

Fill in the environment variables:

```env
# Public Supabase variables (Safe for frontend exposure)
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-actual-anon-key

# Vercel Cron Secret (Server-only secret for keep-alive endpoint)
CRON_SECRET=a_random_32_character_secret_string
```

Run the local development server:

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Vercel Deployment

1. Push your repository to GitHub / GitLab / Bitbucket.
2. Go to [Vercel](https://vercel.com/) and click **Add New** → **Project**.
3. Import your repository.
4. Set Framework Preset to **Vite**.
5. In **Environment Variables**, add:
   - `VITE_SUPABASE_URL` = your Supabase URL
   - `VITE_SUPABASE_ANON_KEY` = your Supabase public anon key
   - `CRON_SECRET` = your secret token for the keep-alive cron job
6. Click **Deploy**.

Vercel will build the React Vite application and automatically register the Vercel Cron job defined in [`vercel.json`](./vercel.json).

---

## Supabase Keep-Alive Mechanism

Supabase Free Tier databases automatically pause after a period of inactivity. To prevent this, the repository includes a lightweight serverless endpoint at `/api/health/supabase.ts`.

### How it works:
- **Schedule**: Vercel Cron hits `/api/health/supabase` daily at 06:00 UTC (configured in `vercel.json`).
- **Authorization**: The endpoint requires a secret token sent in the `Authorization: Bearer <CRON_SECRET>` header.
- **Query**: Performs a minimal, read-only query (`SELECT id FROM classes LIMIT 1`).
- **Safety**: Does not create, modify, or delete any student/mark records.

> **Disclaimer**: This is a best-effort keep-alive helper for Supabase Free Tier projects. Please review Supabase platform policies for updates.

---

## Database Schema Overview

The database is fully normalized:

- `classes`: Stores institution information, class name, max student capacity, and Quran/Hifz flag.
- `subjects`: Stores per-class subjects (`kind = 'normal' | 'quran' | 'hifz'`), names, and display order.
- `students`: Stores student roll numbers and names. Unique constraint on `(class_id, roll_number)`.
- `marks`: Stores student marks per subject (`marks >= 0` AND `marks <= 100`).

Calculated totals, pass/fail status, and summary statistics are derived dynamically in application logic to prevent stale state.

---

## Project Structure

```
├── api/
│   └── health/
│       └── supabase.ts      # Vercel serverless function for keep-alive
├── public/
│   └── favicon.svg
├── src/
│   ├── components/
│   │   ├── ui/              # Button, TextField, Alert, ConfirmDialog, ResultBadge, etc.
│   │   ├── ClassCard.tsx
│   │   ├── StudentForm.tsx  # Core student mark entry form
│   │   ├── StudentTable.tsx # Mark table & summary stats card
│   │   └── SubjectEditor.tsx# Subject list manager
│   ├── hooks/
│   │   ├── useAsyncData.ts
│   │   └── useHashRoute.ts
│   ├── layouts/
│   │   └── AppLayout.tsx
│   ├── lib/
│   │   ├── calculations/
│   │   │   ├── marks.ts     # Central business logic (pass/fail, Quran+Hifz, grand total)
│   │   │   └── marks.test.ts# Vitest unit tests for business rules
│   │   └── supabase/
│   │       ├── api.ts       # Supabase data queries & atomic RPCs
│   │       ├── client.ts    # Supabase browser client
│   │       └── errors.ts    # Error mapper
│   ├── pages/
│   │   ├── ClassFormPage.tsx# Create / edit class screen
│   │   ├── ClassPage.tsx    # Class view, mark list & student entry
│   │   ├── DashboardPage.tsx# Home screen with search and class selection
│   │   └── PrintPage.tsx    # Professional A4 printable document page
│   ├── types/
│   │   └── index.ts         # TypeScript domain and DB types
│   ├── utils/
│   │   ├── format.ts
│   │   ├── storage.ts
│   │   └── validation.ts
│   ├── App.tsx
│   ├── index.css            # Tailwind v4 styles & print CSS
│   └── main.tsx
├── supabase/
│   └── schema.sql           # Complete Supabase SQL schema & RLS policies
├── .env.example             # Environment template
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vercel.json              # Vercel configuration & Cron schedule
└── vite.config.ts
```
