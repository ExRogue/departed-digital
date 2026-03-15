# Incident Response

## Objective

Keep Departed Digital usable and trustworthy if something breaks in production.

## Fast triage order

1. Can families still start a case?
2. Can admins still log in?
3. Are documents still uploading?
4. Are case updates still saving?
5. Are email and payment integrations affected too?

## Health endpoints and checks

- Public-safe readiness endpoint: `/api/public-config`
- Admin system view: `/admin` -> analytics / system health area

## Common failure modes

### Admin login failure

Check:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET`
- Supabase database connectivity

Immediate fallback:

- rotate credentials and redeploy

### Case save failure

Check:

- `/api/public-config`
- Supabase project status
- recent schema changes

Immediate fallback:

- stop making schema edits
- export a snapshot
- test read/write on a single case before broader action

### Document upload failure

Check:

- `BLOB_READ_WRITE_TOKEN`
- Blob service status
- file-size and document-count limits

Immediate fallback:

- pause uploads publicly
- keep case intake open
- collect documents manually only if absolutely necessary

### Email failure

Check:

- `RESEND_API_KEY`
- sender-domain verification
- `EMAIL_FROM`
- `OPERATIONS_ALERT_EMAIL`

Immediate fallback:

- use the admin dashboard and direct inboxes manually until Resend is restored

### Payment failure

Check:

- Stripe payment links
- `/payment` config

Immediate fallback:

- send payment links manually
- mark payment state from admin once confirmed

## After-action steps

After any production issue:

1. confirm the failure is resolved
2. run one customer-path smoke test
3. run one admin-path smoke test
4. note what failed and what changed
5. take a fresh backup if the system state changed materially
