# CTO Architecture Decision

## Executive summary

Departed Digital should remain a Vercel-hosted public website, but the operating system behind it should move to:

- Postgres as the system of record
- object storage for documents
- database-backed sessions for admins
- queued background jobs for reminders, notifications, and integrations

This is the smallest architecture that is robust enough for a real service business with sensitive files, operator workflows, and partner referrals.

## Why the current model is not enough

The current platform already has meaningful product depth:

- case intake
- case status pages
- admin dashboard
- document upload
- analytics
- roles and workflow guidance

But the mutable business state still relies on Blob/file-backed JSON records. That creates risk in exactly the places a live operation cannot tolerate:

- concurrent writes
- archive and delete reliability
- consistent admin updates
- auditability
- future Stripe webhook handling
- future email and reminder automation

Blob should remain the **document store**, not the **case database**.

## Recommended target stack

### Runtime

- Vercel for the public site and API runtime

### Operational database

- Postgres

Recommended providers:

- `Supabase` if speed and bundled tools matter most
- `Neon` if we want a cleaner “database only” choice and keep auth/storage separate

Current approved direction:

- `Supabase` as the first managed database target
- stay on the free tier until Steven explicitly approves any paid upgrade

### Document storage

- Vercel Blob can remain in place for documents
- Supabase Storage is also valid if the stack moves there

### Auth

- keep the current session-cookie model conceptually
- move admin users and sessions into Postgres
- later add customer magic links if needed

### Jobs

- introduce a job runner later for:
  - reminders
  - email sends
  - Stripe webhooks
  - document review workflows
  - AI/operator assist tasks

## System boundaries

### Public surface

- homepage
- SEO pages
- intake
- package selection
- customer case status

### Internal operations surface

- admin authentication
- case queue
- reminder queue
- document review
- partner referrals
- analytics reporting
- operator and AI-assist workflows

## Core design principles

1. Cases are rows, not files.
2. Documents are blobs, but document metadata is relational.
3. Every state change writes an audit event.
4. Public tokens can read and update only client-safe fields.
5. Payment state is owned by the system, not the browser.
6. Reporting comes from SQL, not reconstructed JSON.

## Delivery path

### Phase 1: architecture preparation

Do now without new spend:

- define schema
- define migrations
- add export tooling
- add seed rendering for cutover
- keep the current site running

### Phase 2: provision the managed database

Only after explicit approval:

- create the Postgres project
- add `DATABASE_URL`
- run migrations
- import the current operational snapshot

### Phase 3: repository cutover

- route reads and writes through the Postgres-backed repository
- keep documents in object storage
- preserve current public URLs and UI

### Phase 4: enable integrations

- Resend
- Stripe
- scheduled jobs
- AI operator assistance

## Approval gates before any spend

Do not provision paid infrastructure until Steven explicitly approves:

- provider choice
- spending ceiling
- project region
- production cutover window

## What “done” looks like

The system is production-grade when:

- case writes are transactional
- archive/delete is reliable
- analytics and case records are durable
- documents are linked through relational metadata
- admin permissions are enforced through DB-backed auth
- reminders, emails, and payments can run from events rather than manual memory
