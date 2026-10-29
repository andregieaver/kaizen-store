# Consolidation: proving what exists (from 29 October 2026)

After wave 13 the owner paused feature waves (evaluation of 29 October). The phase's list, in order, with the owner's answers:

1. Restore drill: postponed by the owner (cost).
2. Payment runs in Stripe test mode on a real store: run by the AI, on production (section 1).
3. A live AI eval and its recording in CI.
4. Legal and accounting texts checked against official sources (Lovdata, Riksdagen, Retsinformation, EUR-Lex, the tax authorities), in place of a
   lawyer and an accountant, by the owner's decision.
5. Pilot runs: the AI running a store end to end in test mode.
6. Threat model and processor agreements.
7. A shorter rulebook (CLAUDE.md).
8. PSI re-scored.

The owner's principle: the system aims at full automation, so the AI (the agent building it, the AI manager or the platform's own jobs) should be able to
run every live check itself; where it cannot, that is a gap to close.

## 1. Payment runs on production (29 October 2026)

Driven in a real browser (Playwright) against the dev store at its own domain, Stripe test mode, cards from Stripe's test set, email
`delivered@resend.dev` (Resend's test sink, no person). Results read back from the production database (counts and order numbers only).

| Path | Order | Outcome |
| --- | --- | --- |
| Goods, card 4242, paid and returned to the order page | 1014 | Passed: paid, VAT 69.60 of 348.00 kr, facts read (card, Visa, normal risk), Kaizena Flow's fee 6.93 kr (1.99 %), confirmation and staff email delivered, no invoice (test mode) |
| Card declined (4000…0002) | 1016 | Passed: "Kortet er avvist" on the checkout, the order left waiting and later cancelled |
| 3-D Secure (4000…3155) | 1017 | Passed: challenge completed, order paid |
| Dispute card (4000…0259) | 1015 | Failed, then passed after the fix below: the dispute reached the store (needs response, 348.00 kr, fraudulent), the staff email was sent |
| Appointment (massage, 890 kr) | 1024 | Passed: time held, paid, the order page says it can no longer be changed (inside the 24-hour limit) |
| Stay (cabin, 2 nights, deposit) | 1025 | Passed: 3,980 kr, VAT 426.43 kr at 12 %, 1,194 kr deposit paid, 2,786 kr at the venue |
| Stay cancelled by the shopper | 1025 | Passed: deposit refunded through Stripe, booking cancelled, email delivered; wording fixed (below) |
| Rental (bike, 2 whole days) | 1026 | Passed: 900 kr, VAT 180 kr |
| Subscription box | – | Not run: the demo box is sold out in the dev store |

### Found and fixed

| Finding | Severity | Fix |
| --- | --- | --- |
| Stripe's endpoints were registered at `kaizenstore.cloud`, which now answers 308; Stripe follows no redirect, so no Stripe event reached the platform since the move (disputes, refunds made in Stripe, payouts, account status, bank payments). Orders were marked paid only by the order page's own read. | Critical | `keepStripeWebhooksCurrent()` in the five-minute dispatcher moves each endpoint to the site's address (moved in production at 21:30 UTC; events arrive and are processed). |
| A reader took `payments.test_mode` for a Stripe payment's mode (it is the account's): a test purchase would be sent to ad platforms as real. | High | `testPayment()` asks as `invoice_eligibility()` does. Two more readers (closing a store, switching off selling abroad) count test orders as obligations for the same reason; that errs on the safe side and was left as it is after the change broke their tests. |
| CI's integration job hit its 30 minutes, which cancelled run 741 and its release. | High | The integration tests run in three shards. |
| Cancelling a stay or rental asked to "cancel the appointment" (nb, sv, da) and the booking emails called every booking an appointment. | Low | Booking words in four languages. |
| Past days in the stay and rental calendars are announced as "booked" to screen readers. | Low | Open. |
| Each abandoned checkout becomes an order (pending, later cancelled) and takes an order number. | Design | Open: by design (gap-free numbers, D141), but the owner's list shows them; to review. |
| The real fee is read once just after payment; when Stripe's balance transaction is not there yet, only a payout fills it in. Stripe's own fee reads 0 on test payments. | Open | To check when the first test payout is read. |

### What the AI could not do, and the answer

Staff actions (a refund by staff, marking sent, capture later, order changes, exchanges) need a signed-in member, and the Admin API and the AI manager keep
refunds for a person's yes, so neither the agent nor the platform could run them. Live drills (D406) are the platform's own way: a platform admin (or the
platform's AI) asks for a store's drills, and the five-minute dispatcher runs them through the screens' own functions on that store's test payments only.
