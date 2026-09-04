# Infrastructure notes

Settings that live outside this repo, so they are not discoverable from the
code. Update this file when they change.

## Vercel firewall: Stripe webhook bypass (added 4 Sep 2026)

**Where:** Vercel dashboard → departed-digital → Firewall → Rules →
"DDoS Mitigations and System Bypasses".

**What:** 15 System Bypass rules, one per Stripe webhook IP, host
`www.departed.digital`, each noted "Stripe webhook IP". They exempt Stripe's
webhook servers from Vercel's automatic DDoS mitigation so payment
confirmations (`/api/webhooks/stripe`) can never be challenged during a
mitigation event. Webhook authenticity is still enforced in code via the
`STRIPE_WEBHOOK_SECRET` signature check — the bypass only affects
reachability, not trust.

**Why:** On 3 Sep 2026 ~23:25 UTC, automated deploy-verification traffic
tripped Vercel's automatic DDoS mitigation. For ~25 minutes the site served a
"Vercel Security Checkpoint" to new visitors and would have challenged
Stripe's server-to-server webhook calls (no payments occurred in the window).
Mitigation events also fire organically (one triggered by a scanner the next
morning), so the bypass removes a permanent, silent failure mode.

**Source of IPs:** https://stripe.com/files/ips/ips_webhooks.json
(15 IPs as of 4 Sep 2026: 3.18.12.63, 3.69.109.8, 3.120.168.93,
3.130.192.231, 13.235.14.237, 13.235.122.149, 18.211.135.69, 35.154.171.200,
35.157.207.129, 52.15.183.38, 54.88.130.119, 54.88.130.237, 54.187.174.169,
54.187.205.235, 54.187.216.72)

**Maintenance:** Stripe rarely changes this list, but if webhook deliveries
ever start failing during a mitigation event, re-check the JSON above and add
any new IPs as bypass rules. Stripe retries failed deliveries with backoff
for up to ~3 days, so short gaps self-heal once fixed.

## Other out-of-repo settings (for reference)

- **Stripe webhook endpoint:** `https://www.departed.digital/api/webhooks/stripe`,
  listening to `checkout.session.completed` (destination "charismatic-voyage").
- **Vercel crons:** `/api/cron/reminders` daily 09:00 UTC (defined in
  `vercel.json`), authenticated with `CRON_SECRET`.
- **DNS (Namecheap):** SPF (Google), DKIM (Resend), DMARC on `_dmarc`
  (recommended value: `v=DMARC1; p=quarantine; rua=mailto:hello@departed.digital`).
- **Deploy checks:** verify deployments against `departed-digital.vercel.app`
  or the Vercel API — not with rapid polling of the production domain, which
  is what tripped the 3 Sep mitigation.
