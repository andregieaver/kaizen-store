# Data residency register

Every service that stores or processes store data is listed here **before** it
touches production data, with where the data lives and whether a data
processing agreement (DPA) is in place. Policy: decision D10 in
[`decisions.md`](decisions.md).

Status: ✅ in place · ⏳ to do · ❓ unverified

## In use

| Service | Purpose | Data | Region | DPA | Notes |
|---|---|---|---|---|---|
| Supabase | Database, auth (sign-in links) and storage (product pictures) | All commerce data, including customer personal data | EU: `eu-west-1` (Ireland) | ⏳ accept in the dashboard | Project "Kaizen Store". |
| Vercel | Hosting and functions | Request data, logs; personal data passes through functions | Functions: `dub1` (Dublin). CDN and routing middleware: global | ⏳ accept in the dashboard | Middleware runs worldwide, so it must never read personal data. The CDN caches public pages only. |
| Resend | Emails to shoppers: order confirmations, shipping, refunds, sign-in and password codes, welcome, subscription reminders (D26, D32) | Names, email addresses, order details | Sending from the domain's region: EU `eu-west-1` (Ireland), chosen when the domain is added. Account data and logs: US | ⏳ accept Resend's DPA (standard contractual clauses) in the dashboard | Chosen by the owner (D32). Copies of every email are also kept in the database (`email_messages`). Until `RESEND_API_KEY` and `EMAIL_FROM` are set, emails are only recorded, not sent. |
| Vercel AI Gateway | Kaizen's AI (D73): search by meaning, understanding searches and product texts (Phase 2) | Product texts; shoppers' searches, which can hold personal data | Text models: pinned to the EU per request (`inferenceRegion`), failing rather than running elsewhere. Embedding models: no model can be pinned yet (September 2026). Request entry is not yet region-pinned | ⏳ Vercel's DPA covers it | Chosen and changed at Platform → AI, with no deploy. Zero data retention on every request (`zeroDataRetention`); the admin's Test shows where a request ran. |
| OpenAI (direct) | Kaizen's AI as chosen at Platform → AI on 2026-09-27: `text-embedding-3-small` for search by meaning, `gpt-4.1-mini` (from gpt-5-mini the same day: 24 of 25 in the eval, about four times quicker) for understanding searches and suggesting product texts | Product texts; shoppers' searches, which can hold personal data | ⚠️ `api.openai.com` processes in the US. OpenAI keeps data in the EU only for a project created with European data residency, used through `eu.api.openai.com` (the "OpenAI (EU data residency)" provider) | ⏳ OpenAI's DPA (standard contractual clauses) | D10 prefers the EU where a comparable option exists: switch to the EU provider with an EU-residency project key, or to the gateway or Mistral. Changing the search model embeds products again. A key from an ordinary project is refused at `eu.api.openai.com` (tried 2026-09-27), so Kaizen stays on `api.openai.com` until there is an EU project key. |
| Mistral AI (through the gateway) | Planned search model: `mistral/mistral-embed` | Product texts and shoppers' searches | Mistral's servers are in the EU; the gateway cannot pin the region, and Mistral's sub-processors may occasionally be outside it | Through Vercel's agreement; zero retention and no training | Chosen because no gateway embedding model offers EU pinning yet; revisit when one does. |
| A store's own AI provider | Replaces Kaizen's for that store (D73) | That store's product texts and shoppers' searches | The provider the owner chooses | The store's own agreement with the provider | The store is responsible for it; Kaizen says so on the page, asks for a DPA and an EU provider, and only calls public https addresses. |
| Brønnøysundregistrene (Enhetsregisteret, `data.brreg.no`) | Filling in a Work client from the Norwegian company register (D124) | Only a nine-digit organisation number or the words typed to search a company name go out; nothing about the client or the store. What comes back is public register data | Norway (a Norwegian public authority, EEA), open data under the NLOD licence | Not needed: an open public API, no key, no personal data of ours sent | Company names of sole proprietorships are people's names, but they come from the public register. Fixed host `data.brreg.no`; a lookup is cached for a day. |
| GitHub | Source code and CI | Code only, no customer data | US | Not needed while no personal data is stored | Never commit secrets or production data. Test data is synthetic. |

## Planned

| Service | Purpose | Data | Region | DPA | Phase | Notes |
|---|---|---|---|---|---|---|
| Stripe | Payments (Stripe Connect: each store has its own Stripe account), Stripe Tax later | Payment and billing data | EU entity (Stripe Payments Europe, Ireland); some processing in the US | Part of Stripe's services agreement | 1 | Card data never reaches our servers. |
| Langfuse | LLM tracing and evaluation | Prompts and answers | ❓ EU region believed but not verified | ⏳ | 3 | Verify before sending traces. |

## Optional, not planned

Decision D13 in [`decisions.md`](decisions.md): Vercel's built-in logs, Speed
Insights and cookieless Web Analytics cover launch. These are the add-ons to
reach for if that stops being enough; each goes in the table above first.

| Service | Purpose | Region to choose | Notes |
|---|---|---|---|
| Sentry | Error tracking with alerts | EU (`de.sentry.io`), fixed at sign-up | Scrub request bodies and personal data. |
| PostHog | Funnels and product analytics | EU (Frankfurt), fixed at sign-up | Needs cookie consent in most setups (see D14). |
| GrowthBook | Experiment analysis | Self-host or cloud; region to confirm | Assignment already runs in our own code. |

