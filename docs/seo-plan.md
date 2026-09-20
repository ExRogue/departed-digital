# SEO plan: everything worth doing before the phone calls start

Written 21 September 2026 from a full audit of the live site, Search Console, Lighthouse and the outreach inbox. Calls and email to funeral directors remain the main lever for cases; this is the list of search work that compounds in the meantime, in the order it pays back.

## Where things stand (21 September 2026)

- **Index:** 26 pages indexed, 7 not (was 6 and 19 on 13 September). 33 indexable pages, all in the sitemap, all with canonicals, no noindex mistakes, robots.txt clean.
- **Search (28 days to 18 Sept):** 336 appearances, 4 clicks, 24 pages appearing, average position 28.6. Page one: TikTok guide (position 8.1, 82 appearances), PayPal guide (9.4). Close: homepage (13.9), LinkedIn (17.7), X (20.9), Apple (26.5). The post guide, one week old, had 62 appearances at position 49. The blog index appears 37 times at position 59.
- **Speed (Lighthouse, mobile):** homepage 84, TikTok guide 88. The only material problem is the Google Fonts stylesheet, which blocks rendering for about two seconds on every page. Largest paint is 3.3 seconds on the homepage; total page weight is small (209 KB).
- **Titles and descriptions:** every guide title is 66 to 108 characters and most descriptions are 160 to 240. Google cuts titles at about 60 and descriptions at about 155, so the cut-off versions are what searchers see.
- **Thin pages:** six UK pages are under 600 words: the checklist (489), what documents (500), delete or memorialise (509), Google UK (546), Instagram UK (585), social media UK (588). The checklist is the one visitors spend longest on (14 minutes in one session).
- **Internal links:** the pages with search appearances but few links pointing at them: post guide (2), Apple stuck page (2), social media UK (2), TikTok (3), X (4), LinkedIn (4), Instagram stuck (5), Facebook stuck (5). Legal pages get 30 links each from the footer; the guides get none from it.
- **Structured data:** Article and BreadcrumbList on every guide, FAQPage on the homepage and cornerstone, Service, WebSite, VideoObject on the homepage. No LocalBusiness, no author, no sameAs links to any profile.
- **Links from other sites:** about 80 outreach emails since 6 September, three human replies, all polite noes with a policy reason (free help only; council links only for their own services; Surrey County Council on 11 September). The batch one chaser went on 16 September. Batch two and three chasers (due 18 and 19 September) have not been sent. Search Console's links report still shows no data.
- **AI search:** two sessions arrived from ChatGPT in the week to 19 September. llms.txt is in place. Bing Webmaster Tools is not set up, which is where Copilot and ChatGPT search read from.
- **Competitors on content:** AfterLoss (afterloss.uk) has a broad "what to do when someone dies" library including digital legacy, social media and post redirection guides. Our advantage is depth per platform and the troubleshooting pages; theirs is breadth and, probably, links.

## Tier 1: fix what is holding existing pages back (this week)

1. **Titles and descriptions on all 33 indexable pages.** Cut every title to 60 characters or fewer with the search phrase first, and every description to 155 or fewer written as the answer. H1s, URLs and schema stay exactly as they are. Biggest effect on the pages already on page one or two: TikTok, PayPal, homepage, LinkedIn, X, Apple. *Needs a decision, because titles were previously to be left alone.*
2. **Self-host the two fonts.** Four woff2 files served from our own domain with `font-display: swap` and a preload, removing the render-blocking stylesheet. Lighthouse estimates about two seconds off the first paint on every page. One change to a shared stylesheet plus each page's head.
3. **A guides column in the footer.** Every page currently links to Cookies, Privacy and Terms; none links to a guide. A footer column of the eight guides that matter most (complete guide, checklist, Facebook, Instagram, Apple, Google, TikTok, "request not working") gives each of them 30 or more internal links overnight. Same footer on every page, so it is one template change per page type.
4. **Turn /blog into a real hub.** It appears 37 times a month at position 59 with the title "Resources". Give it a title and H1 that say what it is ("Free guides to closing online accounts after a death"), 150 words of introduction, and group the cards by need: if you are stuck, by platform, UK admin, getting ahead of it. Cross-link the three stuck pages from the top.
5. **Expand the six thin UK pages to 900 to 1,200 words**, starting with the checklist, which becomes a proper printable checklist with a one-page PDF download, then the documents guide. These already rank for something and are already linked; they are the cheapest pages on the site to improve.
6. **Send the batch two and three chasers.** About 60 emails, one polite line each, replying in the original thread. Cheap, and the only remaining value in those batches.
7. **Author and organisation signals.** An author box on every guide naming Steven Kong with a two-line bio and a link to /about, and `author` as a Person in the Article schema pointing at /about. Organisation schema gains `sameAs` once there is a LinkedIn company page to point at. A LocalBusiness block on the homepage with the Maida Vale address that is already printed on the family card. *Needs a decision on the address.*

## Tier 2: new pages with confirmed demand (weeks two and three)

Each of these was checked against Google UK autocomplete on 21 September. Nothing is written for a phrase nobody types.

8. **Phone and broadband contracts after a death: every UK provider's bereavement team.** EE, O2, Vodafone, Three, Sky, BT, Virgin Media, giffgaff, Tesco Mobile, iD, TalkTalk, Plusnet. Autocomplete shows "ee bereavement team", "o2 bereavement number", "vodafone bereavement form", "sky bereavement team", "bt bereavement address" and the same for the rest, plus "what happens to a phone contract when someone dies uk". One long page with a section and anchor per provider, the documents each one asks for, what happens to the handset, and the ombudsman route from the forum answer we already wrote. The "seven phone contracts" story links to it.
9. **What to do with a loved one's phone when they die.** Autocomplete confirms "what to do with someone's phone when they die". Do not wipe it, keep the SIM live for security codes, where the photos really are, Legacy Contact and Google's equivalent, when to hand it to us. The hub for every device question, linking Apple, Google, WhatsApp and the Apple stuck page.
10. **What is a digital legacy, and how to plan one (UK).** "Digital legacy", "digital legacy planning" and "digital legacy services" are all suggested. We have no page for the category term itself. This is also the page most likely to be quoted by ChatGPT and Copilot for the general question.
11. **A service page that is not a blog:** /digital-legacy-service, for "digital legacy services" and for anyone searching for someone to do this. The homepage stays the family-facing front door; this page is the one that describes the service for search and for AI answers, with the packages, the process, the London base and the partner route.
12. **Two more stuck pages** once the first three show appearances: Google and Gmail ("google account recovery after death" and "gmail account access after death" are both suggested), and WhatsApp. Same template.
13. **Smaller, later:** Google Photos after a death as a section of the Google guide (suggested phrase), eBay and Steam accounts (both suggested, both small), an executor's checklist for digital assets (no autocomplete volume, so it waits).

## Tier 3: links, the slow lever (ongoing)

The council and charity route has produced three polite refusals from about 80 emails, each with a policy reason. It was worth trying and it is not worth scaling. The routes below are.

14. **Partner links from funeral directors.** When a firm says yes on the phone, the aftercare page link is part of the ask: "would you add us to your bereavement support page alongside Cruse?" One funeral director link is worth more than every council reply so far. This is the reason the calls matter for SEO as well as for cases.
15. **A data piece journalists can cite.** "Which apps and platforms let you plan for your own death?" A checked comparison of 25 services (Legacy Contact, Inactive Account Manager, delete-after-death settings, what each needs from the family, average handling), published as a page with a table and a summary. Consumer and money journalists write about this every few months and currently cite the platforms or US sites. Pitched through #journorequest on X and a free Qwoted profile, with the founder available for comment. One national link changes the site's authority more than anything else on this list.
16. **Directory listings that carry weight in this sector:** AtaLoss's signposting directory, the Digital Legacy Association's resources, Google Business Profile (verification is with Steven), Bing Places, and the ordinary UK citations (Yell, Thomson Local, 192). Slow, dull, and the baseline every local competitor has.
17. **Forum answers.** The twelve drafted replies in docs/forum-answers.md, updated so the Facebook ones link the stuck page. Posted by Steven, one or two a week. Mumsnet allows a useful link with disclosure; Reddit and MSE get the answer without one.
18. **Guest pieces for hospices and charities.** The same organisations that will not add a link will often run a short, practical article in a newsletter or blog if it is written for them. Offer the phone-contracts piece and the "what to do with the phone" piece as ready-to-run articles with one link back.

## Tier 4: AI search and measurement

19. **Bing Webmaster Tools** (Steven, two minutes, import from Search Console). Bing's index feeds Copilot and ChatGPT search, and ChatGPT has already sent visitors.
20. **Google Business Profile verification** (Steven). Needed for the map result on "digital legacy service london" and for reviews later.
21. **A weekly search report.** A scheduled task each Monday that reads Search Console and Analytics and writes a short summary: appearances, clicks, positions for the target phrases, which pages moved, which stuck-page offers were clicked. Replaces asking.
22. **Watch list for the target phrases** in Search Console: the three stuck-page clusters, "redirect post", the TikTok and PayPal phrases, and the phone-contract phrases once that page exists.

## Order of work

| Week | Work | Who |
|---|---|---|
| 1 | Tier 1 items 2 to 6 (fonts, footer, blog hub, checklist and documents expansions, chasers). Item 1 and item 7 once decided. | Claude, with two decisions from Steven |
| 2 | Phone contracts hub, phone-what-to-do page, digital legacy hub. Remaining thin UK pages. | Claude |
| 3 | Data piece and pitch list, service page, directory submissions drafted, guest pieces drafted. | Claude drafts, Steven submits where an account in his name is needed |
| 4 | Read the results. Rewrite titles on anything new to page one. Google and WhatsApp stuck pages if the first three are appearing. | Claude |
| Ongoing | Forum replies, Bing, Google Business Profile, partner links from every funeral director yes. | Steven |

## What good looks like

- Six weeks: every page under 60/155 in search results, first paint under two seconds on mobile, all 33 pages indexed, the checklist and documents pages over 900 words.
- Eight weeks: at least one of the stuck pages and the phone-contracts page on page two or better, appearances over 1,000 a month, clicks in double figures.
- Twelve weeks: two or more links from funeral director aftercare pages, one link from a national publication or a sector body, the first case whose landing page was a guide.

## What we will not do

- Buy links, exchange links, or use link networks.
- Publish location pages for towns we do not serve differently.
- Publish anything that has not been checked against the platform's own page that week.
- Change H1s, URLs or schema on pages that are already ranking.

## Decisions needed from Steven

1. Titles and descriptions: rewrite them to fit (keeping every H1, URL and keyword), or leave them.
2. Address: put the Maida Vale, London address in the homepage's LocalBusiness data, as it already is on the printed card, or leave it off.
3. Bing Webmaster Tools and Google Business Profile: both need his own sign-in.
