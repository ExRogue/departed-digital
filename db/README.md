# Database Plan

This folder is the production-grade backend target for Departed Digital.

## Why this exists

The current site runs on Vercel and already has:

- case intake
- document upload
- admin auth
- analytics
- workflow guidance

What it does **not** have yet is a transactional system of record. Case state currently lives in Blob/file-backed JSON records, which is good enough for prototyping but not the right long-term source of truth for a service business with:

- multiple operators
- audit requirements
- referrals and payouts
- payments and webhooks
- sensitive document workflows

## Target architecture

- Public site and app runtime: Vercel
- System of record: Postgres
- Documents: object storage
- Auth: database-backed sessions
- Workflow jobs: queued/background job runner later

## Migration files

- `migrations/0001_core.sql`
  Creates the operational tables for cases, users, documents, reminders, payments, notifications, analytics, and audit history.
- `migrations/0002_reporting_views.sql`
  Creates reporting views for queues, partner conversion, and funnel reporting.

## No-spend-first workflow

This repo now supports a preparation-first cutover:

1. Export the current live operational data:

```bash
npm run ops:export
```

2. Review the JSON snapshot in `exports/`.

3. Render an initial Postgres import file:

```bash
npm run ops:render-seed -- exports/<snapshot-file>.json
```

4. Approve the managed database provider.

5. Provision the database and run the SQL migrations.

6. Import the seed file.

7. Switch the app from Blob-backed case state to Postgres-backed case state.

## Recommended provider

Best fit for this business:

- `Supabase` if you want Postgres + storage + auth in one place
- `Neon` if you want pure Postgres and keep auth/storage decisions separate

My recommendation for Departed Digital is still:

- `Supabase` for fastest founder operations
- `Neon` for the cleanest architecture if you want a more composable stack

## Approval gates

Do not create paid infrastructure until Steven explicitly approves:

- provider choice
- spending ceiling
- production project creation
- cutover date

## Important note

Until the app is moved to the Postgres-backed repository, the live system is still an improved prototype. It is usable, but it is not yet the final durable architecture.
