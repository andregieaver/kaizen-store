# Admin redesign, round 20: customers on a phone

Decision D671, 16 November 2026. The boards are on the design canvas of round 20 (today at 390 px and a phone proposal for each page).
On a phone, Customers opened on three tiles a screen tall, a customer's orders carried pictures 72 px high each, and adding a customer
was eleven open fields before its button.

## Customers (`/admin/{store}/customers`)

- The three figures (new this month, came back, spent on average) share one row on a phone, small; from 640 px they are the tiles as before.
- The views (All, New, Came back, Subscribed) scroll on one line instead of breaking inside their pills.
- On a phone the rows have no tick boxes until *Select*; *Done* clears the choice. From 640 px the tick column is there as before.

## A customer (`/admin/{store}/customers/{id}`)

- Orders, spent and customer since in one row on a phone.
- Each order is one line on a phone, with a small picture of what was bought; the newest five show, then *All {n} orders* opens Orders
  searched by the customer's email. From 640 px the large pictures and every order stay.

## Adding or changing a customer (`CustomerForm`)

- Email, name and phone first; the address and the company each a row (*Add*, or what is saved with *Change*) that opens its fields, open
  already where the person has them. Every field is sent whether its row is open or not. On every screen.

## What differs from the boards

- The waiting order keeps its button rather than becoming one line.

## Tests

`e2e/signed-in/customers-staff.spec.ts` opens the address row before filling it.
