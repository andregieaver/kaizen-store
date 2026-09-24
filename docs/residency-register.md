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
| GitHub | Source code and CI | Code only, no customer data | US | Not needed while no personal data is stored | Never commit secrets or production data. Test data is synthetic. |

## Planned

| Service | Purpose | Data | Region | DPA | Phase | Notes |
|---|---|---|---|---|---|---|
| Stripe | Payments (Stripe Connect: each store has its own Stripe account), Stripe Tax later | Payment and billing data | EU entity (Stripe Payments Europe, Ireland); some processing in the US | Part of Stripe's services agreement | 1 | Card data never reaches our servers. |
| Vercel AI Gateway | Model calls for search and the assistant | Shopper questions, possibly personal data | Inference pinned to the EU; request entry is not yet region-pinned | ⏳ | 2–3 | Zero data retention per request; log the resolved region on every call. |
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

