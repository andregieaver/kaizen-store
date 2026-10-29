# Wave 13: loyalty rewards, delivery price rules, structured invoices (decisions D401 onward)

The contract for wave 13, written on 2026-10-29 after wave 12 (D395 to D400), from the parity tracker as rated that day
(`docs/parity/rows`). The open rows of bucket A were read again that day; most wait on a person's review of hand-written texts, which
code does not close. What code can still close or move:

- `customers.loyalty-and-rewards` (weight 3): rewards other than a price reduction, and points for a birthday.
- `platform.custom-logic-functions` (weight 2): the rules hide, rename and order delivery options and leave payment methods out, but
  cannot price a delivery; its gap text still names reordering, which D399 built.
- `orders.invoices-and-vat-receipts-for-orders` and `international.legal-invoices-and-credit-notes-for-orders` (weight 4): structured
  e-invoices are named as not built (Germany's B2B issuing mandate starts in 2027 and 2028; Norway's public sector takes EHF/Peppol).
- PSI CODE-02: the analytics loaders that still read untyped rows.

## 1. The units, in the order they are built

| Unit | Decision | What | Rows or items |
|---|---|---|---|
| A | D401 | Loyalty rewards redeemed for a code (free shipping, a free product, an amount off) and a birthday credit | `customers.loyalty-and-rewards` |
| B | D402 | Checkout rules that price a delivery option (a surcharge, a reduction or free) | `platform.custom-logic-functions` |
| C | D403 | Invoices and credit notes as EN 16931 XML (UBL 2.1, Peppol BIS Billing 3.0) | the two invoice rows (stay partial: review) |
| D | D404 | The remaining analytics money reads through `typedRows()`/`checkedRows()` | PSI CODE-02 |

## 2. The units

### A. Loyalty rewards and a birthday credit (D401)

**What is missing.** Credits come off a basket as a price reduction only; a customer cannot spend them on free shipping or a free
product, and nothing is given for a birthday.

**Design.**
- **Rewards** (`commerce.bonus_rewards`, the store's, at most 10): a name, a cost in credits (the program's currency), a kind (`free_shipping`,
  `product`: one unit of a product free, `amount`: an amount off per country) and on or off; written only by `src/server/bonus-rewards.ts`
  (`marketing:write`, audited). Each reward owns one discount code of the store's (D299, `unique_codes`, hidden from the codes list by
  `discount_codes.reward_id`), so what a reward takes off a basket is the code engine's (`applyDiscount()`, used by `cartSummary()` and
  `placeOrder()` alike): nothing new in checkout. A product reward is a 100 % code on that product limited to one unit
  (`discount_codes.max_units`, the dearest unit first: never more than one unit free).
- **Redeeming** is the signed-in customer's own press on My account's credits (`redeemReward()`): under the customer's ledger lock the
  cost is taken by `commerce.bonus_redeem_reward()` (a ledger entry of kind `reward`, exact, idempotent per press), one generated code
  (`discount_code_items`, single use) is made in the same transaction and kept for the customer (`bonus_reward_codes`), shown on My account
  until it is used or ends (`ends_at` from the program's expiry, else a year). Credits spent on a reward are not given back when the code
  is not used (said before the press).
- **Birthday credit** (`bonus_settings.birthday_minor`): a customer may give their birthday (month and day only, never a year:
  `customers.birthday`, on My account) and is given the credit once a year on that day by the daily bonus job (`kind = 'birthday'`, keyed
  `birthday:{customer}:{year}`), only while the program is on and only after the birthday was given at least 30 days before (so it is not
  typed to claim one). Personal data: the register, the export's profile and erasure clear it.
- **Not given, by decision**: credits for a newsletter sign-up (consent is not bought, GDPR Art. 7(4)) and for a review (D301).
- Words in four languages by hand (`m.bonus`), the owner's in the `loyalty` catalogue; a scenario in `checkout-kinds.int.test.ts` (a reward's
  code in kroner and euro), a ledger test, an e2e of the redeem press.

### B. Checkout rules that price a delivery option (D402)

**Design.** A rule's effect may be `delivery_price`: the options it names cost a percentage more or less, or a fixed amount more or less per
country, or nothing (`free`), never below zero, laid over the offer by `rulesOnOffer()` (so `cartSummary()` and `placeOrder()` agree, a
scenario in kroner and euro); the shipping's VAT follows the delivery as ever (never a rule's). The order keeps the rule that changed it
(`orders.checkout_rules`). The row's gap text is re-read.

**As built (D402).** As designed; the order keeps the rules in `orders.checkout_rules_applied`, and what ships is sorted cheapest first again
after pricing, so the default is the cheapest as it was before rules.

### C. Invoices as structured data (D403)

**Design.** Each invoice and credit note can be fetched as EN 16931 XML in UBL 2.1 with Peppol BIS Billing 3.0's customisation
(`src/lib/einvoice.ts`, pure, from the frozen snapshot only: never a figure worked out again), from the invoice's admin page and the Admin
API; the totals and VAT breakdown are the snapshot's, the seller's and buyer's VAT numbers and addresses as frozen, the currency the
document's, the VAT in the seller's currency as `TaxCurrencyCode` where they differ. A document that cannot be one (a missing seller VAT
number where VAT was charged, a credit note's invoice missing) says why instead. Checked against the schema's rules we can test in code
(the BR- and BR-CO- sums); sending through a Peppol access point is not part of this unit.

### D. The remaining analytics money reads (D404)

The loaders in `src/server/analytics-*.ts` that read money through `setBased<Row>` describe their rows and go through `checkedRows()`.

## 3. Rules for every unit

The house rules of `docs/wave-11-core-and-psi.md` section 3 hold, as in wave 12.

## 4. Waiting on the owner

As in wave 12 section 4.
