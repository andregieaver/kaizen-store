# Admin redesign, round 30: Invoicing, Customers and Cookies on a phone

Decision D703, 17 November 2026. The boards are on the design canvas of round 30. After round 29 no store page was taller than 3,800 px on a
phone. The three tallest were:

| Page | Height |
|---|---|
| Invoicing | 3,771 px |
| Customers | 3,544 px |
| Cookies and tracking | 3,467 px |

Everything below applies below 640 px; from 640 px each page is as before.

## Invoicing (`/admin/{store}/settings/invoices`, `invoice-settings-form.tsx`)

- **Under the title:** one line, *An invoice for every paid order, a credit note for every refund.*
- **While something is missing,** the card is amber and says why orders wait: *Orders wait for their invoice: 5 things are missing*.
  - The first three are listed, each with *Fix it*.
  - The rest are under *And 2 more*.
  - The paragraph on why orders wait and the note on exchange rates wait for wider screens.
- **Each setting is a row saying what it will use:**
  - Invoices (*For every paid order · sent with the confirmation*, or *Off*)
  - Note on every document (*None*, or its start)
  - Invoice numbers (*The first is F-1*, or *The next is …* once issued)
  - Credit note numbers (*The first is K-1*)
- **What the system does** is one row at the end.

## Customers (`/admin/{store}/customers`, `CustomerList`)

- **One line under each name:** where they live, how many orders and when. The product pictures and the face wait for wider screens.
- **The three figures share one card:** each number sits above its words, which wrap rather than being cut.
- **Search, kinds and sort:**
  - The search takes the whole width.
  - Under it, the kinds of customer (*All · 16*, *New*, *Came back*, *Subscribed*) are one choice (`SelectNav`), beside the sort.

## Cookies and tracking (`/admin/{store}/settings/cookies`)

- **What visitors see now comes first.** *No cookie banner* when no optional tool is on, or *A cookie banner asks first* when one is.
  It ends with a link to the cookie page.
- **Each part is a row with its state:**
  - Visit counting (*Off · counts without cookies when on*)
  - Analytics and ad tools (*None on*, or how many)
  - Custom code (*None · once the store has its own address*)
  - Cookie scan (*Every week · not scanned yet*, or the day of the last scan)
  - Consents (*None recorded · kept 12 months*)
- **The page's long line** waits for wider screens.

## How this differs from the boards

- **Invoicing:** the Save for the switch and the note stays under those two rows rather than inside them.
- **Cookies:** *Scan now* is inside the Cookie scan row rather than on it.
- **Customers:** the sort stays as its own choice beside the kinds.

## Platform

- Kaizena Flow sells plans, so it has no invoices of this kind and no customer list of shoppers.
- Its own cookies page uses the same `TrackingForm`; its rows are the next step.

## Tests

- Unit tests, lint and types pass.
- The signed-in specs run at desktop width, where nothing moved.
