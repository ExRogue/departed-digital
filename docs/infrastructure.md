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

## Analytics: internal traffic and key events (added 9 Sep 2026)

- GA4 property G-VBKFG16BZY loads only after the visitor accepts the analytics cookie (scripts/consent.js).
- Every first party event sent to /api/analytics is mirrored into GA4 by `forwardToGoogle()` in scripts/site-analytics.js when gtag exists. Event names: page_view, article_view, cta_click, intake_submitted, payment_confirmed, documents_uploaded, partner_lead_submitted, video_played, not_found_view, broken_link_rescued, broken_link_listed. Click types seen in cta_click since 21 Sep 2026: homepage_guide, homepage_guides_all, stuck_cta, stuck_email, checklist_pdf, guide_sidebar_cta, service_cta, service_email.
- Key events in GA4 Admin: intake_submitted, payment_confirmed, partner_lead_submitted.
- Internal traffic: open any page with `?operator=1` once on a device to mark that browser as internal (`?operator=0` clears it). The flag lives in localStorage as departedDigitalOperatorBrowser, sets `traffic_type=internal` on the GA4 tag, and is excluded by the Internal Traffic data filter, which is Active. Non production hosts are always internal.
- The showcase film (`/videos/departed-digital-showcase.mp4`, on the homepage, /partners and /partners/aftercare) is served with `preload="none"`, so none of its 1.3 MB downloads until a visitor presses play. A play fires `video_played` once per video per page view, from a capture phase listener in scripts/site-analytics.js. The source cut lives outside the repo in `creative/website-showcase/`; re-export from there if the interface changes.
- The 404 page (404.html) loads analytics through consent.js like every other page; until 13 Sep 2026 it loaded GA4 directly without consent. It marks itself with `data-page="not-found"`, so a miss is recorded as `not_found_view` rather than `article_view`. For a missing address under /blog/ it fetches the guide list from /blog and works out which guide was meant, allowing for addresses cut short, with punctuation stuck on the end, or base64 encoded and truncated (seen in September 2026 as /blog/ZGlnaXRhbC, the checklist guide). One match redirects and records `broken_link_rescued` with the damaged and target addresses; several matches, or none, show a list and record `broken_link_listed`. New guides need no change here as long as they appear as cards on /blog.
- Fonts: Inter and Playfair Display are self-hosted in /fonts (latin subset, variable weight files) through styles/fonts.css. Do not reintroduce the fonts.googleapis.com stylesheet; it was the only render-blocking request on the site. New pages copy the three link tags (two preloads and the stylesheet) from any guide.
- Page template: new guides copy a recent guide (for example blog/what-to-do-with-a-loved-ones-phone-when-they-die/index.html): author byline, Person author schema, author box, table of contents, the nine-guide footer block. Titles 60 characters or fewer without the brand suffix, descriptions 155 or fewer.
- Weekly search report: a scheduled task (weekly-search-report, Mondays 9am) reads Search Console and GA4 through Chrome and commits docs/search-weekly/YYYY-MM-DD.md. Read-only.
- IndexNow key de5dc8cb835ef06767fd2092aa8c0523 is served at the site root; submit changed URLs with a POST to https://api.indexnow.org/indexnow (see the sitemap for the URL list).
- Traffic tab (added 4 Oct 2026): the admin desk's Traffic tab shows visits, page views, guide views and cases started for the last 7, 28 or 90 days, with a chart per day and tables of pages, sources, countries and clicks. It reads `/api/admin/stats?view=traffic&days=N`, built by `getTrafficReport()` in api/_lib/store.js from `analytics_events`, so it counts every visitor whether or not they accepted the analytics cookie. Days are London days. The operator's browser and known crawlers are left out. A visit is a session whose source is not `internal`, because a visitor without consent gets a new session id on every page. `/api/analytics` adds `country` (Vercel's `x-vercel-ip-country` header) and `isBot` (a user agent match) to each event; neither the IP address nor the user agent is stored, and events before 4 Oct 2026 have no country.
- Printable checklists: /blog/downloads/digital-accounts-checklist-uk.pdf is rendered from docs/print/checklist-a4.html and /blog/downloads/digital-accounts-checklist.pdf (international edition, added 5 Oct 2026) from docs/print/checklist-a4-international.html. To re-render one after an edit, run Chrome headless from the repo root: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-pdf-header-footer --allow-file-access-from-files --print-to-pdf=blog/downloads/<name>.pdf "file://$PWD/docs/print/<source>.html"`. The international source loads the fonts from /fonts by relative path, so it prints offline.
- Guide hub sections (since 5 Oct 2026): start, stuck, platforms, paperwork (worldwide guides), uk, us, stories. A guide with a UK and a worldwide version carries hreflang links on both pages (en-GB to the UK page, en and x-default to the worldwide one). Google dropped the UK Google guide from its index on 1 Oct 2026 as "Crawled, currently not indexed", most likely for being too close to the worldwide one, so a new worldwide version has to be a different document (law, documents and brand names by country), not a copy with the UK removed.
- Search Console ownership: the property https://www.departed.digital/ is verified by the file google17b40865f5f9479d.html in the site root (added 4 Oct 2026). Do not delete or rename it. Before that the property was verified through the Analytics tag in the homepage HTML; the tag moved behind the cookie banner on 3 Sep 2026, Google could no longer find it, and the verification lapsed between 28 and 30 Sep 2026, which is why the weekly report could not read Search Console that week.
