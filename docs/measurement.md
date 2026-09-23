# Measurement design

How Kaizen Store decides whether a change, especially an AI feature, earns its
place. The evidence and sources are in [`plan.md`](plan.md) ("Measure AI with
randomised holdouts").

## Principles

1. **Randomise who is eligible, then compare everyone assigned.** Never compare
   people who used a feature with people who did not: shoppers who open a chat
   were already more likely to buy.
2. **One north-star metric: revenue per assigned visitor** (gross margin per
   assigned visitor once costs are in the database).
3. **Guardrails can stop a winner:** return and refund rate (30–60 days later),
   discount rate, LCP and INP, checkout error rate, support contacts,
   unsubscribes.
4. **Keep 5–10% of visitors in a long-running holdout** that sees no AI
   features, to measure their combined effect.
5. **Check the split every day** (sample-ratio mismatch). A skewed split means
   broken data, not a result.
6. **Run for at least two full weeks** and look at each week separately, to
   catch novelty effects.

## Assignment

- Variants are assigned **on the server**, in route handlers or server
  components, never in the routing middleware (which runs outside the EU).
- The assignment key is the customer id when signed in, otherwise an id the
  store already needs, such as the cart id. Whether that id counts as "strictly
  necessary" under ePrivacy, so that no consent is needed, is open item O7.
  Until counsel answers, only visitors who consented to analytics are enrolled.
- Assignment is a deterministic hash of experiment key and assignment key, so
  it needs no stored state and gives the same answer on every request.
- Every exposure is logged as an `experiment_exposed` event the first time a
  visitor actually meets the change.

## Events

Server-side events are the source of truth for orders and money; browser events
cover browsing behaviour, subject to consent. Names are `object_action`, in the
past tense.

| Event | Where | Key properties |
|---|---|---|
| `page_viewed` | Browser | path, market, locale |
| `search_submitted` | Server | query, result_count, latency_ms, search_mode (keyword, semantic or hybrid) |
| `search_result_clicked` | Browser | query, product_id, position |
| `product_viewed` | Browser | product_id, variant_id, price_minor, currency |
| `cart_item_added` | Server | cart_id, variant_id, quantity, price_minor, source (for example search or assistant) |
| `checkout_started` | Server | cart_id, value_minor, currency |
| `order_placed` | Server | order_id, value_minor, tax_minor, currency, market |
| `order_refunded` | Server | order_id, refund_minor, reason |
| `withdrawal_submitted` | Server | order_id, line_count |
| `assistant_message_sent` | Server | conversation_id, turn, model, latency_ms, cost_micros, grounded |
| `assistant_product_suggested` | Server | conversation_id, product_ids |
| `experiment_exposed` | Server | experiment, variant, assignment_key_type |

Rules:

- Money is always minor units plus a currency, as in the database.
- No names, email addresses or free text that could contain personal data in
  analytics events. Search queries are kept, truncated to 200 characters.
- Every event carries `market`, `locale`, and the variants the visitor is
  assigned to.

## Traffic is the constraint

At a 2% conversion rate, detecting a 10% relative lift needs about 81,000
visitors per variant (two-sided α = 0.05, 80% power). Until traffic supports
that, tests target metrics with higher baselines (search-to-product,
add-to-cart, zero-result rate), use bolder changes, and state their decision
rule before they start.

## AI quality

Separate from A/B tests, every AI change runs an evaluation set before release
(Phase 2 onwards):

- **Code checks first.** Every price, stock level and delivery figure in an
  answer matches the database at answer time; every product id exists and can
  be bought; the AI disclosure appears on the first turn; no personal data is
  echoed back.
- **A model as judge only where code cannot decide** (groundedness, policy),
  checked against human labels first.
- **The set is multilingual** and includes reviews with injected instructions.
