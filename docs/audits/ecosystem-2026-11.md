# The ecosystem as one organism (assessment of 17 November 2026; working plan)

The owner asked whether the in-house counterparts of Shopify, Pipedrive, Zendesk, VWO, Clarity and Hotjar, a CRM, ActiveCampaign,
domain hosting and the autonomous AI agents work as one whole: connected, automated, easy to use and efficient. The assessment is the
document *Kaizena Flow as one organism* (claude.ai, 17 November 2026); this file keeps its findings in short and is the working plan.
Find a step's row by id; in the same change set it to Done with the date and the commit (as `CLAUDE.md` asks of every working plan).

## The finding in short

The parts share one memory (one database, one person per email per store, the customer timeline) and one brain (278 store tools in
`OWNER_TOOLS`, shared by the AI manager, the autopilot, the owner MCP, Kaizen Life and the Dream Factory). They share no nervous system:
signals travel six separate paths (integration events, the order-paid queue `store_events`, the autopilot's own detectors, polling jobs,
direct calls and platform events), none keeps a log, and deals, leads, activities, heatmaps, recordings, speed and domain health reach
none of them. Scores out of 5: interconnectedness 2.7, automation 2.8, usability 2.9, workflow efficiency 2.3.

On 17 November 2026 production held almost no use of the newer systems (60 stores; 0 workflows, order rules, email automations,
broadcasts and recordings; 10 deals in 2 stores), so merging and renaming now breaks no owner's habits and moves no data.

Rules proposed to keep the whole in balance (for the owner to take into `CLAUDE.md`'s Conventions, not yet taken): every new record
sends events; every new signal gets a reflex (an alert, a notice, a workflow trigger or an autopilot event); every new queue reports to
one attention source; every detail screen links to its person, order and page; the AI reads before it writes; one word per thing;
behaviour joins pages, never people.

## Phase 1: quick joins (D711)

| Id | Step | Size | Status | Notes |
|---|---|---|---|---|
| E1.1 | A signed-in chat links its customer, and the Context column lists their latest orders | S | Done, 17 Nov 2026 | `src/server/support-customer.ts`, `ConversationContext`/`CustomerOrders`; first answer of the feed only (`after` 0), `customers:read` for the link, `orders:read` for the orders; an address match stays marked not verified |
| E1.2 | The customer timeline's conversation link opens the inbox | S | Done, 17 Nov 2026 | It pointed at the JSON feed route `support/c/{id}`; now `/support?c={id}` |
| E1.3 | Orders and drafts show the deal they are linked to | S | Done, 17 Nov 2026 | `dealOfThing()` was never called; only while Deals (`sales`) are on, for `customers:read` |
| E1.4 | Replies to the store's emails about orders reach the support inbox | S | Done, 17 Nov 2026 | Opt-in through the desk's existing choice: with *In this inbox only*, `replyToDesk` emails (order confirmation and updates, bookings, box deliveries, returns, exchanges) carry the desk's address as Reply-To (`deskTakesReplies()`, `deskReplyTo()`). Never to both addresses, so the AI and the owner's mailbox do not answer twice |
| E1.5 | Platform forms reach the platform desk | S | Moved | kaizenaflow.com is served from the house store (D484), the database refuses form messages on the platform desk by design, and joining the desks is step 6 of `docs/platform-parity-plan.md` (the owner chose one desk). Found: the house store's desk is off, so kaizenaflow.com's forms email their recipients |
| E1.6 | The autopilot sees heatmaps and speed; test suggestions rank where visitors get stuck | S | Done, 17 Nov 2026 | `page_behaviour`, `version_behaviour`, `speed_report` in `REVIEW_READ_TOOLS` (reviews and alert turns); `version_behaviour` in the test-ended and test-answered turns; `suggest_experiments` answers `where_visitors_get_stuck`. No prompt or tool description changed, so the recorded eval stands |
| E1.7 | Support's open requests are counted on the Support tab and on Home | S | Done, 17 Nov 2026 | `openRequestCount()` was never used; the store's and the platform's Support tab, and `attentionFor()` (*… requests from the chat assistant are waiting for your decision*) |
| E1.8 | The domain jobs run inside `tracked()` | S | Done, 17 Nov 2026 | `daily.domain-renewals`, `daily.domain-reminders`, `daily.domain-moves`, `daily.domain-arrivals` in `commerce.cron_jobs`, so a failure shows on the platform home |
| E1.9 | Docs that no longer matched the code | S | Done, 17 Nov 2026 | `heatmaps-and-recordings.md` (status), `admin-navigation.md` (page counts), `domains.md` 7.2 (`domains_overview` is not built), code review 2.1 (the finder is built for the store and the platform) |

## Phase 2: one front door

| Id | Step | Size | Status |
|---|---|---|---|
| E2.1 | One attention source (`src/server/attention.ts`) behind Home, the briefing, the notices bell, push and Slack; disputes, leads, autopilot decisions, blog comments and overdue activities added | M | Open |
| E2.2 | ⌘K finds orders, customers, conversations, deals and products, hands a miss to the AI manager, and is at the owner's level too | M | Open |
| E2.3 | A *how it performs* strip in the page and product editors: conversion, heatmap, recordings, speed, the running test | M | Open |
| E2.4 | Consent, segments and SMS on the customer page | S | Open |
| E2.5 | CRM tools for the AI manager: deals, leads, activities and the timeline (prompt drawings and a new eval recording) | M | Open |
| E2.6 | *Quote for this deal*; drafts prefilled from a customer or a deal | S | Open |
| E2.7 | Act from the conversation: refund, return, store credit, address, then the request decided | L | Open |
| E2.8 | Leads in the menu, each with a link to its source and an owner | S | Open |

## Phase 3: one nervous system

| Id | Step | Size | Status |
|---|---|---|---|
| E3.1 | An append-only event log (`commerce.events`), written by `queue_integration_event()` and `queue_store_event()`, read by every engine with a cursor | L | Open |
| E3.2 | The missing events: deal, lead, activity, subscriber, checkout abandoned, conversation ended or rated, review published, domain problem, and the `work_*` events queued today but dropped | M | Open |
| E3.3 | Order rules folded into workflows, with a hold action (0 rows to move on 17 Nov 2026) | M | Open |
| E3.4 | Workflows gain customer actions: marketing email, SMS, start an automation, wait | L | Open |
| E3.5 | One contact policy across email and SMS: a cap per person, spacing, quiet hours, priority | M | Open |
| E3.6 | Segments on products bought, deals, support, reviews and engagement, usable by every engine | M | Open |
| E3.7 | One word per thing (Requests, Subscriptions, Activities, Reports, Notices, Follow-ups), Discounts as one page, automations in one home, and a scan test for menu names | M | Open |

## Phase 4: closed loops

| Id | Step | Size | Status |
|---|---|---|---|
| E4.1 | The autopilot tests its page changes as A/B tests where traffic allows | L | Open |
| E4.2 | Frustration, slow-page and domain alerts; the autopilot driven by the event log instead of its own scans | M | Open |
| E4.3 | Questions the assistant could not answer feed its knowledge | M | Open |
| E4.4 | A sending domain per store | M | Open |
| E4.5 | Split tests of broadcasts and email automations | L | Open |
| E4.6 | Owners nurtured from trial to plan through the house store | M | Open |

Every step that changes a prompt or a tool's description needs a new run of the agents' eval on Platform → AI and its recording
committed; every store step names its platform step in the same decision.
