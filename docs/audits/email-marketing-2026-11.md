# Email and SMS flows, and finding business customers (working plan, 17 November 2026; D720)

The owner asked how Kaizena Flow's marketing and email automation compares with ActiveCampaign and Mailchimp, then asked for a
plan that closes the gaps, puts us ahead on how easily a person or the AI sets up flows and writes their words, ties email
into the rest of the system, and adds a legal AI tool for reaching new business customers. The scorecard is the page *Email
Marketing Scorecard* (claude.ai, https://claude.ai/artifact/GAU6y6h6G3Vsp9VMcpfiUb); this file is the working plan. Find a
step's row by id; in the same change set it to Done with the date and the commit (as `CLAUDE.md` asks of every working plan).

## Where we stand

Scores out of 5 are judgement. Ours come from reading the code at `23a841e2` (17 November 2026); Mailchimp's and
ActiveCampaign's from general knowledge of the products, not re-read this week, so read their pages again before any number here
is used on a comparison page (`docs/comparison-pages.md`). *Target* is where this plan takes us.

| Area | Kaizena Flow | Mailchimp | ActiveCampaign | Target | What decides our score |
|---|---|---|---|---|---|
| List and consent | 5 | 3 | 3 | 5 | Consent kept as a record (words, time, source, confirmation), double opt-in, RFC 8058 one-click, bounces and complaints suppress, export and erasure (D295) |
| Ready-made store flows | 4 | 4 | 4 | 5 | Welcome, after a purchase, win-back, cross-sell, restock, browse abandonment, back in stock, cart reminders; up to three emails each, ending when the person orders (D298, D653, D691, D33) |
| Segments | 3 | 4 | 5 | 5 | Orders, spend, dates, RFM, country, language, group, company, account, tag, consent (D296); nothing on products bought, behaviour, email engagement or custom fields |
| Campaign tools | 2 | 5 | 4 | 4 | Block editor per language, store facts as blocks, templates, test, schedule, clicks per button (D297, D352, D368); no split tests, personal fields, revenue per broadcast or columns |
| Flow builder | 1 | 3 | 5 | 5 | A fixed kind with days and words; Workflows (D356) have triggers and conditions but no message to a customer, no wait, no branch |
| Engagement and scoring | 1 | 3 | 5 | 4 | Clicks counted per link with no person; no opens (D297, by choice); so no engagement segments, sunset or score |
| Deliverability | 2 | 4 | 4 | 4 | Every store sends from one Kaizena Flow address with its own name (D26, `src/server/email.ts`); one sender reputation for all stores |
| SMS | 2 | 3 | 3 | 4 | Built on the store's own 46elks account (D565), not yet tried against 46elks itself, no texts in flows |
| Forms and popups | 4 | 4 | 4 | 5 | Forms as records (D705), popups (D121), sign-up codes and tags (D304); no popup report |
| CRM tie-in | 3 | 1 | 4 | 5 | Deals, activities, leads, email on the timeline (D464 to D476); none of it starts or stops an email |
| AI copy from the store's facts | 4 | 3 | 3 | 5 | Write with AI and the AI manager's tools draw products and offers from code and pass `findClaims()` (D352, D318) |
| Ease of setting up a flow | 3 | 4 | 2 | 5 | One switch and words per kind: simple, but a goal that is not one of the kinds cannot be met |
| Ties to the rest of the business | 3 | 2 | 3 | 5 | One database and one timeline, but email events reach no workflow, deal or autopilot path (ecosystem assessment, E3) |
| **Average** | **2.85** | **3.31** | **3.77** | **4.69** | |

Finding new business customers is not on the table above: Mailchimp and ActiveCampaign do not offer it and forbid bought or
scraped lists. Today we have research tools (D329) and a leads inbox (D475), but nothing that finds or contacts a company.

## What "ahead on ease" means

The pass mark for phase 3, tested with timed tasks as `docs/ab-testing-usability.md` did:

1. A new owner has a working flow switched on within 3 minutes of opening Marketing, without reading anything, and every email
   in it already shows the store's own products, languages and voice.
2. A sentence to the AI manager (*bring back customers who have not bought for three months, with 10 % off*) becomes a complete
   flow drawn as a story in plain words; nothing sends until the owner presses *Switch on*.
3. Before anything sends, the owner sees how many people would get each email in the next 30 days, counted from real data, and can
   walk one real customer through the flow.
4. Every flow's report says in one sentence what it brought, and suggests one thing to do.
5. Lisa reaches every setting from the same screen: the canvas, each step's conditions, the words per language, the contact
   policy, the HTML as sent.

ActiveCampaign starts from a blank canvas or a recipe whose emails the owner writes; Mailchimp's journeys start from templates
with empty emails. Our lead is that the store's own data writes the first version and the owner only says yes or changes it.

## Rules for every step

1. **One engine, one word** (owner's decision, M0.1). Email automations (D298, D653, D691), cart reminders (D33) and Workflows
   (D356) become one engine called *Automations*: a trigger, steps and an end, where message steps (email, text) and store actions
   (tag, note, deal, staff email, Slack, request, the AI manager) sit in the same flow. Nothing needs moving: production held 0
   workflows, email automations and broadcasts on 17 November 2026 (the ecosystem assessment). This answers ecosystem step E3.7's
   *automations in one home*.
2. **Built on the nervous system.** The engine reads the event log of ecosystem step E3.1 with a cursor, never tables of its own,
   and writes every email event back to it, so the customer timeline, deals, the autopilot, workflows, analytics and the morning
   briefing all see them. E3.1 comes first.
3. **Consent stays a record** (wave 5 rule 1). Prospects (phase 5) are never on the subscriber list; their lawful basis is a record
   of its own.
4. **Homer and Lisa.** A goal and a story by default; the canvas and every setting one step away (*Customise*).
5. **Grounded AI.** The model writes words; code picks people, products, prices, counts, dates and the segment's rules. Every text
   passes `findClaims()`; sending, spending and publishing wait for the owner's yes. A new or changed tool or prompt gets eval
   cases and a new recording (`src/data/agent-eval-recording.json`).
6. **The platform in the same change.** Kaizena Flow's house store (D467) gets each step: owners nurtured from trial to plan (M4.5)
   and prospecting for new store owners (P5.8, first).
7. **EU only.** No new vendor without processing in the EU; registers are read from the public bodies' own APIs.

## Phase 0: before building

| Id | Step | Size | Status | Notes |
|---|---|---|---|---|
| M0.1 | The owner's four decisions: (a) one engine called Automations; (b) clicks kept per person with consent, still no open pixel; (c) personal fields such as a first name, each with a fallback; (d) prospecting for the platform first, for stores after a legal reading | S | Done, 17 Nov 2026 | The owner said yes to all four. (b) and (c) replace choices D297 made on purpose |
| M0.2 | The parity row `customers.email-marketing-broadcasts-and-lifecycle-automations` no longer says multi-email flows and browse abandonment are missing | S | Done, 17 Nov 2026 | Built by D653 and D691; the rating stays Full |
| M0.3 | Ecosystem steps E3.4, E3.5, E4.4, E4.5 and E4.6 are planned here | S | Done, 17 Nov 2026 | Their rows in `ecosystem-2026-11.md` name the step here that takes each |

## Phase 1: foundations

| Id | Step | Size | Status | Notes |
|---|---|---|---|---|
| M1.1 | A sending domain per store (was E4.4) | M | Done, 17 Nov 2026 (877f3bc6, D727) | Resend's domains API in `eu-west-1`; the records written by our DNS tools for domains we host or registered (D315, Domain Connect), shown as records to copy otherwise; SPF, DKIM, DMARC and the return path checked daily by domain health. The store sends as `news@` its own domain once verified, from the shared address until then. The platform's own domain is the first |
| M1.2 | Email events on the event log, both ways (needs E3.1) | M | Done, 17 Nov 2026 (0da315e0, D732) | `email.sent`, `delivered`, `bounced`, `complained`, `clicked`, `subscriber.joined`, `subscriber.left`, `flow.entered`, `flow.goal`, `flow.finished`; on the customer timeline (D462), as workflow triggers, read by the autopilot |
| M1.3 | Clicks kept per person (M0.1 b) | M | Done, 18 Nov 2026 (D754) | One row per click (subscriber, message, link, time), kept 180 days, in the person's export and erased with them, said in the privacy notice. The counts per link stay. No open pixel: Apple Mail's privacy protection makes opens unreliable anyway |
| M1.4 | Revenue per email by one rule | S | Done, 18 Nov 2026 (D761) | The 7-day count of paid orders (`ORDER_AFTER_DAYS`, `src/lib/automations.ts`) moves to one pure function used by broadcasts, flows, texts and Analytics → Marketing; a broadcast's report shows its orders and revenue |
| M1.5 | One contact policy across email and text (was E3.5) | M | Done, 18 Nov 2026 (D764) | A cap per person per week across broadcasts, flows and texts, spacing, quiet hours in the reader's own time zone, priority (a cart reminder before a broadcast; order emails never counted); a skipped message is `suppressed` with its reason |
| M1.6 | A guard on each store's sending | S | Done, 17 Nov 2026 (2c315c24, D730) | Bounce and complaint rates per store over 7 days; above the line (Google asks bulk senders to stay under 0.1 % spam reports) broadcasts pause and the owner is told why. It protects every store's mail until M1.1 |

## Phase 2: one flow engine

| Id | Step | Size | Status | Notes |
|---|---|---|---|---|
| M2.1 | A flow is a trigger, steps and goals | L | Slices 1-2 of 4 (D767) | `commerce.flows` (a store's, or the platform's with no store) with versions; steps as a tree: email, text, wait, wait until (an event or a time), if/else on who the person is or what they did, split, store actions, goal (ends it early), end. Each person's place is a row moved on from the event log under idempotent keys, as `automation_sends` is today. Saved off; switched on after a test, as workflows are |
| M2.2 | Today's automations as recipes on the engine | M | Part (D767) | Welcome, after a purchase, win-back, cross-sell, restock, browse, back in stock and cart reminders become recipes with their tests carried over; Workflows' events and schedule become triggers and their page the same editor |
| M2.3 | Triggers from the whole system (was E3.4) | M | Part (D767) | Joined the list, a form sent (D705), a tag added or removed, a segment entered or left, an order paid, delivered or refunded, a cart left, a product viewed, back in stock, a subscription renewed or ended, a review, a support conversation ended or rated, a quote asked for, a deal made, moved, won or lost, a lead, a contract signed, a date on the person (birthday, a date field), a schedule, an Admin API event |
| M2.4 | Segments from everything (E3.6's marketing part) | M | Open | Products and categories bought or viewed, email engagement (clicked within N days, never), deal stage, support (an open case, a rating), reviews, customer fields (D118, only those marked for marketing), company size and industry, the lead score; usable by flows, broadcasts, texts, campaigns and discounts |
| M2.5 | Split tests in broadcasts and flows (was E4.5) | L | Open | Subject, words, send time or a branch, judged by D148's engine with unsubscribes and complaints as guardrails; a broadcast's winner goes to the rest |
| M2.6 | Personal fields with a fallback (M0.1 c) | S | Open | First name, company and fields marked for email; a field without a fallback is refused; the preview shows the worst case; `findClaims()` and the checks of M3.6 run on the drawn text |
| M2.7 | Texts in flows | S | Open | After the 46elks account is tried for real (the parity row `customers.sms-marketing`) |
| M2.8 | Engagement and scores | M | Open | A sunset recipe (no click for 180 days: one last email, then paused, never deleted); an engagement level in words; a lead score for business customers from visits, quotes, emails and deals, worked out in code with each point's reason shown |

## Phase 3: ahead on ease (built with phase 2's screens, not after)

| Id | Step | Size | Status | Notes |
|---|---|---|---|---|
| M3.1 | Start from a goal | M | Part (D767) | Marketing's front page asks what the owner wants more of (new subscribers welcomed, carts recovered, second orders, lapsed customers back, reviews, business leads nurtured) and makes the whole flow from its recipe with the store's products, languages and voice (D330); switched off until the owner has looked |
| M3.2 | Say it in a sentence | M | Open | The AI manager's `create_flow` and `change_flow`: a sentence becomes a draft flow (trigger, steps, segment rules, words) drawn as the story; code checks the steps, counts the audience and applies the contact policy; switching on keeps the send gate. Eval cases |
| M3.3 | The story and the canvas | L | Done 19 Nov (D767, 0f13ae02) | Homer sees the flow as sentences with the emails as pictures (*When someone joins, the same day: Welcome. Three days later, if they have not ordered: our best sellers*); *Customise* opens the canvas with branches and conditions. One model, so a change in either shows in both |
| M3.4 | Edit the email where it is | M | Done 2026-11-20: words, blocks, products and offers, widths, dark mode, languages (D767) | The preview is the editor: words changed in place (D191), blocks added between, product and offer blocks from the store's facts; phone and desktop widths, dark mode, languages side by side |
| M3.5 | A dry run | M | Done 2026-11-20: reach, each step's reach, emails drawn, Test (D767) | How many people each step would reach in the next 30 days, from real data; one real customer or a test person walked through, each email drawn with their name, market and products; nothing sends |
| M3.6 | Checks before switching on or sending | S | Done 19 Nov (D767) | In code, each a line with a fix: a picture without alt text or in a format mail apps cannot show, a link to nowhere, a field without a fallback, a claim, an email over Gmail's 102 KB clipping size, an audience without consent, the contact policy cutting most of it |
| M3.7 | Words that write themselves and stay the owner's | M | Done 2026-11-20: write per email, 3 subjects, shorter, warmer, direct, translate, past earnings (D767); split-testing them is M2.5 | Write with AI per step from the store's facts and voice; three subject lines to choose from or split-test; shorter, warmer or more direct; the store's other languages written for review; the AI reads what earlier emails earned before it suggests |
| M3.8 | Reports in words | S | Done 2026-11-20: flow page, Home and briefing (D767) | Each flow says what it brought in 30 days, which step does most, how many left the list, and one suggestion; on Home and in the morning briefing through E2.1's one source |
| M3.9 | The autopilot runs retention | M | Part: the flow guard; goals say whom they would reach (D767) | It proposes the recipes the store lacks from its own data (*40 customers bought twice and stopped*), watches each flow as it watches its other changes (D628), pauses a flow whose unsubscribes or complaints jump, and suggests split tests; within the store's autonomy settings |
| M3.10 | The usability test | S | Open | Five timed tasks against the pass mark above: a first flow on, a broadcast to a segment, a word changed in step 2, what a flow brought, a flow stopped |

## Phase 4: depth

| Id | Step | Size | Status | Notes |
|---|---|---|---|---|
| M4.1 | Email design | M | Open | Columns, social links, saved blocks, spacing and colours from the theme, an HTML block for Lisa (sanitised), complete templates per goal |
| M4.2 | Topics and a preference page | M | Open | The store's own topics; the subscriber picks topics and how often, or pauses for a month; consent per topic kept as a record |
| M4.3 | A popup's own report | S | Open | Views, sign-ups and the rate per popup and form (the parity row's caveat) |
| M4.4 | Send time per person | S | Open | From their own clicks (M1.3) inside quiet hours; else the store's best hour |
| M4.5 | Owners nurtured from trial to plan (was E4.6) | M | Open | The house store's flows on the platform's events: trial started, store published, first order, trial ending, plan paid, store closed |

## Phase 5: finding business customers, lawfully

**Why not an email harvester.** Scraping addresses and mailing them in bulk is unlawful in most of our markets:

- A named work address (`ola.nordmann@firma.no`) is personal data. Collecting it needs a lawful basis and a notice to the person
  within a month or at the first contact (GDPR art. 14). The CNIL fined KASPR €240,000 in December 2024 for contact details
  scraped from LinkedIn, kept too long, with late notices in English only.
- The ePrivacy rules differ by country, and in several of our markets a first marketing email needs consent even between
  businesses: Germany (UWG § 7) for every addressee; Denmark (markedsføringsloven § 10) companies included; Norway
  (markedsføringsloven § 15) for a person's own work address, not for a company's general address (Forbrukertilsynet's guidance).
  Sweden (marknadsföringslagen 19 §) and France (CPCE L34-5, the CNIL) allow it to a company's general address, or about the
  recipient's own work, with a way to say no.
- Cold mail from the shared address would put every store's delivery at risk (M1.6).

So the tool finds **companies, not people**, contacts each by the route its country allows, says where the details came from,
and stops at the first no. Every country rule is read by a lawyer before the tool is switched on for stores.

| Id | Step | Size | Status | Notes |
|---|---|---|---|---|
| P5.1 | The ideal customer in words | M | Open | The owner or the AI describes who they want (*cafés in Oslo with 5 to 50 employees*); the AI turns it into filters (industry code, place, size, age) that code runs over the public company registers' open data: Norway's Enhetsregisteret, Denmark's CVR, Finland's PRH first, others as their APIs allow |
| P5.2 | Read the company's own site | M | Open | `read_web_page` (D329) on the website the register or a search names: what the company does, a fit score worked out in code from the owner's criteria (`compareOptions()`), and the contact route the company publishes for enquiries (a general address, a contact form, a phone). A named person's address is never collected, never guessed from a pattern and never bought |
| P5.3 | The country's rule, in code | M | Open | `src/lib/outreach-rules.ts`: per country, kind of address (a company's general one, a person's work one) and channel (email, phone, letter): allowed with a way to say no, consent first, or not at all; the registers' own marks honoured (to be read: CVR's advertising protection, Norway's Reservasjonsregisteret). Each rule cites its source and stays `needs_legal_reading` until a lawyer signs. Where email is not allowed, it offers a letter or call |
| P5.4 | A record of why | S | Open | Per campaign: the purpose, the legitimate-interest balancing written by the AI from a template and confirmed by the owner, what is kept, the source of each address, and how long (deleted 90 days after the last contact without an answer); in the records of processing |
| P5.5 | The first email, one to one | M | Open | Written by the AI from what was read on the company's site (claims checked), sent from the owner's own domain (M1.1) on an outreach subdomain so the store's newsletter reputation is untouched; plain text, signed by a person; says where the address came from and why, with one line to say no; a daily cap per domain; each batch approved by the owner; at most one follow-up; a reply stops it |
| P5.6 | Do not contact, everywhere | S | Open | A no (a reply, the link or a complaint) puts the address and the company's domain on a list kept as hashes across all stores and the platform, checked before every send |
| P5.7 | Into the ecosystem | M | Open | A prospect is a lead (`LEAD_KINDS` gains `prospect`); an answer makes a deal (D464) with the conversation filed (D476), activities and the timeline; `prospect.replied` as an event and trigger; a report of companies found, contacted, answered, deals won and their value |
| P5.8 | The platform first | S | Open | Kaizena Flow's house store finds EU shops that would gain from moving, before any store gets the tool; its results are the first proof |
| P5.9 | Safety | S | Open | Websites are untrusted text (`UNTRUSTED_TEXT`); eval cases for a page that hides instructions, a page that asks to be written to at a personal address, and an invented fact about a company; the model never sends |

## Order of work

1. M0.1 (the owner's decisions) and ecosystem E3.1 (the event log): everything after rests on them.
2. M1.1 and M1.6: they protect every store's mail now, and prospecting needs M1.1.
3. M2.1 to M2.3 together with M3.1 to M3.3: the engine and its screens in the same steps, the recipes moved onto it.
4. M1.2 to M1.5: events, clicks per person, revenue per email, the contact policy.
5. M3.4 to M3.8: editing in place, the dry run, the checks, the words and the reports.
6. P5.1 to P5.9 for the platform, after M1.1 and a lawyer's reading of P5.3.
7. M2.4 to M2.8: segments, split tests, personal fields, texts in flows, scores.
8. M3.9 and M3.10: the autopilot's retention and the usability test.
9. Phase 4, and phase 5 for stores.

**Not planned:** an open-tracking pixel, bought or scraped lists, addresses guessed from names, dedicated IP addresses, postcards
and social posting.
