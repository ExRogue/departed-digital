# Launch Runbook

## Goal

This runbook is the single source of truth for taking Departed Digital from a polished preview into a reliable live service.

## Current hosted stack

- Public site and API runtime: `Vercel`
- Operational system of record: `Supabase Postgres`
- Supporting documents: `Vercel Blob`
- Admin authentication: database-backed sessions
- Workflow automations: queued jobs via `/api/internal/process-jobs`

## Already complete

- Customer intake, case status, documents, partner flow, and admin dashboard
- Supabase-backed cases, analytics, partner records, and sessions
- Vercel Blob-backed document storage
- Hidden operations entry at `/studio`
- First-party analytics
- Funeral director partner page
- SEO foundation, sitemap, and blog routes

## Still requires Steven

### Domain and DNS

- Confirm Namecheap DNS stays aligned to Vercel and Google Workspace
- Add Resend DNS records once Resend is created

### Email

- Create a `Resend` account
- Verify a sending subdomain such as `updates.departed.digital`
- Add:
  - `RESEND_API_KEY`
  - `EMAIL_FROM`
  - `OPERATIONS_ALERT_EMAIL`
  - `EMAIL_REPLY_TO`

### Payments

- Create Stripe payment links for:
  - Essential `£149`
  - Standard `£249`
  - Estate `£399`
- Add:
  - `STRIPE_PAYMENT_LINK_ESSENTIAL`
  - `STRIPE_PAYMENT_LINK_STANDARD`
  - `STRIPE_PAYMENT_LINK_ESTATE`

### Business inboxes

- Complete Google Workspace recovery so `hello@departed.digital` and `partners@departed.digital` work normally

## Under our control and now done

- Public-safe health data available from `/api/public-config`
- Backup/export script available as `npm run ops:backup`
- Launch, incident, and backup docs in `docs/`
- Sensitive snapshot folders ignored in `.gitignore`
- Admin secrets rotated when deployed

## Final go-live checks

### Customer

1. Open homepage
2. Complete `/start`
3. Confirm `/payment` reflects the selected package
4. Confirm `/documents` blocks uploads until the case is marked paid
5. Confirm `/case` shows status correctly

### Partner

1. Open `/partners`
2. Submit partner enquiry
3. Confirm partner prospect appears in admin

### Admin

1. Log in through `/admin`
2. Review and edit a case
3. Archive and restore a case
4. Confirm analytics and job counts
5. Confirm partner prospects render in the `Partners` view

## Launch recommendation

Do not publicly push traffic until:

- Resend is live
- Stripe links are live
- business inboxes are working
- one full real-world QA pass is completed with those integrations turned on
