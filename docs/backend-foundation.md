# Departed Digital Backend Foundation

## Goal

Evolve Departed Digital from a static marketing site into an operational platform without throwing away the current site, URLs, or SEO gains.

## Current implementation status

The site now includes a first backend foundation inside the repo:

- `/api/cases` for case creation, public case lookup, and package updates
- `/api/events` for public funnel events such as package selection and payment CTA clicks
- `/api/analytics` for lightweight first-party page-view and CTA tracking
- `/api/documents` for supporting document uploads tied to a case
- `/api/public-config` for payment link and package config exposure
- `/api/admin/cases` and `/api/admin/stats` for the internal dashboard
- `/admin` and the discreet alias `/studio` as the first operations dashboard for Steven and the VA

This means the front end no longer has to stay browser-only forever. The intake, payment, and document steps are ready to talk to a real store.

The platform needs to support:

- secure case intake
- customer and case records
- document handling
- payment status
- funeral director referral tracking
- internal workflow for the VA
- analytics for leads, purchases, and case completion

## Recommended stack

### Frontend

- Keep the current public marketing pages on Vercel
- Migrate to a Next.js app only when the intake and dashboard layers are ready
- Preserve existing URLs:
  - `/`
  - `/blog`
  - `/blog/delete-deceased-facebook-account-uk`
  - `/start`

### Backend

- Vercel serverless functions or Next.js route handlers for API endpoints
- Postgres for operational data
- Supabase is a strong fit because it gives:
  - Postgres
  - auth if needed later
  - storage for documents
  - row-level security if client logins are added

### Payments

- Stripe for one-off case payments
- Start with payment links
- Move to full Checkout Sessions once the intake form can create draft cases automatically
- Store Stripe webhook events in the database so payment state is never inferred from the browser alone

### Documents

- Store uploaded documents in encrypted object storage
- Do not rely on email as the long-term source of truth for death certificates or executor documents
- Use signed upload URLs and short-lived access URLs

## Environment variables to add in Vercel

### Required for production storage

- `BLOB_READ_WRITE_TOKEN`

### Required for the admin dashboard

- `ADMIN_ACCESS_TOKEN`

### Optional for live Stripe handoff

- `STRIPE_PAYMENT_LINK_ESSENTIAL`
- `STRIPE_PAYMENT_LINK_STANDARD`
- `STRIPE_PAYMENT_LINK_ESTATE`

### Optional for local smoke testing

- `DEPARTED_DATA_ROOT`

If `BLOB_READ_WRITE_TOKEN` is missing on Vercel, the APIs now return a clear configuration error instead of pretending the backend is live.

### Analytics

- Search Console for indexing and SEO coverage
- GA4 or PostHog for funnel analytics
- Server-side events for:
  - enquiry started
  - enquiry submitted
  - payment link sent
  - payment completed
  - case opened
  - case completed
  - referral converted

Current implementation:

- first-party analytics are already wired into the site and surfaced in the admin dashboard
- top pages, top CTA clicks, and funnel signals can now be viewed without a third-party dashboard
- durable analytics still benefit from `BLOB_READ_WRITE_TOKEN`, even though a temporary fallback can run before that is configured

## Core data model

### `customers`

- `id`
- `full_name`
- `email`
- `phone`
- `relationship_to_deceased`
- `created_at`

### `cases`

- `id`
- `customer_id`
- `deceased_name`
- `package_tier` (`essential`, `standard`, `estate`)
- `target_completion_days`
- `status` (`new`, `awaiting_docs`, `awaiting_payment`, `active`, `submitted`, `completed`, `blocked`)
- `preferred_outcome` (`delete`, `memorialise`, `mixed`)
- `referred_by_funeral_director_id` nullable
- `created_at`
- `updated_at`

### `case_platforms`

- `id`
- `case_id`
- `platform_name`
- `platform_url_or_handle`
- `submission_status`
- `submitted_at`
- `resolved_at`
- `notes`

### `documents`

- `id`
- `case_id`
- `document_type`
- `storage_path`
- `verified_at`
- `expires_at` nullable

### `payments`

- `id`
- `case_id`
- `stripe_payment_intent_id` or `stripe_checkout_session_id`
- `amount_gbp`
- `status`
- `paid_at`

### `funeral_directors`

- `id`
- `business_name`
- `contact_name`
- `email`
- `status`
- `referral_fee_gbp`

### `referrals`

- `id`
- `funeral_director_id`
- `case_id`
- `conversion_status`
- `payout_status`
- `payout_due_at`

### `audit_events`

- `id`
- `case_id`
- `actor_type`
- `event_name`
- `metadata_json`
- `created_at`

## Product phases

## Phase 1: strong lead capture

Ship first:

- real intake form instead of `mailto`
- package selection and case details capture
- basic admin inbox or Notion sync
- Stripe payment links

Result:

- the website becomes genuinely purchase-ready
- every enquiry becomes structured data

Status:

- Partially complete
- Real intake API and admin dashboard are now in the repo
- Stripe still needs real payment links

## Phase 2: case operations

Ship next:

- internal dashboard for Steven and the VA
- case statuses and notes
- document upload flow
- payment tracking
- referral tracking

Result:

- fulfilment becomes manageable without inbox chaos

Status:

- In progress
- Dashboard and uploads now exist in code
- Production storage still depends on Vercel Blob being configured

## Phase 3: customer portal

Ship later:

- customer login or magic-link access
- live case status view
- document requests
- downloadable completion report

Result:

- more trust for families
- fewer manual update emails

## Immediate implementation priorities

1. Add `BLOB_READ_WRITE_TOKEN` in Vercel so case storage and uploads become durable in production
2. Add `ADMIN_ACCESS_TOKEN` so `/admin` can be used safely live
3. Add Stripe payment links and bind the package CTAs on `/payment` through `/api/public-config`
4. Capture referral source from funeral director handoffs more explicitly in the public flow
5. Move case storage from JSON/blob documents into Postgres when the reporting/admin needs outgrow file-style records
6. Add server-side analytics events around payment completion and case completion
7. Add operator templates and automations for payment follow-up, document requests, and completion summaries

## Important constraints

- Do not store sensitive documents in plain email long-term
- Do not promise exact platform completion dates as guarantees
- Keep package logic and referral logic in config so prices can change without rewriting multiple pages
- Make every operational action auditable because estate-related work can become sensitive quickly
