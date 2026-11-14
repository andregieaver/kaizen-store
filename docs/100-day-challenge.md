# The 100-day challenge: can the autopilot run a store alone and win?

**Status: proposal, 14 November 2026, with the owner's first decisions of the same day.** Written from a read of the code at commit `c681a95` (the autopilot D308 to D331 and D418, support
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

None of this is a rewrite. Section 4 has about 50 items in seven workstreams, some of them settings or rules rather than code; section 14
adds six more for running up to ten stores. Together
they are roughly 210 days of work at the sizes given there. The owner wants the earliest start. The earliest honest Day 1 is **Monday
4 January 2027** (Day 100 is Tuesday 13 April 2027):

- a Day 1 minimum of about 110 days of work (section 8.1), built in six streams side by side over four weeks (the last five days recorded
  37 decisions);
- a three-week rehearsal through Christmas;
- the rest landing during the run, announced to both sides before Day 1.

Anything earlier would start the challenge with known stalls, such as every order email going to a person.

**The format is decided: two brands, head to head** (format 2, 14 November 2026).

- The clone opens under a new name and address, with the same products, costs and ad money.
- It starts with no search traffic, no customers and no reviews. So it will very likely sell less in total than the original over 100 days.
  That is expected, and it is not the test.
- The winner is counted in ratios (section 3.3): margin, profit per krone of marketing, and revenue per visitor.
- With sections 4A to 4F built, the AI has a real chance on these. Its edges are more EU markets in shoppers' own languages and payment
  methods, answers within minutes at any hour, retention flows that are always on, and ad budgets moved daily by measured profit.
- The store owner may keep the clone afterwards, or move the whole business onto it (section 12). So the clone is built as a business to
  keep from Day 0, not as a test.

## Decided by the owner (14 November 2026)

- **Refunds and escalated support** for the clone are handled by the store owner. They also run the competing store, so:
  - the agreement sets how fast they answer (section 3.4);
  - the queue reaches them whoever the autopilot works for (A3).
- **The money is the store owner's.** They fund the ad budgets and the stock of both stores and keep the profit of both.
  - The clone's sales are paid out to the owner's company, through its own Stripe account, which the owner onboards.
  - Its ads run in an ad account of the owner's business.
  - The AI spends the owner's money only within limits the owner sets before Day 1 (section 5).
  - Kaizena Flow's plan and the AI's cost count as the clone's costs in the scoreboard, whoever pays them.
- **As soon as possible**: Day 1 on Monday 4 January 2027, if the rehearsal's gate passes (sections 7 and 8).
- **The format: two brands, head to head** (format 2, section 3): a new name and address for the clone, scored on ratios.
- **After Day 100** the store owner may keep the clone indefinitely, or move all operations over to it and close the original (section 12).
- **The clone's name** is decided later, by Friday 4 December at the latest: the brand, look and texts are made in the week of 7 December.
- **Fulfilment**: the owner's warehouse ships the clone's orders as a paid service (C1).
- **Support channels**: email and the platform's built-in store support (the shop chat). WhatsApp, social messages and SMS are out of
  scope, so B5 is dropped.
- **The winning measures** are confirmed: two of three ratios, with at least 80 % of the ad money spent (3.3).
- **Public before Day 1** (section 13).
- **Up to ten stores** may run the challenge in parallel, each store with its own owner, warehouse and clone (section 14).

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

## 3. The format: the rules of the match

The format is how the competition is set up. It must be decided before anything is built, and it answers three questions:

- **Who the clone is:** the same shop under the same name, or a new shop with a new name and address.
- **Where its shoppers come from:** a share of the original's customers and the same ad money, or only what it earns from scratch.
- **How the winner is counted:** total revenue and profit, only the parts where both stores started level, or ratios such as margin.

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
| 1. One business, two operators, split demand | The store owner stays merchant and data controller of both stores; Kaizena Flow runs the clone as their processor (a data processing agreement). Same brand, same catalogue and the same supplier costs. Physical stock split into two pools at Day 0 in an agreed ratio. Customers and subscribers split at random into two halves (by a hash of the customer id); each store markets only to its half, and both sell to anyone who arrives. Equal ad budgets in each store's own ad account; neither bids on the brand's name. | Best: the comparable demand is split at random, as in an A/B test | Moderate: a list split, two ad accounts, one warehouse serving both. Shoppers may meet one name on two sites with different prices. |
| **2. Separate brands, head to head (chosen 14 November 2026)** | The clone gets a new name and domain, the same catalogue, costs and starting prices, and the same ad budget. It markets only to customers it wins itself. Physical stock split into two pools at Day 0. | Only on ratios: scored on margin, profit per krone of marketing and revenue per visitor, since the clone has no organic traffic or list | Low |
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
  - for the clone, its AI cost and Kaizena Flow's plan, whoever pays them.
- **Winner (format 2):** the store ahead on two of these three ratios over the 100 days:
  1. **Margin:** contribution profit ÷ revenue.
  2. **Profit per krone of marketing:** contribution profit before marketing ÷ marketing spend.
  3. **Revenue per visitor:** revenue ÷ sessions, which is conversion times the average order, counted the same way on both sites.
- **Reported beside the ratios:**
  - total revenue and total contribution profit;
  - the clone's weekly trend in the last 30 days, which says where it is heading for the decision of section 12.
- **No winning by not trying:** each store spends at least 80 % of the agreed ad money, so a ratio cannot be won by spending little.
- **Stock at the end:** goods bought during the challenge and not sold are valued at cost and are not a loss. A clearance in the last two
  weeks counts like any sale. The AI buys stock only within the owner's purchasing budget, so what is left at Day 100 stays within what the
  owner agreed to fund.
- **Referee:** an accountant both sides accept reconciles the scoreboard with payouts and bank statements at Day 50 and Day 100.

### 3.4 Fairness rules

- Neither side changes the other's prices, stock, ads or customers.
- Neither bids on the other's name in ads, and neither says it is the other.
- The clone markets only to customers it wins itself. It does not use the original's customer list, and it does not show the original's
  reviews.
- The original's owner works as they normally would.
- Refunds and escalations for the clone are handled by the store owner (decided 14 November 2026). They also run the competing store, and
  a slow refund costs the clone reviews, repeat buyers and chargebacks. So the agreement sets response times, and the scoreboard shows the
  owner's times for both stores side by side. Recommended: a refund decided within 24 hours, an escalation answered within 4 working hours.
  Refunds are judged against the store's written refund policy, and a decline against it is logged.
- Fixes by Kaizena Flow's engineers to the platform are not store interventions, but each is logged and published.
- The intervention log (4A5) is public to both sides.

## 4. What to build

Priorities:

- **P0**: without it, the challenge cannot run under its rule or cannot be judged.
- **P1**: without it, the AI has little chance to win.

Sizes are at the pace of recent units: S is a day or two, M about a week, L two weeks or more. Summed: A about 23 days, B 32 (B5 dropped), C 26,
D 52, E 39, F 28 (G is setup). The P0 workstreams alone are about 160 days.

Platform parity (CLAUDE.md): stock, fulfilment and returns cannot apply to Kaizena Flow, which sells plans. The profit goals, failover,
paging and rollback reach the platform's own autopilot in the same change.

### A. Challenge mode and the two human queues (P0)

| # | What | Size | Where |
|---|---|---|---|
| A1 | **Challenge mode**: a store setting with a start and end date that applies the preset of section 5. It locks the autonomy settings (a change is a logged intervention). A step that fails three times re-plans or is skipped with the reason instead of asking the owner. Kept refund items escalate instead of expiring after 7 days. The store owner is the clone's owner too and could change its settings, so the lock matters. | M | `autopilot-settings.ts`, `autopilot-runner.ts`, `autopilot-plans.ts`, `assistant_approvals` expiry |
| A2 | **Re-sort what is never automatic** for the challenge (table below). | M | `src/lib/autopilot-autonomy.ts`, `autopilot-autonomy.test.ts` |
| A3 | **The refund queue**: one list, with push to the phone (push today covers paid orders, quotes and activities only, `src/server/push.ts`). Each item shows the AI's recommendation, the evidence, and an amount worked out by the return's `refundFor()`, approved with one press. `refund_order` uses that amount and records the refund on the return. The queue reaches the store owner whoever the autopilot works for. Today the Decisions page shows a person only their own pending calls (`autopilot-overview.ts`: `ap.account_id = ` the person); plans run in the name of whoever made them, and events in the name of whoever last saved the settings. | M | `src/server/owner-tools.ts` (`refund_order`), `withdrawals.ts`, `push.ts`, the Decisions page |
| A4 | **The escalation queue**: the categories that may reach a person: the customer asks for one; legal (a complaint to an authority, a lawyer, a GDPR request, a chargeback); product safety; abuse; the AI could not help after two tries. Each handoff names its category and reaches the store owner on their phone. The escalation rate and the owner's time to answer are measured. | M | `support-tools.ts` (`handoff_to_human`), `docs/support.md` 233–240 |
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
| B5 | **Dropped (14 November 2026)**: the challenge's channels are email and the built-in store support, both already on the desk. WhatsApp, social messages and SMS replies are not built for it. | — | `commerce.support_conversations.source`, new channel adapters |
| B6 | **Returns run to the refund**: voluntary returns approved by policy; a `return_requested` event; in transit from tracking, received from the carrier's or warehouse's scan, inspected on the warehouse's confirmation; then the refund proposal to the queue. | M | `src/server/withdrawals.ts`, `return-jobs.ts`, `docs/returns.md` |
| B7 | **Reviews**: the AI answers reviews and switches review requests on. | S | `reviews-admin.ts` (`answerReview`) |
| B8 | **A quality bar before Day 1**: replay the original's last 90 days of support emails, with its owner's permission and names removed, through the agent; measure right answers, escalations and grounding. Target under 10 % escalated. | M | an offline run of `chat-agent.ts` |

### C. Orders, stock and fulfilment without a person (P0)

| # | What | Size | Where |
|---|---|---|---|
| C1 | **The owner's warehouse ships for the clone, as a paid service (decided 14 November 2026)**: it is set up as the clone's drop-ship supplier (D550), the one path that already runs alone. Each order is emailed to the warehouse after payment, or read by its own system through `/api/supply/v1` if it has one. The warehouse types the carrier and tracking number on a page from that email (no account needed), and the customer gets the shipped email from the clone. The warehouse's packing and typing is the service, not an intervention in the store. The handling fee per order is a cost in the scoreboard. | S to set up | `docs/drop-shipping.md`, `src/server/suppliers.ts` |
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
| E7 | **The scoreboard**: the referee's page with both stores, one definition, updated daily. The clone is read from the platform. The original is read from its platform's API (Shopify needs `read_all_orders` approved, plus refunds, transactions and payout fees, which the copy does not read today) or from a monthly P&L its accountant signs. The baseline is frozen before Day 1. Revenue per visitor needs sessions counted the same way on both sites: visit counting switched on in the clone (it is off by default), and the same GA4 set-up on both. | L | new; `src/lib/shopify.ts` scopes |

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
| G1 | **Copy, never Move**: Shopify's *Move my shop* issues new gift-card codes and emails every holder, and *Point it here* moves the domain. Use Copy only. Under format 2 the copy brings products, variants, pictures, prices, costs and the clone's stock pool. It leaves out customers, subscribers, orders, gift cards and reviews, which belong to the original's name (they come over only at a move, section 12). *Undo this copy* works only before the first real order. |
| G2 | **A brand of its own**: the AI proposes three names, each checked for a free domain and for trademarks; the store owner chooses, since they may keep it. The brand profile, look, logo and icon come from the brand tools (D330). Pages and product texts are written fresh in the new brand's voice, not replicated. The logo and icon are not copied from Shopify in any case. |
| G3 | **Approvals to start now** (outside lead times set the critical path): Shopify's protected customer data and `read_all_orders`; Meta's app review for ads management (and for WhatsApp or Messenger if B5 needs them); a Google Ads developer token; Stripe Connect onboarding of the merchant (identity is a person's); the warehouse or 3PL agreement. |
| G4 | **Domain and search**: the clone's domain is registered in the store owner's name. Its texts are its own, so the two sites are not duplicates. |
| G5 | **Ads to start from**: the original's Meta campaign structure is copied into the clone's ad account before Day 1, with the new brand's pictures and words. Both stores then start from the same campaigns, and the AI has budgets to move from Day 1 while D1 (campaigns of its own) is built. |

## 5. Challenge mode's settings

| Setting | Default today | Challenge |
|---|---|---|
| Levels | all *Ask me first* | catalogue, website, marketing, messages, money: *Just do it*; design and setup: *Do it and tell me* |
| AI budget a month | 5 USD | the rehearsal's measured cost × 2 |
| Deepest discount | 20 % | 20 %, and never under the margin floor |
| Largest price change | 10 % | 15 % a change, never under the margin floor |
| Emails to customers itself a week | 5 | support replies on a budget of their own; marketing emails on the broadcast budget |
| Largest ad raise | 20 % | 20 % a day; the ad account's monthly limit = the ad money the store owner puts in |
| Keep working toward goals | off | on; plans start themselves; goals reviewed every 3 days; up to 10 plans a week |
| React to what happens | off | on; a waiting customer looked at after 5 minutes |
| New budgets | none | broadcasts a week; purchasing a month and per order, set by the store owner |

The store owner sets the money limits (ad money a month, purchasing a month and per order, the margin floor) before Day 1, in the
agreement. Challenge mode then locks them. The store's pause stays the owner's emergency stop, but pressing it suspends the challenge,
because it is an intervention.

## 6. How the AI plays the 100 days

The phases are set as goals with due dates and a saved playbook (D350), so each review knows where it is:

1. **Days 1 to 20, the basics.**
   - Speed, the checkout and the shopper's language and payment methods.
   - Every flow on: cart reminders, welcome, after purchase, win-back, back in stock.
   - Feeds and shopping campaigns live.
   - Support answering in minutes.
   - A sign-up offer from the first visit, to build a list of its own.
   - Review requests from the first orders, since it starts with none.
   - The markets to add chosen from research.
2. **Days 21 to 60, grow what earns.**
   - New markets opened.
   - Ad budgets moved daily toward campaigns that make contribution profit, not just revenue.
   - Five tests running at all times.
   - Weekly broadcasts to the list it has built.
3. **Days 61 to 100, harvest margin.**
   - Spend that makes no contribution cut.
   - Prices set per market.
   - Discounts held to what pays.
   - Repeat buying pushed.
   - Slow stock cleared before Day 100.

## 7. Rehearsal and the Day 1 gate

The clone opens three weeks before Day 1 in challenge mode, with real shoppers, while the team watches. On the fast track that is 14 December
to 1 January: Christmas is a hard test, and the store owner handles the rehearsal's refunds and escalations too. Interventions are allowed
but logged, and each is fixed so it cannot happen again. The gate decides, not the date: if it fails, Day 1 moves a week at a time. Day 1
starts only when all of these hold:

- [ ] no intervention of the class *other* in the last seven days;
- [ ] escalated support under 10 %, and every escalation answered within the agreed time;
- [ ] no plan stalled longer than an hour;
- [ ] the AI's cost a day known, and the budget set from it;
- [ ] a failover drill (the first AI provider cut off) and a rollback drill passed;
- [ ] the scoreboard reconciles with payouts and the bank for the rehearsal weeks;
- [ ] the safety eval passed on the pinned prompts and model.

## 8. Timeline: as soon as possible

This is the first wave's timeline. With up to ten stores, a second wave starts on Monday 1 February 2027 (section 14.1).

The owner asked for the earliest start (14 November 2026). The earliest honest Day 1 is **Monday 4 January 2027**. Before then, the clone
would stall on every order email, parcel and return. The date holds only if three things happen in the week of 16 November:

- the store owner signs;
- the approvals of G3 start.

| When | What |
|---|---|
| 16 to 20 November 2026 | The agreement signed, including what happens after Day 100 (section 12): response times (3.4) and money limits (5). Stripe onboarding, the Shopify approvals and the warehouse agreement started. The referee named. |
| 16 November to 11 December | The Day 1 minimum (8.1) built in six streams side by side: (1) A, (2) B, (3) C, (4) E, (5) F, (6) the clone (G) with D2 and D5. Each stream is about 20 days of work in 20 working days, so the last items may land in the rehearsal's first week. |
| by Friday 4 December | The clone's name chosen by the store owner from the AI's three (G2), and its domain registered |
| by 11 December | The clone made under its new brand; the original's Meta campaign structure copied into the clone's ad account with the new brand (G5) |
| 14 December to 1 January | The rehearsal (section 7), with real shoppers, through Christmas |
| 2 to 3 January 2027 | The gate checked; figures reset; baseline frozen; prompts and model pinned |
| Monday 4 January 2027 | Day 1. Easter (28 March) falls inside the run for both stores. |
| January and February | The rest of section 4 lands as platform improvements announced to both sides before Day 1, each behind the deploy smoke (F5) |
| Monday 22 February | Day 50: the referee's mid-point reconciliation |
| Tuesday 13 April 2027 | Day 100 |
| Thursday 13 May 2027 | Day 130: refunds settled; the result |

### 8.1 The Day 1 minimum

**In before the rehearsal** (about 110 days of work):

- **A:** all six.
- **B:** B1, B2, B4, B6 and B8, and the part of B3 that cancels an unsent order and changes its address. (B5 is dropped.)
- **C:** all but C4.
- **E:** E1, E2, E3 and E6, and E7 in a simple form: the clone read from the platform, the original from a monthly P&L its accountant signs.
- **F:** all but the automatic part of F4. An hourly watch that pages the team is in from Day 1; until the automatic revert lands, the team
  reverts by hand, as a logged platform fix.
- **D:** D2 and D5.

**During the run:** the rest of B3, B7, C4, D1, D3, D4, D6 to D9, E4, E5, E7's read of the original's platform, and
F4's automatic revert.

**What a late D costs:** for the first weeks the AI grows with the tools it has:

- budgets on the copied campaigns;
- discounts and sale campaigns;
- flows switched on;
- page tests;
- more countries and languages.

Campaigns of its own (D1) and retention flows it writes (D4) arrive in January and February.

## 9. Risks

| Risk | What keeps it small |
|---|---|
| The traffic gap decides the result | Scored on ratios, not totals (3.3); at least 80 % of the ad money spent by each store |
| The two brands bid against each other for the same shoppers | Neither bids on the other's name; equal ad money; both see the same rules |
| The new name is weak, taken or confusing | Three names checked for domain and trademark; the store owner chooses |
| Stock runs out, or is sold twice | Stock pools, the forecast (C4), purchase orders within a budget (C3) |
| Ads overspend | The account's monthly limit, spend in the books daily (D2), profit-based ROAS in the review (E3) |
| A wrong answer to a customer goes public | Grounding rules, the eval, the replay bar (B8), clear escalation categories |
| The AI provider fails | F1, and the stall watch (A6) |
| A deploy breaks the store mid-run | F5 and the rollback runbook |
| The store owner, who runs the competing store, decides the clone's refunds and escalations | Response times in the agreement, measured for both stores on the scoreboard; refunds judged against the written refund policy; stock pools |
| The AI spends the owner's money badly | Limits the owner sets before Day 1 (ad money, purchasing, margin floor), locked by challenge mode; spend in the books daily (D2) |
| Four weeks of build leaves little slack | Only the Day 1 minimum (8.1); the gate decides, and a failed gate moves Day 1 a week at a time |
| Customers' data used without a basis | The clone uses only customers it wins itself; a data processing agreement between the owner and Kaizena Flow |
| Too few visitors for tests to say anything | Fewer, bigger tests; decisions on profit; no claim of cause where there is only a comparison (as D418 says) |
| Losing in public | Rules published before Day 1 and never changed; the announcement after the gate passes (section 13); with up to ten stores, the headline is how many the AI won, not one result |
| Ten stores at once overload the loop, the team or the AI provider | Waves (section 14), the loop scaled per store (H1), the challenge console (H2), two providers (F1) |

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

**Verdict (format 2):**

- **Margin and profit per krone of marketing:** with sections 4A to 4F built, the AI has a credible chance of winning both.
- **Revenue per visitor:** about even. The clone's visitors come mostly from ads, and paid visitors buy less often than returning customers.
- **Total revenue:** the clone will very likely be behind. It starts from zero.
- **What decides section 12** is the clone's trend over the last 30 days: whether a business the AI runs is growing faster than the original.
- **The parts that make it work:**
  - without D (growth), the AI can at best run the store as well as the owner;
  - without E (profit), it may grow and lose on margin;
  - without A, B, C and F, it cannot finish the 100 days under the rule at all.

## 11. Decisions for the owner

1. **The format** (decided 14 November 2026): format 2, two brands head to head, scored on ratios.
2. **Who presses the two buttons** (decided 14 November 2026): the store owner, with response times in the agreement. Recommended: 24 hours
   for a refund, 4 working hours for an escalation.
3. **The winning measure** (decided 14 November 2026): two of three ratios (margin, profit per krone of marketing, revenue per visitor), with
   at least 80 % of the ad money spent (3.3).
4. **Money** (decided 14 November 2026): the store owner funds the ad budgets and the stock of both stores and keeps the profit. They set the
   limits before Day 1.
5. **Fulfilment** (decided 14 November 2026): the owner's warehouse as a paid service (C1).
6. **The start date** (decided 14 November 2026): as soon as possible. Day 1 is Monday 4 January 2027 if the gate passes.
7. **The support channels** (decided 14 November 2026): email and the platform's built-in store support.
8. **Public or private** (decided 14 November 2026): public before Day 1 (section 13).
9. **The clone's name** (decided later): chosen by the store owner from the AI's three, by Friday 4 December at the latest.
10. **After Day 100** (open until Day 130): keep both brands, or move everything onto the clone and close the original; and if so, which
    name survives (section 12).

## 12. After Day 100: keep the clone, or move everything over

The store owner may keep the clone indefinitely, or move all operations over to it and close the original (14 November 2026). Both are
planned for now, so nothing built for the challenge is thrown away, and the result at Day 130 doubles as the owner's decision paper. It
shows:

- what the clone earned;
- where its trend points;
- what a move would bring and cost.

### 12.1 Built to be kept, from Day 0

- **The owner owns everything**: the name and domain are registered in the store owner's name, and the Stripe account, ad account and
  warehouse agreement are already the owner's company's.
- **The agreement says what happens at Day 100**:
  - the store, its customers, data, content, pictures and look are the owner's;
  - the plan price after Day 100;
  - the owner can leave with everything (D377, Leaving).
- **Challenge mode ends at Day 100.** The AI's levels and budgets become what the owner chooses: they can keep *Just do it*. The refund and
  escalation queues stay as they are.

### 12.2 Keeping both brands

- **Stock.** Two pools in one warehouse work, but two brands selling the same goods do better from one shared stock. Today Kaizena Flow has
  neither stock shared between an owner's stores nor a sync with another platform (C8). Two ways to get there:
  - move the original onto Kaizena Flow as a second store, and build stock shared between an owner's stores (M to L);
  - keep the pools and let the AI move units between them by purchase and transfer.
- **Ads.** The two brands keep bidding for the same shoppers. Once the challenge is over, the owner sets a split by market, channel or
  audience, and the AI keeps to it.
- **One assistant for both.** With both stores on Kaizena Flow, one owner account and one AI manager see both, and each store has its own
  autopilot and goals.

### 12.3 Moving everything over and closing the original

This is what the Shopify move (D445) is built for:

- customers with their consent evidence, and subscribers;
- the order history, redirects, pages and menus;
- gift cards re-issued: every holder gets an email, which is right at a real move;
- the domain pointed at the new store (*Point it here*).

WooCommerce's move has steps 1 to 5 built; the other platforms are plans only.

**First choice: which name survives.**

- **Keep the original's name and domain** (recommended in most cases: its search ranking, reviews and returning customers are the asset).
  - The clone is renamed to the original's brand, and the original's domain is pointed at it.
  - The clone's own domain redirects there.
  - The clone's customers and orders stay where they are.
- **Keep the new name.**
  - The original's addresses redirect permanently to the clone's, and its customers are told.
  - Search ranking takes months to follow.
  - The original's reviews were written for another name, so showing them needs a legal check.

**To do before a move:**

| What | Today |
|---|---|
| Reviews | Not copied from Shopify (spike S6); a CSV import exists |
| Subscriptions with saved cards | Cards cannot move without the payment provider's help (spike S8); subscribers are listed and invited to sign up again |
| Two customer lists made one | Each person's consent kept as they gave it, to the name they gave it to; a person on both lists counted once |
| Two stock pools made one | A transfer into one pool, counted by the warehouse |
| The original's apps and platform subscription | Ended after the move, once nothing reads them |
| The original's order history | Imported as history (numbered `C-`), never counted as the new store's sales |

**When:** after Day 130, once the result is in, never during the run. A move during the run would end the comparison.

## 13. Public before Day 1

The owner decided the challenge is announced before Day 1 (14 November 2026).

- **When:** after the rehearsal's gate passes (2 to 3 January for the first wave), in the days before Day 1. Not before: announcing a date the
  gate may move is a promise the AI has not yet earned.
- **What is published:**
  - the rules of section 3, unchanged from then on;
  - the stores taking part (with each owner's written consent to be named);
  - the referee;
  - how the result is counted.
- **What is shown during the run:** each store's three ratios weekly, and the count of human actions by class (A5). Totals are shown only
  where the store owner agrees, since they are the owner's business figures.
- **Where:** a page on kaizenaflow.com, built from `docs/site-design.md` and saved as a draft for the owner to publish (CLAUDE.md), with the
  figures read from the scoreboard (E7), never typed by hand.
- **Words:** every public claim passes the claims filter, and the page says the result compares two stores, not that the AI caused a
  difference (as D418 says).
- **The agreement** gives Kaizena Flow the right to publish the agreed figures and each owner the right to see them first.

## 14. Up to ten stores in parallel

The owner may run the challenge for up to ten stores at once (14 November 2026). The plan holds per store; what changes is scale.

### 14.1 Waves

Ten clones, ten agreements, ten Stripe onboardings, ten warehouses and ten ad accounts in four weeks is more than one team can do well while
building the Day 1 minimum. So the stores start in waves that run side by side:

| Wave | Stores | Rehearsal | Day 1 | Day 100 | Day 130, the result |
|---|---|---|---|---|---|
| 1 | 2 or 3 | 14 December to 1 January | Monday 4 January 2027 | Tuesday 13 April | Thursday 13 May |
| 2 | the rest, up to 10 in all | 11 to 31 January | Monday 1 February 2027 | Tuesday 11 May | Thursday 10 June |

Wave 2 gains from what wave 1's first weeks teach. Every fix lands on the platform for all stores at once, logged as a platform fix (3.4),
so no store gets an advantage another lacks.

### 14.2 Choosing the stores

Each store should:

- sell physical goods in the EU from its own warehouse;
- run on Shopify or WooCommerce today, the two moves that are built;
- answer customers by email and chat only;
- already advertise on Meta;
- sell enough for the ratios to mean something: as a guide, at least a few hundred orders a month;
- sell something different from every other store in the challenge, so no two clones bid against each other or against another original.

A mix of goods (fashion, home, food, sport) makes the result read as a rule, not a lucky case.

### 14.3 What ten stores need from the platform (workstream H, P0 for wave 2)

| # | What | Size | Where |
|---|---|---|---|
| H1 | **The loop scales per store**: today's limits are platform-wide. At most 3 plan steps a minute (`PER_RUN` in `autopilot-runner.ts`), 2 reviews and 2 events a run, and 2 follow-ups every five minutes are shared by every store, each turn up to 120 s inside a 300 s route. Ten busy stores need a run per store, side by side, with fair turns, so one store's long turn never delays another's waiting customer. | M | `autopilot-runner.ts`, `autopilot-reviews.ts`, `autopilot-events.ts`, `follow-up-runner.ts` |
| H2 | **The challenge console** for the platform team, on the platform admin: every challenge store's stalls, queues waiting and how long, AI cost against budget, interventions by class, and the three ratios. | M | `/admin/platform` |
| H3 | **The public page** of section 13, fed by the scoreboard. | S | a draft page on Kaizena Flow's site |
| H4 | **The onboarding kit**: the agreement template (response times, money limits, after Day 100, publicity), the clone runbook (G1 to G5) and the selection checklist (14.2). | S | `docs/runbooks/` |
| H5 | **AI capacity**: ten stores' AI use measured in wave 1, the providers' rate limits raised before wave 2, and both providers of F1 carrying load. | S | `src/server/ai.ts` |
| H6 | **One challenge playbook** for every challenge store, pinned like the prompts (F5): a change is a platform fix, logged and applied to all. | S | saved skills (D350) |

The platform's own team carries the load the stores do not: one person on call per week for pages (F3), who never touches a store's
operations (that would be an intervention), only the platform.

## 15. Progress

Each item of section 4 moves here when it is built, with its decision.

| Item | State | Decision |
|---|---|---|
| A1 Challenge mode | Built: the dates and budgets, the preset, the lock with the pause audited as an intervention, a third failure and a question skipped. A screen to set it waits for H2; the dates are UTC. | D597 |
| A2 Never automatic, re-sorted | Partly: broadcasts within a week's budget, support answers on a daily budget, money back to customers kept for the person. The money-free order change and price rules are still to do. | D597 |
| F2 Limits for a business | Built: the AI budget from the challenge, the autopilot's turns apart from the owner's, events limited per kind, plans paused by the budget started again. | D597 |
| D5 Margin floor | Built: prices, discounts and campaigns under the owner's lowest margin wait for a yes; the challenge's own floor is 10 % by default. | D598 |
| E2 Profit goals | Built: contribution and margin over 30 days, net sales and contribution since a first day. | D599 |
| E3 The review sees money | Partly: `profit_overview` (contribution, margin, profit per krone of marketing, per visitor, the month's forecast) in the review's and events' tools; the budget and the campaigns report still have no tool. | D599 |
