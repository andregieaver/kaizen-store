# Data residency register

Every service that stores or processes store data is listed here **before** it
touches production data, with where the data lives and whether a data
processing agreement (DPA) is in place. Policy: decision D10 in
[`decisions.md`](decisions.md).

Status: ✅ in place · ⏳ to do · ❓ unverified

## In use

| Service | Purpose | Data | Region | DPA | Notes |
|---|---|---|---|---|---|
| Supabase | Database, later auth and storage | All commerce data, including customer personal data | EU: `eu-west-1` (Ireland) | ⏳ accept in the dashboard | Project "Kaizen Store". |
| Vercel | Hosting and functions | Request data, logs; personal data passes through functions | Functions: `dub1` (Dublin). CDN and routing middleware: global | ⏳ accept in the dashboard | Middleware runs worldwide, so it must never read personal data. The CDN caches public pages only. |
| GitHub | Source code and CI | Code only, no customer data | US | Not needed while no personal data is stored | Never commit secrets or production data. Test data is synthetic. |

## Planned

| Service | Purpose | Data | Region | DPA | Phase | Notes |
|---|---|---|---|---|---|---|
| Stripe | Payments, Stripe Tax | Payment and billing data | EU entity (Stripe Payments Europe, Ireland); some processing in the US | Part of Stripe's services agreement | 1 | Card data never reaches our servers. |
| Transactional email | Order confirmations, withdrawal acknowledgements | Names, emails, order details | EU-hosted preferred (for example AWS SES in `eu-west-1`) | ⏳ | 1 | Resend keeps account data in the US even with an EU sending region. |
| Sentry | Error tracking | Stack traces; may include personal data | EU (`de.sentry.io`) | ⏳ | 1 | Scrub request bodies and personal data before sending. |
| PostHog | Product analytics | Pseudonymous events | EU (Frankfurt) | ⏳ | 1 | Only after consent where the country requires it. Mask checkout fields in session replay. |
| GrowthBook | Feature flags and experiment analysis | Assignment and exposure events | ❓ self-host or cloud; region to confirm | ⏳ | 1 | Assignment runs in our server code; GrowthBook needs no personal data. |
| Vercel AI Gateway | Model calls for search and the assistant | Shopper questions, possibly personal data | Inference pinned to the EU; request entry is not yet region-pinned | ⏳ | 2–3 | Zero data retention per request; log the resolved region on every call. |
| Langfuse | LLM tracing and evaluation | Prompts and answers | ❓ EU region believed but not verified | ⏳ | 3 | Verify before sending traces. |
