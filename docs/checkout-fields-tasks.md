# Checkout fields: tasks for later

Written 10 November 2026; reordering questions built 13 November 2026, the rest not started. Builds on checkout questions (D357, `src/lib/checkout-rules.ts`,
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
- [ ] **Add, remove and hide** already work (save, delete, switch). Check the editor makes them obvious to Homer: one
      *Add a question* button, a visible on/off switch, and delete behind a confirm.
- [ ] **Decide about the standard fields.** Can an owner hide or require Stripe's own fields, such as phone, company
      name or a second address line? This depends on what Stripe's form lets us set (`phone_number_collection`,
      the Address Element's options, `custom_fields` on a Checkout Session, Mollie's own page). List what each
      provider allows before promising it, and say plainly in the editor which fields are the payment provider's.
- [ ] Admin API (`checkout:write`): a move route, or `position` on the existing write routes.
- [ ] AI manager: tools to list, add and move questions. No tool reaches them today.

### 2. Field width: left, right or full width

- [ ] An additive column `checkout_fields.width` (`full` | `half`, default `full`). Two `half` questions next to each
      other share a row; one alone takes the row's left half. On a phone every question is full width.
- [ ] Homer sees no width setting until he asks for it. The default is full width, and the half and full choice is under
      the question's *Customise*.
- [ ] Should "left" and "right" be stored as such, or only "half" with the order deciding the side? Recommended: only
      `half`, so moving a question can never leave a right-hand field alone on a row.
- [ ] Show the layout in the editor's preview of the cart.

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
