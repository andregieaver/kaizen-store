# The 100-day challenge: can the autopilot run a store alone and win?

**Status: proposal, 14 November 2026.** Written from a read of the code at commit `c681a95` (the autopilot D308 to D331 and D418, support
D216 and D332, orders, returns, drop shipping, ads D585, analytics, the books and the Shopify move D445) for the owner's question:

> The AI store manager works autonomously for 100 days, with no human intervention other than approving refunds and dealing with escalated
> support cases. A traditional store is cloned onto Kaizena Flow with its owner's approval, and the two compete on revenue and profit at the
> end of 100 days. Is the plan ready, and what must be added or changed to make it successful?

Pictures: `docs/100-day-challenge-readiness.svg` (where each area stands today) and `docs/100-day-challenge-model.svg` (how the 100 days run).

## Bottom line

**Not yet.** The engine is the right shape:

- goals, plans and a loop that runs without a person (D309);
- autonomy levels and budgets per area;
- reviews that make the next plan (D328) and reactions to events (D331);
- web research (D329), and measurement of what each change moved (D418);
- more than 240 store tools.

As built, though, it is a careful co-pilot, not an operator. Held to the challenge's rule, it would stop many times a day waiting for a person:

- every customer email about an order;
- every parcel label;
- every step of a return after it is approved;
- every newsletter, every cancellation and every purchase order.

It also steers by revenue, not profit. It cannot create a single ad. And nobody could check the result against the original store.

None of this is a rewrite. Section 4 has about 50 items in seven workstreams, some of them settings or rules rather than code. Together
they are roughly 210 days of work at the sizes given there. Then come a three-week rehearsal on the cloned store and a few outside approvals
that should start this month, because they set the critical path. A start on **Monday 1 March 2027** (Day 100 is Tuesday 8 June 2027) is
realistic if the P0 work (about 160 days) is built in four streams side by side through December and January (the last five days
recorded 37 decisions). Growth (D, about 52 days) needs two more streams. With fewer streams, Day 1 moves to April.

**Winning depends more on the format than on the AI.** A clone on a new domain starts with no search traffic, no returning customers, no
list it may email and no reviews. Head to head on absolute revenue, it has lost on day one. Section 3 proposes a format that splits demand
fairly and scores contribution profit on like-for-like demand. Under that format, and with sections 4A to 4F built, the AI has a real chance
on profit margin. Its edges are more EU markets in shoppers' own languages and payment methods, answers within minutes at any hour,
retention flows that are always on, and ad budgets moved daily by measured profit. Revenue is winnable only if demand is split fairly.

## 1. What the rule means in the platform's terms

"No human intervention except refunds and escalated support" means:

- Every kept approval outside refunds is either a breach of the rules or a stall.
- So is every question a plan asks the owner, and every button only a person can press.
- Today the defaults keep almost everything:
  - every area is *Ask me first*;
  - *Keep working toward my goals* and *React to what happens* are off;
  - review plans wait for a yes;
  - the AI budget is 5 USD a month (`src/lib/autopilot-autonomy.ts`).
- Beyond the defaults, three things block the rule whatever the settings say:
  1. **Never automatic, whatever the level** (`NEVER_AUTOMATIC`): `change_order`, `process_exchange`, `send_broadcast`,
     `adjust_customer_credits`, `issue_gift_card`, `set_market_price_rule` and `set_customer_group`, beside refunds.
  2. **No tool at all**: cancelling an order, creating a purchase order, booking a label, releasing a fraud hold, sending dispute evidence,
     carrying out a support request, returns after approval (in transit, received, inspected), answering a review, creating an ad.
  3. **The design hands the work to a person**:
     - email support hands every order question to a person (`src/lib/chat.ts`, the `ctx.email` line);
     - nobody but a person reads a contact form (`src/server/support-forms.ts`);
     - the autopilot's `support_waiting` event only writes a staff note, never a reply (D331);
     - a plan step that fails three times becomes a question for the owner (`docs/ai-autopilot.md` 7.3).

## 2. Readiness today

| Area | What exists | Alone today? | What blocks it |
|---|---|---|---|
| Order process | Capture at checkout or on sending (D289), notifications (D238), invoices (D159), drop-ship orders sent 30 minutes after payment with tracking back (D550) | Partly | No label booked by itself (`bulk-labels.ts` is staff only); no cancel tool; `change_order` never automatic; fraud holds released only on the order page; dispute evidence never sent by itself (D417) |
| Returns | Withdrawals approved when the customer confirms; return labels for withdrawals when automatic labels are on | Partly | Voluntary returns wait in `requested` with no event; in transit, received, inspected, refund and close are buttons only (`docs/returns.md`); `refund_order` bypasses the return's `refundFor()` |
| Support | Shop chat answers alone (`ai_first`), email desk (D332), widget on outside sites (D582), queue with sound, browser notice and email (D216) | Partly | Order questions by email always go to a person; forms never reach the AI; staff requests are carried out by hand (support step 15 never built); no WhatsApp, Instagram, Messenger, SMS replies or marketplace messages |
| Inventory and purchasing | Low-stock email, `stock.low` trigger, `restock_suggestions` (a pace rule), `receive_purchase_order` | No | No tool creates or sends a purchase order; no forecast with seasons or campaigns |
| Advertising | Meta: read this month's spend, change an existing daily budget within a monthly limit (D585); server-side conversions to Meta, GA4, TikTok, Pinterest (D303) | Barely | No campaign, ad set, audience or creative can be made; no Google Ads; Meta read-back is spend only (no clicks, conversions, ROAS); spend never reaches `marketing_spend` |
| Campaigns and email | Discounts and sale campaigns (marketing area), loyalty, bonus, four single-email automations, cart reminders, segments, AI-drafted broadcasts | Partly | `send_broadcast` never automatic; automations' words and delays are not the AI's to edit; no multi-step flows; no SMS tools; no revenue per email |
| A/B testing | Five tools, `apply_winner` on `test_ended` (D148, D331), a guardrail | Yes, for words on pages | Only page words; only consenting visitors counted; no tests of pictures, shipping thresholds or email subjects; no holdout for the AI's own changes |
| Pricing | `set_prices` within a largest change (10 %), market price rules (never automatic) | Partly | No floor at cost: the AI can price below cost; no competitor price data |
| Budgeting | Books budget per account and year (D505), Norway-only ledger (D478), fixed costs as one monthly figure | No | No AI tool reads the budget; no cash or stock-capital forecast; no purchasing budget for the autopilot |
| Growth analysis | Funnel, cohorts, LTV, RFM, `explain_change`, alerts, D418 effects; 33 read tools in a goal review | Yes, on sales | The review sees gross profit only; no tool for Finance, ROAS, CAC, MER, forecast, targets or live; effects measured on sales before refunds, 14 + 14 days |
| Revenue forecasts | `forecastMonth()`: 8-week average × weekday × last year, 80 % range | No | This month only; shown on one page; no AI tool returns it |
| Profit | Profit per order (D415, real Stripe fees and booked label prices), Finance statement to operating profit | Not for the AI | Finance uses estimated shipping, order profit uses label prices: two numbers; ad spend, AI cost, packaging and return labels left out; goals cannot target profit (`GOAL_TARGETS`) |
| Running unattended | Global and per-store pause, job health emails, status page, safety eval with injection cases, page versions | No | One AI provider with no fallback (`aiFor()`); 5 USD budget, and a budget stop never resumes; autopilot turns share the owner's 300 a day; alerts are emails, no paging; no automatic rollback; no protection from pushes to `main` |
| The clone | Shopify Copy (products, variants, prices, cost, stock, customers, subscribers with consent evidence, orders as history, pages, menus, redirects, discounts, theme colours), WooCommerce steps 1 to 5 | Partly | Reviews (Shopify), logo, compare-at prices, metafields not copied; replicator needs a person's open page; no sync after the copy; *Move my shop* would email every gift-card holder and move the domain |
| The scoreboard | Nothing compares two stores | No | Copied orders never count as sales; Shopify read-back lacks refunds, fees and costs; the "Before the move" view (decision 3 of D445) is open |

## 3. Decide the format before building

### 3.1 The traffic problem

A cloned store sells the same goods as the original, so both chase the same shoppers. The original keeps:

- its domain's search ranking and its direct visitors;
- its reviews and its returning customers;
- the right to email its list.

The clone has none of these unless the format gives them. Two stores on separate brands would also bid against each other in the same ad
auctions.

### 3.2 Three formats

| Format | How | Fair? | Cost to run |
|---|---|---|---|
| **1. One business, two operators, split demand (recommended)** | The store owner stays merchant and data controller of both stores; Kaizena Flow runs the clone as their processor (a data processing agreement). Same brand, same catalogue and the same supplier costs. Physical stock split into two pools at Day 0 in an agreed ratio. Customers and subscribers split at random into two halves (by a hash of the customer id); each store markets only to its half, and both sell to anyone who arrives. Equal ad budgets in each store's own ad account; neither bids on the brand's name. | Best: the comparable demand is split at random, as in an A/B test | Moderate: a list split, two ad accounts, one warehouse serving both |
| 2. Separate brands, head to head | The clone gets a new name and domain, the same catalogue, costs and starting prices, and the same ad budget | Only on ratios: scored on contribution profit per krone of marketing and on margin, since the clone has no organic traffic or list | Low |
| 3. Takeover | The AI runs the real store for 100 days; compared with the same 100 days last year and the owner's own forecast | Weak: seasons, the market and the weather move it | Lowest; a good pilot, poor proof |

### 3.3 Scoring (pre-registered, before Day 1)

- **Period:** Day 1 at 00:00 to Day 100 at 23:59 in the store's time zone. Refunds of orders placed in the period count until Day 130, so
  returns and withdrawals settle.
- **Revenue:** net sales without VAT, after discounts and refunds (the platform's `periodTotals()` definition, applied to both stores).
- **Contribution profit:** revenue less:
  - cost of goods at the agreed supplier prices;
  - payment fees as charged;
  - shipping and handling as invoiced by the carrier or warehouse, and return shipping;
  - packaging;
  - all marketing spend (ads, SMS, creators, tools);
  - apps and platform subscriptions;
  - for the clone, its AI cost.
- **Winner:** higher contribution profit on like-for-like demand (format 1: purchases by each store's half of the customers, plus
  paid-traffic orders on equal budgets). Margin (contribution ÷ revenue) is the second test. Total revenue and total profit are reported
  beside these.
- **Stock at the end:** goods bought during the challenge and not sold are valued at cost and are not a loss. A clearance in the last two
  weeks counts like any sale.
- **Referee:** an accountant both sides accept reconciles the scoreboard with payouts and bank statements at Day 50 and Day 100.

### 3.4 Fairness rules

- Neither side changes the other's prices, stock, ads or customers.
- The original's owner works as they normally would.
- Refunds and escalations for the clone are handled by a neutral person from Kaizena Flow following the store's own refund policy, never by
  the competing owner (a conflict of interest).
- Fixes by Kaizena Flow's engineers to the platform are not store interventions, but each is logged and published.
- The intervention log (4A5) is public to both sides.

## 4. What to build

Priorities:

- **P0**: without it, the challenge cannot run under its rule or cannot be judged.
- **P1**: without it, the AI has little chance to win.

Sizes are at the pace of recent units: S is a day or two, M about a week, L two weeks or more. Summed: A about 23 days, B 44, C 26,
D 52, E 39, F 28 (G is setup). The P0 workstreams alone are about 160 days.

Platform parity (CLAUDE.md): stock, fulfilment and returns cannot apply to Kaizena Flow, which sells plans. The profit goals, failover,
paging and rollback reach the platform's own autopilot in the same change.

### A. Challenge mode and the two human queues (P0)

| # | What | Size | Where |
|---|---|---|---|
| A1 | **Challenge mode**: a store setting with a start and end date that applies the preset of section 5. It locks the autonomy settings (a change is a logged intervention). A step that fails three times re-plans or is skipped with the reason instead of asking the owner. Kept refund items escalate instead of expiring after 7 days. | M | `autopilot-settings.ts`, `autopilot-runner.ts`, `autopilot-plans.ts`, `assistant_approvals` expiry |
| A2 | **Re-sort what is never automatic** for the challenge (table below). | M | `src/lib/autopilot-autonomy.ts`, `autopilot-autonomy.test.ts` |
| A3 | **The refund queue**: one list, with push to the phone (push today covers paid orders, quotes and activities only, `src/server/push.ts`). Each item shows the AI's recommendation, the evidence, and an amount worked out by the return's `refundFor()`, approved with one press. `refund_order` uses that amount and records the refund on the return. | M | `src/server/owner-tools.ts` (`refund_order`), `withdrawals.ts`, `push.ts`, the Decisions page |
| A4 | **The escalation queue**: the categories that may reach a person: the customer asks for one; legal (a complaint to an authority, a lawyer, a GDPR request, a chargeback); product safety; abuse; the AI could not help after two tries. Each handoff names its category; escalation rate and time to answer are measured. | M | `support-tools.ts` (`handoff_to_human`), `docs/support.md` 233–240 |
| A5 | **The intervention log**: every person's action on the store (`audit_log.acted_by = 'person'`) is classed as refund, escalation, platform fix or other, and counted on the scoreboard. *Other* must stay at zero. | S | `src/server/actor.ts`, audit readers |
| A6 | **Stall watch**: a kept call, a question, a paused plan, a budget stop or a stale event pages the platform team within minutes (today the owner gets one digest a day after 18:00). | S | `autopilot-reports.ts`, `cron-alerts.ts` |

What each never-automatic tool becomes in challenge mode:

| Tool | In challenge mode |
|---|---|
| `refund_order`, `adjust_customer_credits`, `issue_gift_card` (goodwill), the money of `process_exchange`, a `change_order` that lowers the total | The refund queue (allowed by the rule) |
| `change_order` with no money (address, shipping method before sending), the exchange's goods | A new money-free order change, area `messages`, automatic |
| `send_broadcast` | Automatic within a broadcast budget: sends a week, segment size, a seed send and `look_at_page`-style check first, claims filter as today |
| `set_market_price_rule` | Automatic within the largest price change and the margin floor (D5) |
| `set_customer_group`, `set_price_list_buyers`, creators' tools, `moderate_blog_comment` | Out of scope: the features stay off, or blog comments are closed |
| Staff, domains and DNS, the plan, features, `open_store`, producer registrations | Done by the team before Day 1; a need during the run is a logged platform fix |

### B. Support that answers itself (P0)

| # | What | Size | Where |
|---|---|---|---|
| B1 | **Email answers about the customer's own orders**: the sender is verified (the From address matches the order's email, with the order number in the thread, or a one-time link). The email agent then gets the signed-in chat's read tools (status, tracking, return options) instead of handing off. This is most of a store's support volume. | M | `src/lib/chat.ts`, `src/server/support-tools.ts`, `inbound-email.ts` |
| B2 | **Contact forms read by the AI** as email is. | S | `src/server/support-forms.ts` |
| B3 | **Staff requests carried out by code**: support step 15's executors (address change and cancel before sending, resend, exchange), offered to the chat, the email agent and the autopilot; money goes to the refund queue; a `staff_request` event. | L | `support-actions.ts`, `docs/support.md` step 15 |
| B4 | **The waiting customer gets an answer**: in challenge mode the `support_waiting` event may `reply_to_support`, labelled as the AI's (Art. 50). Support replies get a budget of their own instead of sharing `customerEmailsPerWeek` (max 100 a week). | S | `src/lib/autopilot-events.ts` (`EVENT_TOOLS`), `autopilot-autonomy.ts` |
| B5 | **The channels the original uses**, through the same desk and agent: WhatsApp Business, Instagram and Messenger DMs, SMS replies (46elks inbound keeps only STOP today), marketplace messages. Build only those the original store actually has. | L | `commerce.support_conversations.source`, new channel adapters |
| B6 | **Returns run to the refund**: voluntary returns approved by policy; a `return_requested` event; in transit from tracking, received from the carrier's or warehouse's scan, inspected on the warehouse's confirmation; then the refund proposal to the queue. | M | `src/server/withdrawals.ts`, `return-jobs.ts`, `docs/returns.md` |
| B7 | **Reviews**: the AI answers reviews and switches review requests on. | S | `reviews-admin.ts` (`answerReview`) |
| B8 | **A quality bar before Day 1**: replay the original's last 90 days of support emails, with its owner's permission and names removed, through the agent; measure right answers, escalations and grounding. Target under 10 % escalated. | M | an offline run of `chat-agent.ts` |

### C. Orders, stock and fulfilment without a person (P0)

| # | What | Size | Where |
|---|---|---|---|
| C1 | **A warehouse that ships for the clone**: set the owner's warehouse, or a 3PL, up as the clone's drop-ship supplier (D550). It is the one path that already runs alone: orders sent after payment, tracking back. The handling fee per order is a cost in the scoreboard. Self-shipping would need labels booked on payment, which is not built. | S to set up | `docs/drop-shipping.md`, `src/server/suppliers.ts` |
| C2 | **Supplier orders as tools and events**: a late or refused supplier order is a person's resend or cancel today, with no AI tool. | M | `src/server/suppliers.ts` |
| C3 | **Purchase orders by the AI**: `create_purchase_order`, sent to the supplier by email or its system, within a new purchasing budget (a month and per order) in the `money` area. Today *Prepare reorder* waits for a person's Create. | M | `src/server/purchase-orders.ts` |
| C4 | **Demand forecast for reordering**: weekday and season profile, planned campaigns, lead times; a stock-out risk event. `restockSuggestions()` is a pace rule today. | M | `src/server/owner-insights.ts` |
| C5 | **Order events** beside `support_waiting`, `test_ended` and `alert`: paid but not sent after N hours, a delivery exception, a dispute opened, a spike of failed payments, a fraud hold. | M | `src/lib/autopilot-events.ts`, `autopilot-events.ts` |
| C6 | **Cancel and risk tools**: cancel an unsent order (its money to the refund queue); release a fraud hold by rule or escalate it; capture set to *at checkout* or *when sent*. | S | `cancelOrder()` (admin only today), capture settings |
| C7 | **Disputes are escalations**: evidence is drafted by code (D417) and sent by the person who handles escalations. | S | rule in A4 |
| C8 | **Stock pools**: stock split at Day 0, so no sync is needed. A shared stock would need a sync with the original's platform through the Admin API (`/api/admin/v1/inventory/*`) and the original's API (L). | S as rule | |

### D. Growth the AI can pull (P1)

| # | What | Size | Where |
|---|---|---|---|
| D1 | **Ad campaigns, not only budgets**: Meta first, with catalogue-based shopping campaigns from the product feed (little creative needed). Creatives from the store's pictures and the picture maker (D283, D349); copy through `findClaims()` and the brand's words to avoid. Create, pause and duplicate campaigns and ad sets; audiences from consented segments. Then Google Ads with Merchant Center (Performance Max or Shopping). Read clicks, conversions and revenue per campaign (Meta's read is spend only today). | L | `src/server/ad-accounts.ts`, `src/lib/ad-budgets.ts`, `docs/agent-spending.md` |
| D2 | **Ad spend into the books, daily**: each ad account's spend per day and campaign written to `marketing_spend`, so contribution profit and ROAS are true. Today spend there is typed or uploaded only. | S | `ad-accounts.ts`, `analytics-settings.ts` |
| D3 | **Merchant Center and the Meta catalogue by API**: push the products, read diagnostics and disapprovals. Feeds are addresses only today (D302). | M | `src/server/feeds.ts` |
| D4 | **Retention the AI writes**: automations' words and delays, multi-step flows (browse abandonment, cross-sell after purchase, replenishment), cart reminder settings, revenue per email, SMS tools (D565 has none), broadcasts within budget (A2). | L | `src/server/automations.ts`, `broadcasts.ts`, `sms.ts`, `marketing-tools.ts` |
| D5 | **A margin floor**: no price, discount, campaign or price rule below cost plus a minimum margin. The price tool reads no cost today. | S | `autopilot-autonomy.ts`, `src/server/product-tools.ts` |
| D6 | **More EU markets**: a tool for payment methods per country (D291 has none), catalogue translation at scale, per-market feeds, shipping and ads. The AI chooses markets from research and the warehouse's reach. This is the platform's strongest lever: in Stripe's tests iDEAL lifted conversion 39 % and BLIK 46 % (`docs/plan.md`). | M | `src/server/payment-methods.ts`, setup tools |
| D7 | **Competitor prices**: named competitor pages read on a schedule, prices parsed into a table, compared in code. | M | `src/server/research.ts` |
| D8 | **Tests on more than words**: product pictures and texts, the free-shipping threshold, email subjects. Prices are changed by period and market, never by visitor, because the EU asks personalised pricing to be disclosed. | M | `src/server/experiments.ts` |
| D9 | **Search**: the Search Console API's queries and pages for content; `build_page` gains articles. | M | `src/server/seo.ts`, `src/lib/site-tools.ts` |

### E. Steer by profit, judge truthfully (P0)

| # | What | Size | Where |
|---|---|---|---|
| E1 | **One contribution profit**: Finance uses booked label prices, as order profit does (`analytics-totals.ts` uses estimates). Add return labels, the cost of restocked goods back, handling and packaging per order, ad spend (D2), AI cost, the plan and apps. | M | `src/lib/order-profit.ts`, `src/lib/analytics-finance.ts`, `src/server/analytics-totals.ts` |
| E2 | **Profit goals**: contribution profit and margin targets, totals since a date (the 100 days), ROAS or MER, average order, repeat rate; *not measured* while cost covers under 30 % of sales. | M | `src/lib/autopilot-goals.ts`, `goalFigures()` |
| E3 | **The review sees money**: tools for the Finance statement, order profit, marketing (CAC, ROAS, MER), the forecast, targets, the campaigns report and the budget; `analytics_overview` with any period. | M | `src/lib/autopilot-reviews.ts` (`REVIEW_READ_TOOLS`), `analytics-tools.ts` |
| E4 | **Effects on profit, sooner**: D418 on contribution, with an early 7 + 7 day reading beside the 14 + 14, and tests where they can be run. | M | `src/lib/autopilot-effects.ts` |
| E5 | **A 100-day forecast**: revenue and contribution with a range, and the stock capital it needs. `forecastMonth()` covers this month only. | M | `src/lib/analytics-forecast.ts` |
| E6 | **Profit and spend alerts**: a margin drop and spend without orders. `ALERT_RULES` has neither. | S | `src/lib/analytics-alerts.ts` |
| E7 | **The scoreboard**: the referee's page with both stores, one definition, updated daily. The clone is read from the platform. The original is read from its platform's API (Shopify needs `read_all_orders` approved, plus refunds, transactions and payout fees, which the copy does not read today) or from a monthly P&L its accountant signs. The baseline is frozen before Day 1. | L | new; `src/lib/shopify.ts` scopes |

### F. A hundred days without a person at the wheel (P0)

| # | What | Size | Where |
|---|---|---|---|
| F1 | **A second AI provider**: the autopilot, chat and email agents fall back to another provider's model on errors or time-outs. `aiFor()` returns one connection today. | M | `src/server/ai.ts` |
| F2 | **Limits for a business**: the AI budget sized from the rehearsal's cost × 2; autopilot turns counted apart from the 300 a day the owner's chats use (every turn stores a `user` message, `owner-assistant.ts`); events limited per kind, not 12 in all; a plan paused by a budget resumes when the month turns. | S | `autopilot-autonomy.ts`, `owner-assistant.ts`, `autopilot-events.ts` |
| F3 | **Paging and an outside heartbeat**: the platform team is paged, not emailed, for the challenge store; the open PSI item REL-06 (a dead dispatcher takes its own checks with it). | S | `src/server/status.ts`, `docs/audits/psi-followups.md` |
| F4 | **Watch and roll back**: after each autopilot change, conversion, add-to-cart and errors are compared hourly with what was expected. A clear fall reverts the change: pages and themes through their versions (D305), prices through a new price history restore (none exists today), campaigns stopped. | L | `autopilot-effects.ts`, `page-versions`, `set_price` history |
| F5 | **Protect the store from deploys**: the challenge store's prompt versions and model are pinned (`prompt-versions.ts` records them); its pages and a test checkout join the deploy's smoke; a rollback runbook. Changes to the autopilot's prompts and tools during the run are bug fixes only, each logged. | M | `scripts/await-deploy.mjs`, `src/server/prompt-versions.ts` |
| F6 | **Safety eval** run with challenge mode's prompts, with new cases for every new channel and for supplier emails. | S | `src/lib/agent-eval.ts` |
| F7 | **Paperwork**: `docs/ai-act.md` rests the autopilot's minimal risk partly on "changes that matter wait for a person's yes". It stays minimal risk (not Annex III), but `docs/dpia-ai.md` and the store's privacy notice must say customer messages are answered by AI on its own. | S | docs |

### G. The clone (P0, mostly setup)

| # | What |
|---|---|
| G1 | **Copy, never Move**: Shopify's *Move my shop* issues new gift-card codes and emails every holder, and *Point it here* moves the domain. Use Copy only, with gift cards left out. *Undo this copy* works only before the first real order. |
| G2 | What does not come across: reviews from Shopify (spike S6: import them by CSV), the logo and icon, compare-at prices, metafields. The replicator copies one page per job and needs a person's open page: done by the team before Day 1. |
| G3 | **Approvals to start now** (outside lead times set the critical path): Shopify's protected customer data and `read_all_orders`; Meta's app review for ads management (and for WhatsApp or Messenger if B5 needs them); a Google Ads developer token; Stripe Connect onboarding of the merchant (identity is a person's); the warehouse or 3PL agreement. |
| G4 | **Domain and search**: the clone on its own domain (format 1 and 2), with product texts rewritten by the AI so the two sites are not duplicates; a canonical cannot point at another domain. |

## 5. Challenge mode's settings

| Setting | Default today | Challenge |
|---|---|---|
| Levels | all *Ask me first* | catalogue, website, marketing, messages, money: *Just do it*; design and setup: *Do it and tell me* |
| AI budget a month | 5 USD | the rehearsal's measured cost × 2 |
| Deepest discount | 20 % | 20 %, and never under the margin floor |
| Largest price change | 10 % | 15 % a change, never under the margin floor |
| Emails to customers itself a week | 5 | support replies on a budget of their own; marketing emails on the broadcast budget |
| Largest ad raise | 20 % | 20 % a day; the ad account's monthly limit = the agreed envelope |
| Keep working toward goals | off | on; plans start themselves; goals reviewed every 3 days; up to 10 plans a week |
| React to what happens | off | on; a waiting customer looked at after 5 minutes |
| New budgets | none | broadcasts a week, purchasing a month and per order |

## 6. How the AI plays the 100 days

The phases are set as goals with due dates and a saved playbook (D350), so each review knows where it is:

1. **Days 1 to 20, the basics.**
   - Speed, the checkout and the shopper's language and payment methods.
   - Every flow on: cart reminders, welcome, after purchase, win-back, back in stock.
   - Feeds and shopping campaigns live.
   - Support answering in minutes.
   - The markets to add chosen from research.
2. **Days 21 to 60, grow what earns.**
   - New markets opened.
   - Ad budgets moved daily toward campaigns that make contribution profit, not just revenue.
   - Five tests running at all times.
   - Weekly broadcasts to its half of the list.
3. **Days 61 to 100, harvest margin.**
   - Spend that makes no contribution cut.
   - Prices set per market.
   - Discounts held to what pays.
   - Repeat buying pushed.
   - Slow stock cleared before Day 100.

## 7. Rehearsal and the Day 1 gate

The clone opens three weeks before Day 1 in challenge mode, with real shoppers, while the team watches. Interventions are allowed but logged,
and each is fixed so it cannot happen again. Day 1 starts only when all of these hold:

- [ ] no intervention of the class *other* in the last seven days;
- [ ] escalated support under 10 %, and every escalation answered within the agreed time;
- [ ] no plan stalled longer than an hour;
- [ ] the AI's cost a day known, and the budget set from it;
- [ ] a failover drill (the first AI provider cut off) and a rollback drill passed;
- [ ] the scoreboard reconciles with payouts and the bank for the rehearsal weeks;
- [ ] the safety eval passed on the pinned prompts and model.

## 8. Timeline

| When | What |
|---|---|
| 15 to 30 November 2026 | The format chosen and agreed with the store owner; the approvals of G3 started; the referee named |
| December 2026 to January 2027 | Build the P0 work in four streams side by side: (1) A and F without F4, (2) B, (3) C and F4, (4) E, each about 40 days. Growth (D) in two more streams; D1, D2 and D5 must be in before the rehearsal, and the rest may land in the run's first weeks as platform improvements announced to both sides before Day 1 |
| 1 to 21 February 2027 | The clone made (G); the rehearsal (section 7) |
| 22 to 28 February | Figures reset, baseline frozen, prompts pinned |
| Monday 1 March 2027 | Day 1 (Easter, 28 March, falls inside the run for both stores) |
| Day 50, 19 April | The referee's mid-point reconciliation |
| Tuesday 8 June 2027 | Day 100 |
| 8 July 2027 | Refunds settled (Day 130); the result |

## 9. Risks

| Risk | What keeps it small |
|---|---|
| The traffic gap decides the result | Format 1, scored on like-for-like demand |
| Stock runs out, or is sold twice | Stock pools, the forecast (C4), purchase orders within a budget (C3) |
| Ads overspend | The account's monthly limit, spend in the books daily (D2), profit-based ROAS in the review (E3) |
| A wrong answer to a customer goes public | Grounding rules, the eval, the replay bar (B8), clear escalation categories |
| The AI provider fails | F1, and the stall watch (A6) |
| A deploy breaks the store mid-run | F5 and the rollback runbook |
| The competing owner decides the clone's refunds or controls its stock | A neutral approver, stock pools, rules signed before Day 1 |
| Customers' data used without a basis | The owner stays controller (format 1); a data processing agreement |
| Too few visitors for tests to say anything | Fewer, bigger tests; decisions on profit; no claim of cause where there is only a comparison (as D418 says) |
| Losing in public | Pre-registered rules; nothing announced before the rehearsal's figures are in |

## 10. Can it outperform?

**Where the AI has the edge:**

- More EU markets in shoppers' own language, currency and payment methods, with VAT and OSS handled. Few single-country stores ever do this,
  and the platform is built for it.
- Answers in minutes at any hour.
- Every retention flow always on.
- Tests always running.
- Budgets moved every day by measured profit.
- Discounts held to a floor.

**Where it is weaker:**

- Ad creative.
- Relations with suppliers.
- Physical work.
- Starting without the original's search ranking and reviews.

**Verdict:** with format 1 and sections 4A to 4F built, the AI has a credible chance of the better margin. On revenue it has a chance only
because the format splits demand fairly. Without D (growth), it can at best run the store as well as the owner. Without E (profit), it may
grow revenue and lose on margin. Without A, B, C and F, it cannot finish the 100 days under the rule at all.

## 11. Decisions for the owner

1. **The format**: format 1 recommended; format 2 if the store owner will not share brand and list.
2. **Who presses the two buttons**: a neutral person at Kaizena Flow with the store's refund policy is recommended.
3. **The winning measure**: contribution profit on like-for-like demand, with margin as the second test, is recommended.
4. **Money**: the ad envelope and the stock capital, who funds them, and who keeps the profit.
5. **Fulfilment**: the owner's warehouse as a paid service, or a 3PL.
6. **The start date**: 1 March 2027 recommended; a run through next November and December would test the peak season instead.
7. **The support channels** in scope: those the original store uses.
8. **Public or private**: the challenge announced before Day 1, or after the result.
