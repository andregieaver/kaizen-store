# Checkout fields: tasks for later

Written 10 November 2026; reordering questions, the confirm before deleting, `position` in the Admin API and the AI manager's tools built 13 November 2026; the
standard fields and tasks 2 to 4 not started. Builds on checkout questions (D357, `src/lib/checkout-rules.ts`,
`src/server/checkout-rules.ts`, `commerce.checkout_fields`, Settings → Checkout rules). Read the rule in
`docs/rules/admin/commerce.md` (*Checkout rules and questions*) before starting any of these.

## Where we are today

- An owner can add, edit, switch off and delete a question. There are two kinds (text or tick box), each required or
  not, with words per language, and at most 10 per store (`FIELDS_MAX`).
- The cart shows them above the checkout button. Answers are kept on the cart and copied to the order by
  `placeOrder()` (`orders.checkout_answers`), shown to staff and in the export, and treated as personal data.
- Questions are asked in their `position`. Since 13 November 2026 the owner moves them in the editor: drag by the handle (or the
  keyboard on it) or the up and down buttons, each move saved at once by `moveCheckoutField()`.
- The standard contact and address fields (email, name, address, phone) belong to Stripe's form, not to us. We only
  choose whether an address is asked (not for pickup) and a phone (only for local delivery).
- Express checkout is off for any store with a question (`expressOn()`, D373).

## Tasks

### 1. Add, remove, reorder and hide checkout fields

- [x] **Reorder questions.** Built 13 November 2026: `moveCheckoutField(member, id, to)` beside `moveCheckoutRule()` (the
      store's questions locked while their places are written, audited `shipping.checkout_field_moved`, the new order worked
      out by the pure `movedTo()`), and `FieldList` drags by a handle with dnd-kit, moves with the keyboard on it, and has up and
      down buttons as the one-press alternative to dragging. The list shows the new order at once (`useOptimistic`).
      `listCheckoutFields()` and the cart already read by `position`. Held by `checkout-rules.test.ts`,
      `checkout-rules.int.test.ts` and `e2e/signed-in/checkout-questions.spec.ts`.
- [x] **Add, remove and hide** already work (save, delete, switch). Checked for Homer 13 November 2026: one *Add a question*
      button and a visible on/off chip with its switch were there; Delete now asks first, on a line under the question
      ("Delete …? Answers already given stay on their orders.", Delete or Keep it), and so does deleting a rule on the same page.
- [ ] **Decide about the standard fields.** Researched 13 November 2026 (findings below); the decision and the build are next.
      Can an owner hide or require phone, company name or a second address line? It depends on which page asks them.

#### What each provider lets us set (13 November 2026)

Read in the code and in each provider's own documentation that day (Stripe API version `2026-10-28`).

**Which page asks what today.**

- **Stripe, on our page** (`ui_mode: "elements"`, production's `platform_settings.checkout_ui` is `custom`): Stripe draws the email
  (`ContactDetailsElement`, email and Link only), the delivery address (`ShippingAddressElement`) and the payment details
  (`PaymentElement`). Everything else on the page is ours.
- **Stripe's own page** (`hosted`: the platform setting, and always for draft, change, exchange, terms and company-approval pay links).
  Stripe draws every field there.
- **Mollie** (D292): Mollie's hosted page asks only for payment details. Name, email, phone and the delivery address are already our
  own form on the cart (`cleanPayer()`, `PayerNeeds`), so they are ours to change today.

**Stripe, on our page.** Every field outside the payment details can be ours:

| Field | How | Required or optional |
|---|---|---|
| Phone | `phone_number_collection.enabled`. Stripe draws no phone field in this mode: "you collect the phone number on your checkout page" and pass it with `checkout.updatePhoneNumber()` or `confirm({ phoneNumber })`. | Ours to decide on our field |
| Person's name | `name_collection.individual` (`enabled`, `optional`), our own field and `checkout.updateIndividualName()`; Stripe has no element for it | `required` or `optional` |
| Company name | `name_collection.business` (`enabled`, `optional`), through Stripe's Tax ID element or our own field and `checkout.updateBusinessName()` (with `fields.businessName: 'never'` on the Tax ID element) | `required` or `optional`; required moves wallet buttons down or turns them off |
| Delivery address | `ShippingAddressElement` takes only `contacts`, `display.name` (`full`, `split`, `organization`) and `autocomplete` | It cannot hide line 2, add a phone or change what is required |
| Delivery address, our own form | `checkout.updateShippingAddress({ name, address: { country, line1, line2, city, postal_code, state } })` | Ours: line 2 can be hidden; we lose Stripe's address autocomplete |
| Billing address | `billing_address_collection`: `auto` or `required` (required today for a company order, D159) | Only those two |
| Extra questions | `custom_fields` (at most 3) "can't be set if `ui_mode` is `elements`" | Not usable on our page; our own questions (D357) are the way |
| Tax ID | `tax_id_collection` and the Tax ID element | n/a |

**Stripe's own page.** It follows only the session's settings: `phone_number_collection` (required when on),
`billing_address_collection`, `name_collection`, `shipping_address_collection.allowed_countries`, and `custom_fields` (3 at most:
text, numeric or dropdown). Line 2 and the address's other fields stay Stripe's.

**Wallets** (Express Checkout Element, Apple Pay, Google Pay) give their own phone and address; `updatePhoneNumber()` and
`updateShippingAddress()` are "not used for express checkout payments". Express is already off for a store with a question (D373).

**Mollie.** `billingAddress` and `shippingAddress` take `title`, `givenName`, `familyName`, `organizationName`, `streetAndNumber`,
`streetAdditional`, `postalCode`, `city`, `region`, `country`, `email` and `phone`. The name, street, postal code, city, country and email
are required only for `alma`, `billie`, `in3`, `klarna` and `riverty` (`organizationName` for `billie`). Those pay-later methods are left
out today (`MOLLIE_LEFT_OUT`), so every contact and address field of a Mollie store is ours to show, hide or require. If pay-later is ever
let in, those fields become required for it.

**A gap found on the way.** A local-delivery order turns on `phone_number_collection` (`payment-session.ts`) so the driver has a number.
But on our page nothing collects a phone or calls `updatePhoneNumber()`, and `ContactDetailsElement` asks only for the email. So a
local-delivery order paid by Stripe on our page arrives without a phone (or, unverified, is refused by `confirm()`). Production has no
local delivery areas yet (13 November 2026), so no order has met it. A Mollie store asks the phone itself (`PayerNeeds.phone`).
**Fixed 13 November 2026:** the checkout page asks *Phone for the driver* (required) for a local delivery and passes it to
`confirm({ phoneNumber })` in E.164 (`e164Phone()` in the zod-free `src/lib/phone.ts`, a national number read in the market's country).

**Recommendation.**

1. ~~Fix the gap first~~ Done 13 November 2026: a phone field on our checkout page, required for local delivery, passed with `confirm()`.
2. ~~Then one setting per field~~ Done 14 November 2026 (D594) for the phone and the person's name, kept on our own order; the company name
   stays the business buyer's form (D63). As first written: one setting per field, Off, Optional or Required: phone, the person's name and the company name, through
   `name_collection` and our own fields on Stripe and `cleanPayer()` on Mollie. Lisa's step away; Homer keeps today's defaults.
3. Address line 2 only with our own address form on Stripe (`updateShippingAddress()`), which costs Stripe's autocomplete. Leave it
   until an owner asks.
4. In the editor, say plainly that Stripe's own page (and every pay link) follows only phone and names, and that wallets give their own.

Sources:
- [Create a Checkout Session](https://docs.stripe.com/api/checkout/sessions/create)
- [Collect phone numbers, Elements](https://docs.stripe.com/payments/checkout/phone-numbers?ui=elements)
- [Collect customer names, Elements](https://docs.stripe.com/payments/advanced/collect-names)
- [Shipping Address Element for Checkout](https://docs.stripe.com/js/custom_checkout/create_shipping_address_element)
- [`updateShippingAddress`](https://docs.stripe.com/js/custom_checkout/update_shipping_address)
- [Contact Details Element](https://docs.stripe.com/js/custom_checkout/create_contact_details_element)
- [Mollie, Create payment](https://docs.mollie.com/reference/create-payment)

- [x] Admin API (`checkout:write`): `position` on `PATCH /checkout/fields/{id}` (alone, or with `enabled` or the whole question),
      through `moveCheckoutField()`; contract 1.14 in the developers' changelog. Built 13 November 2026.
- [x] AI manager: `checkout_questions` and `save_checkout_question` (add, reword, switch, move; the owner's yes first), built
      13 November 2026 through the page's writers. Deleting stays on the page.

### 2. Field width: left, right or full width

Built 14 November 2026 (D596).

- [x] An additive column `checkout_fields.width` (`full` | `half`, default `full`). Two `half` questions next to each
      other share a row; one alone takes the row's left half. On a phone every question is full width (from a tablet's width up
      halves share a line; a container query drew them the wrong way round, as the cart's column is narrower on a desktop).
- [x] Homer sees no width setting until he asks for it. The default is full width, and the half and full choice is under
      the question's *Customise* (open from the start only for a question already half width).
- [x] Only `half` is stored, the order deciding the side, so moving a question can never leave a right-hand field alone.
- [ ] Show the layout in the editor's preview of the cart. The editor has no cart preview; the list says *Half width* on such
      a question. A drawn preview waits until the editor has one.

### 3. Many tick boxes at once, for example allergens on food orders

- [ ] A new kind, `checklist`: one question with several options to tick, each option with words per language,
      required or not. It counts as one question against the limit (14 allergens as single tick boxes would pass the
      limit of 10 on their own).
- [ ] A ready-made list: **the EU's 14 allergens** (Regulation (EU) No 1169/2011, Annex II: cereals containing gluten,
      crustaceans, eggs, fish, peanuts, soybeans, milk, nuts, celery, mustard, sesame, sulphites, lupin, molluscs),
      written in nb, sv, da and en. Also an optional "None of these" option that clears the others.
- [ ] Keep the answer as the options ticked, with their words in the store's main language at the time of the order
      (`CheckoutAnswer` gets a `string[]` answer), and change `readAnswers()` and `answersByField()` to match.
- [ ] **Check the privacy side first.** A customer's allergies can be health data (GDPR art. 9). Decide, with the
      privacy texts (D162), whether such a question needs its own explicit consent line, a shorter retention, or a note in
      the store's privacy page. Do not ship the allergen preset before this is settled.
- [ ] Should allergens be asked per order or per product line? Recommended: per order first, since kitchens read the
      order as a whole.
- [ ] Show the ticked allergens clearly on the order page, the packing slip and staff alerts, not only in the Full
      profile.

### 4. More field types for edge cases

Candidates, each a kind in `fieldInputSchema` and in `cleanAnswers()`, the editor, the cart, the order page, the export and a test:

- [ ] `select`: one choice from a list, drawn with `Dropdown` (D82), never a native select.
- [ ] `radio`: one choice, all options visible.
- [ ] `textarea`: several lines (longer than today's one line of 500 characters).
- [ ] `number`, with a lowest and highest value.
- [ ] `date`, with earliest and latest days (check first that bookings, D65, or delivery days do not already cover the need).
- [ ] `email` and `phone`, checked for shape (for example a gift recipient's contact).
- [ ] `file`: probably not, since the cart is a pay route (D158) and an upload brings storage, scanning and size limits.
      Only build it if a real store asks.
- [ ] **Conditional questions:** show a question only for some markets, delivery methods or baskets (a product,
      category or tag), using the same conditions as checkout rules (`conditionHolds()`), so there is one condition
      model and not two.

## Common to all four

- Migrations only add columns or kinds; the running code must keep working until the deploy finishes.
- Tests: `src/lib/checkout-rules.test.ts` (answers checked) and `src/server/checkout-rules.int.test.ts` (from the cart to
  the order). Add a PGlite test in `src/db/commerce.test.ts` for any new check constraint.
- Express checkout: decide whether simple, optional questions can stay off the wallet's sheet so express is not lost
  for every store with a question.
- Store copy (`store-copy-rules.ts`), the export (`store-export.ts`), erasure and anonymising must carry the new kinds.
- Platform parity: Kaizena Flow's own checkout (plans through Stripe) has no questions today. The decision for this
  work must say whether the platform gets them or why not (`docs/platform-parity.md`).
- Record the work as a new decision in `docs/decisions.md` and update the parity row
  `checkout.checkout-extensibility-ui-extensions-functions`.
