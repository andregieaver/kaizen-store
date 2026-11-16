# Admin redesign, round 27: Apps and API, a new page and Analytics settings on a phone

Decision D700, 16 November 2026. The boards are on the design canvas of round 27. After round 26 these were the three tallest store pages on a
phone. Each was long for a different reason:

| Page | Height today | Why it was long |
|---|---|---|
| Apps and API | 7,400 px | a reference list of about 140 routes |
| A new page | 6,294 px | the parts palette laid open above the page |
| Analytics settings | 6,258 px | a paragraph before every form |

Round 26's `PhoneRow` gains two things:
- **`opens`:** an older anchor, such as `#visits` from Traffic, that opens the row too.
- **`action`:** one press on the row itself, such as *Turn on* for a switch that is off.

## Apps and API (`/admin/{store}/settings/api`, `MakeApiToken`)

- **A token starts from a ready kind,** at every width. The kinds are listed in `TOKEN_KINDS` in `src/lib/admin-api.ts`, and the form
  starts on Warehouse.

  | Kind | What it can do |
  |---|---|
  | Warehouse | reads products, reads and adjusts stock, reads orders, records parcels |
  | Accounting | reads products, orders with their invoices, customers, settings and saved reports |
  | Read everything | reads every everyday area and changes nothing |
  | Choose yourself | the scopes and the powers under Customise, as before |

  A ready kind never holds a power. One line says what the chosen kind does.
- **On a phone, what can reach the store comes first,** as rows:
  - Apps installed
  - AI assistants and apps (*None reaches this store*)
  - Cut off
  - Tokens in use (*None yet*)
- **Then making a token.** The paragraph on how a token acts is small text under the form.
- **Then the rest, as rows:**
  - Storefront API
  - Your apps for the AI manager
  - Developer reference: how to call the API, every route and the OpenAPI contract
- **The page's line** on a phone is *What may read and change your store.*
- **Platform:** Kaizena Flow's own API page has its own scopes, so it keeps every scope in the open (`kinds` is off there).

## A new page (`PageEditor`, `PageBuilder`, every page, article and template editor)

- **On a phone the order is:**
  1. The title and address
  2. The page itself, with *Start from a page layout*
  3. A dark *+ Add a part* button
  4. *Page settings* as rows

  The settings panel joins the builder's column (`max-sm:contents`) so that its title card can come first and its settings after the page.
- **The parts** wait behind *+ Add a part*. They open under the page and close with *Hide the parts*. Tapping a part's + adds it to the
  page.
- **The rows say what is chosen:**
  - Categories and tags (*No categories or tags*, or how many are chosen)
  - Picture (*None*)
  - Who may read it (*Everyone, search engines and AI*)
  - Excerpt (*From the search description*)
  - Search and sharing (*From the title and text*)
  - An article's author has a row too.
- **The canvas's toolbar** (motion preview, hidden parts, screen sizes) waits for wider screens.
- **Save draft and Publish** stay in the bar at the bottom, as before.
- **Platform:** this is the same editor for Kaizena Flow's own pages.

## Analytics settings (`AnalyticsSettingsView`)

- **On a phone, three groups of rows**, each row saying where it stands:
  - **Profit:**
    - What your products cost (*0 of 15 variants have a cost*, in amber while any is missing)
    - Fees and costs we cannot see (*Nothing entered yet*)
    - Customer lifetime (*3 years*)
  - **Targets:**
    - Revenue for this month (*No target*, or the amount)
    - Orders, conversion and more (*None*, or how many)
  - **What is measured on the store:**
    - Visit counting (*Off · no cookies*, with *Turn on* on the row)
    - Heatmaps (*Off*, with *Turn on*)
    - Recordings (*Not available yet*)
- **Inside each row** is the section as before, with its paragraph and its lists of what is and is not counted.
- **The box of questions** this page answers waits for wider screens.
- **Old links still work:** `…/analytics/settings#visits` (from Traffic) opens the Visit counting row.

## Also

- **Books (round 26):** the yellow strip and the SAF-T line now use the admin's warning colours, so they follow dark mode.

## How this differs from the boards

- **Apps and API:**
  - The button keeps its name, *Make a token*, rather than *Make the token*.
  - Installed apps and cut-off apps are rows too, when there are any.
- **A new page:**
  - *Where it sits* is not a row of its own. The parent page stays with the title and address, and categories and tags are their own
    row.
  - Excerpt is a row of its own.
- **Analytics settings:** a row with a switch shows both *Turn on* and *Change*. Change opens the explanation.

## Tests

- **`api-tokens.spec.ts`:**
  - Warehouse is chosen when the page opens, and the scopes appear with *Choose yourself*.
  - A Warehouse token reads stock and is refused customers.
- **`admin-api-kinds.test.ts`:** each ready kind holds real scopes and never a power, and Read everything only reads.
- **`settings-forms.test.ts`:** the read-only view's only buttons are the rows' open buttons. None of them submits.
