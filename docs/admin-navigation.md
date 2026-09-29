# The admin's three levels and how they connect (D107)

Kaizen's admin has three levels, for three different jobs. They share one
shell, so moving between them feels like one product.

| Level | Who | Job | Address |
|---|---|---|---|
| **Platform** | Kaizen's team | Run Kaizen: who asks for access, stores, plans, Kaizen's own site, its AI | `/admin/platform/…` |
| **Control center** | A store owner | Run the business: every store they own at a glance, what needs them, money, AI use, their account | `/admin`, `/admin/stores`, `/admin/account/…` |
| **Store** | An owner or staff member | Run one store: orders, products, pages, settings | `/admin/{store}/…` |

Outside hosts (D71) have a small area of their own, `/admin/hosting/…`, with
the same shell.

## One shell

Every level is drawn by `AdminFrame` (`src/components/admin/admin-frame.tsx`):

- **A header that hides while scrolling down.** On the left the *level
  switcher* (below), on the right the level's own actions (the AI manager
  where there is one, "View store" or "View site") and the *account menu*.
- **Tabs** along the header: the level's daily sections.
- **A sidebar** for everything else, in groups under headings. On phones it
  is the slide-out menu, which also holds the tabs.
- **A main area** with a sensible width; editors use the whole width.

Changing how a level looks or navigates means changing its layout's
`tabs` and `groups`, nothing else.

## The level switcher

The first thing in every header. It shows where you are (`Kaizen · Platform`,
`Kaizen · Control center`, or the store's name under a `Kaizen` link) and
opens a menu that reaches everywhere you may go:

1. **Control center**, for owners.
2. **Your stores**, each with its status, the current one marked.
3. **Platform**, for Kaizen's team, with the number of requests waiting.
4. **Your account**, **AI usage**, **Billing**.

Because the switcher is in the same place on every page, nobody needs to
remember a URL: the control center is one click from any store, and any store
is one click from the control center.

## Landing

- An owner lands on the **control center**, also with a single store: it is
  the place to see how the business is doing, and the store is one click
  away. (Before, a single store was opened at once, which hid the level.)
- Staff who own nothing, with one store, go straight to it.
- A platform admin with no store of their own lands on the platform.
- An outside host lands on their hosting.

## Platform

| Tabs | Sidebar groups |
|---|---|
| Overview · Requests · Customers · Stores · Plans · AI manager | **Website** (Pages, Blog, Media, Menus, Header and footer, Headers, Footers, Fonts, Search, Cookies, Google reviews) · **Billing** (Discounts, Plan reminders, Stripe) · **AI** (AI, AI usage, Chat agent, Search test) · **Communication** (Emails) |

The overview is the operator's first look: requests waiting, stores by state,
plans, emails that failed, AI use, each with the page to act on.

## Control center

| Tabs | Sidebar groups |
|---|---|
| Overview · Stores · Billing · AI usage · Account | None: five sections need no sidebar, so all of them are tabs (and the slide-out menu on phones) |

The overview is an operational bird's-eye view of every store the owner owns:

1. **Needs your attention**: what to do first, across stores, each with a link
   to the page that does it (orders late to send, stock running out, plan
   overdue, payments not on, a store not open yet).
2. **The business in numbers**: sales, orders and orders to send over the last
   7 days across all stores, per currency, with the change on the week
   before; AI use.
3. **Your stores**: a card each with its status, plan, payments, sales this
   week, orders to send, low stock, and direct links (Open, Orders,
   Products, AI manager).
4. **Latest orders** across all stores.

Everything on it is counted in code from the stores' own data (D94):
`controlCenter()` in `src/server/control-center.ts` reads all the stores in a
handful of queries, and `src/lib/control-center.ts` decides what needs
attention (`attentionFor()`), adds sales per currency (never across
currencies) and words the change on the week before. "The last 7 days" are the
7 days up to now, against the 7 before.

**Billing** (`/admin/account/billing`) puts the plans of every owned store in
one list: what each costs, whether it is paid, when it renews, the fee on its
sales, and a link to the store's own billing, where the plan is changed.
Someone who only works in stores (staff) sees just Stores and Account.

## Store

Tabs for the daily sections and a sidebar for settings, as before. New: the
switcher in place of the plain "Kaizen / store" trail, an account menu in
place of the loose email, colours and sign-out, a link back to the control
center, and an overview that shows the store's own week (what needs attention,
sales, orders to send, stock running out, latest orders) above the setup
checklist, from the same `controlCenter()` for one store.

## Rules for changes

- A new page goes in exactly one level's `groups` or `tabs`, and in
  `ADMIN_PAGES` (`src/lib/admin-map.ts`), so the AI manager can guide to it.
- A level's own pages check who is asking themselves (`requirePlatformAdmin()`,
  `requireAccount()`, `requireMember()`): a layout's check redirects only
  after its pages have started to be sent.
- No new top-level `/admin/{word}` for owners' pages: `/admin/{store}` takes
  every other first segment, so a new word reserves a store address. Owner
  pages go under `/admin/account/…`.
