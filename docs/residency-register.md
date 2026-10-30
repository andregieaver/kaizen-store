# Data residency register

Every service that stores or processes store data is listed here **before** it
touches production data, with where the data lives and whether a data
processing agreement (DPA) is in place. Policy: decision D10 in
[`decisions.md`](decisions.md).

Status: ✅ in place · ⏳ to do · ❓ unverified

## In use

Checked against the code and production's settings on 30 October 2026 (consolidation 6). "Binding by its terms" means the vendor's own DPA
page says it takes effect when the customer enters the service agreement, with no separate signature; the page was read on that date.

| Service | Purpose | Data | Region | DPA | Notes |
|---|---|---|---|---|---|
| Supabase | Database, auth (sign-in links, two-step), storage (pictures, documents, files), Realtime pings | All commerce data, including customer personal data | EU: `eu-west-1` (Ireland) | ✅ Binding by its terms: "This DPA is effective as of the Effective Date of the Agreement"; accepting the agreement counts as signing the SCCs (https://supabase.com/legal/dpa, read 2026-10-30) | Project "Kaizen Store". |
| Vercel | Hosting, functions, log drain to `/api/usage/drain` | Request data, logs; personal data passes through functions | Functions: `dub1` (Dublin). CDN and routing: global | ✅ Binding by its terms: "This Addendum shall become legally binding upon Customer entering into the Agreement" (https://vercel.com/legal/dpa, last updated 17 March 2026, read 2026-10-30) | The proxy runs worldwide, so it must never read personal data. The CDN caches public pages only. |
| Resend | Emails out (orders, sign-in, support answers, marketing) and in (`email.received` for support, D332) | Names, email addresses, order details, customers' emails to support | Sending from the domain's region: EU `eu-west-1` (Ireland). Account data and logs: US | ✅ Binding by its terms: "This Addendum shall become legally binding upon Customer entering into the Agreement" (https://resend.com/legal/dpa, version 2025-12-31, read 2026-10-30) | Copies of every email are also kept in the database (`email_messages`). |
| OpenAI (direct, `api.openai.com`) | Kaizena Flow's own AI as set at Platform → AI (production, 30 October 2026): text `gpt-4.1-mini`, embeddings `text-embedding-3-small`, pictures seen `gpt-5-mini`, pictures made `gpt-image-1.5`, live voice `gpt-live-1` | Product texts, page words, shoppers' chat and searches, support conversations (AI first), the AI manager's conversations: can hold personal data | ⚠️ US. EU data residency needs an EU-residency project key at `eu.api.openai.com` (the "OpenAI (EU data residency)" provider) | ❓ OpenAI's DPA page refused the fetch on 2026-10-30 (HTTP 403): how it takes effect is not verified here | D10 prefers the EU: the switch is an EU-residency project and its key at Platform → AI, the owner's (a key is never made by code). Changing the embedding model embeds products again. A store's own AI connection replaces this one for that store. |
| Brave Search API | The AI manager's web research (D329), platform key | The search words the AI manager sends; it is told to search for products, prices and suppliers, never a person | Brave's own infrastructure (region not stated) | ❓ No DPA on its API page; it states "Zero Data Retention" ("Your queries never leave Brave", https://brave.com/search/api/, read 2026-10-30) | Each search is recorded as `ai_usage` of kind `search`; pages read through `safeFetch()` only. |
| Stripe | Payments (Connect: each store's own account), Kaizena Flow's plan billing and theme invoices | Payment and billing data, buyers' names and emails on payments | EU entity (Stripe Payments Europe, Ireland); some processing in the US | Stripe is each store's own processor under the store's Stripe agreement (the platform DPA says so); for Kaizena Flow's own billing, Stripe's services agreement | Card data never reaches our servers (`docs/pci.md`). |
| Google | Sign in with Google for customers (D375, Kaizena Flow's own OAuth client) and Web Push to staff devices (FCM endpoints, D361) | Sign-in: Google learns that its user signs in to a store; we keep nothing of the Google account. Push: a title and a link, never a customer's data | Google's global infrastructure | Not a processor of store data for push (no personal data sent); for sign-in Google acts for its own user, under Google's terms | Endpoints are constants (`src/lib/google-sign-in.ts`, `isPushEndpoint()`). |
| Public authorities and open registers | VIES (VAT numbers, D157), the ECB's reference rates (D161), Brønnøysundregistrene (D124), Lovdata, Riksdagen, Retsinformation and EUR-Lex/Cellar (legal sources, D311) | VIES: a business's VAT number; the others: nothing of ours (fixed queries or none) | EU, Norway, Sweden, Denmark | Not needed: public services, no personal data of ours sent beyond a business identifier to VIES | Each reached only at its fixed host. |
| Google Fonts (`fonts.gstatic.com`) | Font files downloaded once on the server and self-hosted (D59) | None: no visitor ever loads from Google | — | Not needed | Visitors load fonts from our own origin only. |
| GitHub | Source code and CI | Code only, no customer data | US | Not needed while no personal data is stored | Never commit secrets or production data. Test data is synthetic. |
| A store's own connections | The store's own AI provider, carriers (Bring, PostNord, Porterbuddy, Helthjem), Mollie, Slack, ad platforms, webhook and workflow endpoints | What the owner chooses to send | The provider's | The store's own agreement with each (the platform DPA, section 6, says these are not Kaizena Flow's sub-processors) | Kaizena Flow calls only their fixed hosts, or an owner's https address through `safeFetch()`. |

Not in use on production: the Vercel AI Gateway and Mistral (options at Platform → AI, kept as the route to EU-pinned text models).

## Planned

| Service | Purpose | Data | Region | DPA | Phase | Notes |
|---|---|---|---|---|---|---|
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

