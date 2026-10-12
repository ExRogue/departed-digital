# Paid search test: does anyone pay when they find us?

Written 12 October 2026. Status: proposal, waiting for Steven's approval. Nothing has been set up or spent.

## Why

Search is showing the site about 50 times a day and six guides sit on page one, but the phrases are rare and in 28 days (5 September to 2 October) nobody who arrived from Google started a case. The organic route to a lead is slow because the volume is small, not because the pages rank badly. A short paid test answers the only question that matters before more time goes into search: when someone who is stuck finds the offer, does anyone pay? It also puts the stuck pages in front of US, Canadian and Australian searchers, who already make up nearly half of our appearances (United States 267 and Canada 64 of 737, at position 12 to 13, better than the UK at 27).

## Shape

- Google Ads, Search only, no Display or Search Partners, no broad match.
- Budget £10 a day for 21 days, capped at £210. Expected cost per click in this niche is roughly £0.80 to £2, so 100 to 250 visits.
- Countries: United Kingdom, United States, Canada, Australia, New Zealand, Ireland. English only.
- Three ad groups, each landing on the page written for that moment, with the account pre-selected on /start.

| Ad group | Keywords (phrase match unless marked exact) | Landing page |
|---|---|---|
| Meta stuck | [facebook memorialization request not working], [facebook memorialisation request not working], facebook memorialize account not working, how long does facebook take to memorialize an account, facebook memorialization request pending, instagram deceased account removal form, instagram memorialization request, instagram remembering request not working | /blog/facebook-memorialisation-request-not-working and /blog/instagram-deceased-account-request-not-working |
| Apple and Google locked | deceased apple id unlock, icloud access after death, unlock iphone deceased relative, apple id court order deceased, access deceased gmail account, google account deceased court order | /blog/apple-account-deceased-no-legacy-contact and /blog/access-deceased-gmail-google-account |
| Someone to do it | close deceased online accounts service, close social media accounts after death service, digital legacy service, help closing deceased accounts, someone to close accounts after death | /digital-legacy-service |

Negative keywords: free, job, jobs, salary, my own, set up legacy contact, how to set up, memorialize my account, template, reddit, mumsnet, lawyer near me.

## Ads (responsive search ads, headlines 30 characters or fewer, descriptions 90 or fewer)

Meta stuck. Headlines: "Facebook Request Stuck?", "No Reply From Meta for Weeks?", "We Take It Over From £149", "Fixed Fee, Nothing Hourly", "Email Us What Meta Sent", "Memorialise or Remove It", "UK Based, Families Worldwide". Descriptions: "You sent the form and nothing came back. We deal with Meta for you, from £149 fixed." and "Not sure what their reply means? Email it to us and we will tell you, free, no obligation."

Apple and Google locked. Headlines: "Apple Wants a Court Order?", "Deceased Apple ID Locked?", "Deceased Gmail Account Locked?", "We Tell You the Real Options", "From £149, Fixed Fee", "UK Based, Families Worldwide". Descriptions: "Apple or Google has asked for a court order. We explain what is possible and handle it for you." and "Send us what they said and we will tell you what it means, free, no obligation."

Someone to do it. Headlines: "Close Their Accounts For You", "Digital Legacy Service", "One Fixed Fee, Every Account", "Facebook, Apple, Google, More", "Done For Grieving Families", "UK Based, Families Worldwide". Descriptions: "We close or memorialise a loved one's online accounts for you. One fixed fee, no hourly bill." and "Tell us the accounts, send the paperwork once, and we deal with every platform."

## Measurement

No Google tag can run without the cookie banner being accepted, so Google Ads will not see conversions. We measure on our side instead: every ad link carries utm_source=google, utm_medium=cpc, utm_campaign=stuck-test and utm_content set to the ad group. scripts/site-analytics.js already stores these on every visit and on the case record, so the admin Traffic tab and the cases list show exactly which paid visits read on, clicked the hand-over, emailed, or started a case.

## Success and stop rules

- One case started, or two serious email enquiries, from the first £210: run a second month and widen the keyword list.
- Clicks but no hand-over clicks at all: the offer is the problem, not the traffic. Fix the pages before spending more.
- 150 or more clicks and no enquiry: stop. The search channel has been tested and answered, and the time goes to partners.

## Who does what

- Steven: create the Google Ads account at ads.google.com, add billing, set the £210 cap, and either paste in the groups above or give Claude access to build them. Claude cannot enter payment details.
- Claude: build or check the campaign, add the UTM links, read the results each Monday in the weekly search report, and write the decision at the end of week three.

Optional: import the same campaign into Microsoft Ads for Bing, which is usually a quarter of the cost per click but a tenth of the volume.
