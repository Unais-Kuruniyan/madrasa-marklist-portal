# School / Madrasa Class Mark List Portal

A complete, production-ready, mobile-first web application for teachers to create and configure classes, define subjects (including special combined **Quran & Hifz** evaluation), manage examinations, enter student marks categorized by **Boys** and **Girls** with independent roll number sequences, automatically calculate totals and pass/fail results, store data in Supabase, and print official A4 class mark lists.

---

## Features & Business Rules

- **No Authentication Friction**: Frictionless access for trusted teachers.
- **Boys & Girls Category & Independent Roll Numbers**:
  - Each student is categorized as **Boys** or **Girls**.
  - Boys and Girls have **completely independent roll-number sequences** (e.g. Boy Roll 1 Ahmed and Girl Roll 1 Ayesha coexist in the same class/exam).
  - Auto-suggests the next roll number independently for the selected category upon toggle.
  - Manual roll number editing supported with duplicate validation per category.
- **Dynamic Per-Class Subjects & Quran + Hifz Rule**:
  - Dynamic subjects per class (Fiqh, Thaskiya, Arabic, English, etc.).
  - **Quran & Hifz Combined Evaluation**: Quran and Hifz marks are entered separately but evaluated **together as ONE subject**.
  - Pass mark threshold: Combined total `Quran + Hifz >= 40`.
  - Individual Quran and Hifz marks are **not** checked against 40 separately.
- **Automated Pass/Fail & Grand Total**:
  - Pass (`P`): Every normal subject `>= 40` AND (if enabled) `Quran + Hifz Total >= 40`.
  - Fail (`F`): Any normal subject `< 40` OR `Quran + Hifz Total < 40`.
  - Grand Total includes `Quran + Hifz Total` exactly once.
- **Combined Mathematical Summary Statistics**:
  - Summary stats displayed in mathematical format: `Boys + Girls = Total` (e.g. `10 + 5 = 15`).
  - Total Participants: `10 + 5 = 15`
  - Appeared: `9 + 5 = 14`
  - Passed: `10 + 4 = 14`
  - Failed: `0 + 1 = 1`
  - Overall Pass Percentage: `(totalPassed / totalAppeared) * 100` (ONE overall percentage, rounded to 2 decimal places).
- **Exam Management & Historical Preservation**:
  - Supports Exam Name (e.g. Half-Yearly Examination, Annual Examination) and Exam Year (e.g. 2026).
  - Creating a new exam (e.g., Annual Exam) under a class **preserves previous exam records** without overwriting old mark lists.
- **New Official Print Header Layout**:
  - Prominent rectangular **Class Box** on the RIGHT side of the print header.
  - Institution Name centered at the top.
  - Location and Range (e.g. Tirur Range) subtitles.
  - Exam Name & Year title line.
  - Clear `BOYS` and `GIRLS` section header rows in the table.
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

## Database Setup

1. Open your Supabase project dashboard → **SQL Editor**.
2. Run the SQL script from [`supabase/schema.sql`](./supabase/schema.sql).
3. Copy `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to your `.env` and Vercel environment settings.

---

## Quick Start (Local Development)

```bash
# 1. Install dependencies
npm install

# 2. Run unit tests
npm run test

# 3. Start dev server
npm run dev

# 4. Typecheck & production build
npm run build
```
