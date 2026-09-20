# Content plan: the "it isn't working" pages

Written 20 September 2026. Purpose: the first pages on the site written for people who have already tried to close or memorialise an account and got stuck, because those are the people most likely to pay. The 22 existing guides are written for people who want to do it themselves; 336 search appearances in the last 28 days have produced no cases.

## 1. The three pages

| Page | Address | The searches it is built for (all confirmed in Google UK autocomplete on 20 Sept 2026) |
|---|---|---|
| Facebook | `/blog/facebook-memorialisation-request-not-working` | "facebook memorialization request not working", "facebook memorialization request form not working", "facebook memorialize account not working", "how long does facebook take to memorialize an account", "facebook memorialized account appeal" |
| Instagram | `/blog/instagram-deceased-account-request-not-working` | "instagram deceased account removal form", "instagram deceased account removal request", "instagram memorialization request form", "instagram remembering request" |
| Apple | `/blog/apple-account-deceased-no-legacy-contact` | "deceased apple id unlock", "icloud access after death", "how do i access a deceased person's icloud", "how to get a court order for apple id uk", "unlock iphone deceased relative" |

Facebook first: it has the most searches and the most failure modes. Instagram second, because it shares Meta's forms and can link across. Apple third, because its stuck moment is different (Apple says "court order" and the family stops) and the page needs the most care.

After these three, in order: an executor page (`/blog/digital-assets-executor-uk`, for "digital assets probate uk" and "executor online accounts"), then a service page that is not a blog, for people searching for someone to do it.

## 2. Why these can rank

- Every target phrase is a real autocomplete suggestion, so the demand exists at the exact wording.
- Nobody serves it. For "facebook memorialization request not working" the results are a JustAnswer thread, Meta's own help page (which has no troubleshooting), Tom's Guide, and for "how long does facebook take to memorialize" a spam page on a Nigerian government staging domain. The best competitor, elayne.com, is 2,400 words with no troubleshooting section at all. For Apple in the UK the results are solicitors' blogs written for the legal route, not for a family at the kitchen table.
- Our own evidence: the post guide ranked for 62 appearances within a week of publishing because it answered a specific question. TikTok (position 7.8) and PayPal (9.4) show the domain can reach page one for platform questions.

## 3. The page template

Every stuck page follows the same shape. The shape is the product.

1. **Title in the searcher's words.** H1 as the question they typed. Meta description promises a diagnosis, not a lecture.
2. **Two sentences of recognition,** then a callout with the short answer: the three most common causes and the one thing to do today.
3. **"Which of these is happening?"** A list of symptoms, each a jump link. This is the part no competitor has. The reader finds their exact situation in ten seconds.
4. **One section per symptom:** what it means, why the platform does it, the exact fix, how long to wait, what to send next. Step boxes for anything with more than two steps.
5. **Honest timelines.** Meta publishes no timescale. Say so, and say what families report (days to a few weeks, resubmit at 14 days) with the source ("families on Mumsnet and Reddit report").
6. **The hand-over moment.** A callout placed exactly where the reader realises they are stuck (after "no response after two resubmissions", after "Apple has asked for a court order"), not only at the end. Two offers side by side:
   - Start a case, from £149, with the account pre-selected: `/start?package=essential&accounts=facebook`.
   - Free: "Email us what Meta sent you and we will tell you what it means", a mailto with a prefilled subject. Lower friction, builds trust, and every reply is a lead.
7. **Proof without invention.** Link to the matching story on `/stories` (`#form` for Facebook, `#instagram`, `#phone` for Apple). Do not claim case numbers or experience we do not have.
8. **Both-way links** with the existing how-to guide, the documents guide and the checklist. The stuck page never repeats the how-to; it starts where the how-to ends.
9. Standard article template: Article and BreadcrumbList JSON-LD, Open Graph, en_GB, no em dashes, no contractions, 1,600 to 2,200 words.

## 4. The symptoms each page must cover

**Facebook**
- The form will not submit or says it cannot find the account (usually a typed name instead of the profile URL; use a desktop browser; use the memorialisation form, not the profile report button).
- No reply for weeks (resubmit at 14 days with the same documents; a second family member can submit too; Meta accepts duplicates).
- Documents rejected or "we could not verify" (name chain problems: married names, executors; add the linking document; removal needs immediate family or executor proof, memorialisation only needs proof of death).
- Wrong form: memorialisation form versus the special request form (removal, or when the profile cannot be found).
- The account is posting or messaging people (compromised; report at facebook.com/hacked as well; warn relatives about scam messages).
- Account disabled or suspended after death (appeal from the login screen; the 180 day deletion clock; Oversight Board for refused appeals; memorialise as soon as it is restored).
- Memorialised by mistake while the person is alive (Meta's appeal form; short section, not our customer but a real search).
- Legacy contact confusion (a legacy contact can manage a memorialised profile but cannot delete it; Meta only honours the person's own setting).

**Instagram**
- "Invalid username" or profile not found (the handle without the @ and without the URL; the Reddit thread from May 2026).
- Silence (same resubmission rule; Meta processes Instagram and Facebook separately even when linked).
- Removal refused for lack of proof (Instagram's own list: birth certificate, death certificate, proof of authority under local law).
- Suspended after death (the 180 day clock, appeal from the login flow, Oversight Board).
- Impersonation and copycat accounts (report as impersonation, which moves faster and needs no estate documents).
- "Remembering" appeared but posts changed or comments cannot be removed (memorialised profiles without a legacy contact cannot be changed; report individual posts).

**Apple**
- No Legacy Contact, Apple mentions a court order (what Apple's page actually says as of 24 August 2026: a court order in the US, Israel and "certain other locales"; alternative documents in France, Germany, Japan, Australia and New Zealand; the UK is not on the alternative list; only one person may request; some data is end to end encrypted and Apple cannot decrypt it).
- A grant of probate was refused (UK solicitors report Apple does not accept a grant of probate alone; the order must name Apple and the data; this is a solicitor job, and the page says so plainly).
- What you can do without a court order: close the account through the Digital Legacy site with a death certificate; remove Activation Lock with proof of purchase; find the photos elsewhere (a family member's shared album, the phone if unlocked, the Mac).
- A Legacy Contact was set up but the access key is lost (where the key lives on the contact's own devices).
- The phone is locked and nobody knows the passcode (Apple cannot remove it without erasing; the guide already covers this; link).
- Deciding whether the court route is worth it (what is actually in iCloud versus on the device).

## 5. Facts to verify again the day each page is written

- Meta's 180 day deletion window for disabled accounts and the appeal route (help.instagram.com, "My Instagram account has been deactivated").
- Oversight Board eligibility for account disablement appeals.
- The current field list on both Meta forms (checked 20 Sept 2026: memorialisation form asks for profile URL, date of death, documentation and email; the special request form asks for your name, email, the person's name, profile URL, the account's email, and the request type, and says it requires verification of immediate family or executor for removal).
- Apple support 102431 wording (last updated 24 August 2026 at time of research).
- Instagram removal proof list (checked 20 Sept 2026).

Every platform claim carries "as of September 2026" where it could change.

## 6. What not to say

- No case counts, no "we do this every week", no client quotes. There are no cases yet.
- No "guaranteed" or "we will get it done". We submit correctly, resubmit on schedule, escalate, and keep the record.
- No legal advice on the Apple court route beyond "this needs a solicitor, here is what the order has to contain according to Apple".
- No em dashes, no contractions, no exclamation marks.

## 7. Site changes that go with the pages

- `/start`: accept `?accounts=facebook,instagram,apple` and pre-tick those platforms, so the hand-over link lands on a half completed form.
- Each existing platform guide's "problems" section gets one line linking to its stuck page (both Facebook guides, the Instagram guide, the Apple guide).
- Stories page: the three matching stories link to the stuck pages under "What would have helped".
- Sitemap, llms.txt, blog index cards (kicker "If you are stuck"), IndexNow, Search Console indexing requests.
- Tracking labels: `stuck_cta_<platform>` for the start link, `stuck_email_<platform>` for the free offer, so the admin analytics and GA4 show which page produced the click. Landing page attribution already exists in the first party analytics.
- Homepage: after two weeks of data, consider replacing the email card in the guides band with "Already tried and stuck?" linking to the Facebook page. Decide on data, not now.

## 8. Order of work and timing

1. Write and publish all three pages together, with the cross links, in one pull request. Estimated three to four hours including verification of the facts in section 5.
2. Same day: `/start` pre-selection, guide links, stories links, sitemap, llms.txt, IndexNow, Search Console requests.
3. Within a week (Steven): post the drafted forum replies for Mumsnet threads 1 and 3 in `docs/forum-answers.md`, updated to link the Facebook stuck page. Mumsnet allows a useful link with disclosure. The Reddit threads (35, 37) get the answer without a link.
4. Two weeks after publishing: check Search Console for the target phrases. If a page is not indexed, request again.
5. Four to six weeks: if any page reaches page one, rewrite its title and description for clicks. Then write the executor page and the service page.

## 9. How we will know it worked

- Indexed within seven days (Search Console).
- Appearances for the "not working" phrases within two to four weeks.
- At least one target phrase on page one within eight weeks.
- Clicks recorded as `stuck_cta_*` or `stuck_email_*`, and the first case whose landing page is one of these.
- Leading indicator: replies to the free "tell us what it means" offer, even when they do not buy.

## 10. Risks

- Meta changes its forms: every page is dated and the facts in section 5 are re-checked quarterly.
- Overlap with the existing guides: different intent, different titles, cross linked, and the stuck page never repeats the steps.
- Traffic stays small for weeks: expected, and the funeral director calls remain the fast route to a first case.
