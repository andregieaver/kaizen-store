# Admin redesign, round 38: Staff alerts, a new cart reminder and Marketing on a phone

Decision D728, 17 November 2026. The boards are on the design canvas of round 38.

After round 37 no store page on a phone was above 2,250 px but the product layout builder's preview, which round 35 already reworked. The
three tallest after it:

| Page | Before | After |
|---|---|---|
| Staff alerts (`/settings/notifications/staff`) | 2,199 px | 972 px |
| A new cart reminder (`/cart-reminders/new`) | 2,192 px | 981 px |
| Marketing (`/marketing`) | 2,128 px | 974 px |

Below 640 px wide, each page changes as described here; from 640 px it is as before.

## Staff alerts (`StaffAlertsForm`)

- **One line says what the page is for.** The defaults note is one line too.
- **Each person is a row** that says what they get, for example *7 of 10 · New order, Return requested +5* or *Nothing*. Their boxes open
  under the row, one line per alert. Where a person's role may not read an alert, the line says so instead of offering a box.
- **The store's contact address is a row.** When there is none, the row says so.
- ***More about these emails*** opens the page's full explanation and the privacy note: staff emails never carry a customer's details.
- **Briefing, Analytics alerts and Send a test are rows of one card**, each saying what is chosen. Save follows them.
- From 640 px the table of boxes, the explanations and the order of Save and the tests are as before.

## A new cart reminder (`ReminderEditor`)

- **When it goes stays as it was**, without its three lines of help.
- **The discount code is a row** (*None*, or the code), opening the choice and its help.
- **Each language is a row with its subject**, and *Edit* opens that language's four fields with *Done*. If the browser finds a required
  field empty on Save, the fields open.
- **The preview is a row** (*As it is sent: Norge (nb-NO)*) that opens the email and the test.
- The same editor writes Kaizena Flow's own plan reminders, so `/admin/platform/plan-reminders` changes the same way.

## Marketing

- **The three starts are rows of one card**: the icon, the name, one short line and *Set it up*. Only the first keeps the green button.
- **Running now is left out while nothing runs.** The lead already says so.
- **Your list and Tell everyone something are two rows of one card**, with *See* and *Write*.
- **Every tool shows its first six**, and *+6* shows the rest.

## How this differs from the boards

- **A new cart reminder:** Save comes before the preview's row, not after it. The preview stays beside the form from 1024 px, so it is not
  moved into the form.
- **A new cart reminder:** *Switched on* stays a box under the time rather than words in a line.
- **Staff alerts:** each person's line counts every alert the store has (10), not 9, and names the first two.

## Platform

- Kaizena Flow's plan reminders use the same editor, so they change with this round.
- Kaizena Flow has no staff alerts page of its own, as it has no orders, returns or stock. Its marketing has no first page like the store's.

## Tests

- Lint, types and all unit tests pass.
- `notifications.spec.ts` and `automations.spec.ts` pass against a local build.
