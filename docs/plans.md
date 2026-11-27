# Plans: access sold by subscription, shown in a pricing table (D912)

A plan is a product of the kind `plan`: access to an app or a service, sold only by subscription, its variants its billing periods (D911).
It has no product page and no place in any list; a store's page shows it in the Plans component, the pricing table Kaizena Flow's own
`/pricing` has (D142), where *Choose plan* puts it in the cart. Asked for by the owner while setting up the Kaizena Life store (27 November
2026). Step 1 is built; step 2, access in an app, is designed here and not built.

## Step 1: the plan (built)

- **The database:** `products_kind` takes `plan` (`20261127132008_demonic_adam_warlock`, added not valid on the hot table, validated by
  `20261127132028_plan_product_rules`). `check_plan_product()`, deferred constraint triggers on `products` and `product_variants` as
  `check_gift_card_product()` has, holds a plan to being sold only by subscription, by the store itself, each variant a service with no
  measure. `assert_product_publishable()` lets a plan go on sale without a picture. Tests: `src/db/plan-product.test.ts`.
- **What a plan includes is its description,** one thing per line (`includedLines()`: bullets taken off, repeats left out). A plan has no
  page, so its description has no other use, and it is already translated, copied, exported and in the Admin API: no new schema. Lines
  written alike (case, spacing, a full stop) are one row of the comparison table (`featureKey()`).
- **The editor:** *A plan* is a kind while Subscriptions is on. Choosing it on a product with no options makes the option *Billing* with
  *Monthly* and *Yearly*, a variant each (services, SKUs from the plan's name) and a purchase option for each at its own price, so the owner
  types two prices. The billing periods sit above the *Advanced* fold, beside the prices; the description is labelled *What's included*;
  files, delivery, a picture and safety information are not asked. The checks: a plan renews every month or every year (what a pricing
  table shows), every variant has its billing period, no file. `asKind()` makes a plan's variants services and its sale subscription-only
  whatever the form sent.
- **Never listed:** `OFFERED` (`src/server/product-conditions.ts`), which every read made for everyone asks (lists, categories, search, the
  sitemap, llms.txt, feeds, recommendations, the shopping agents' catalogue, the chat, emails' product picks, WordPress, 404 suggestions,
  `getProduct()` and so the product page), leaves plans out. `PLAN_OFFERED` is the same conditions for plans, asked only by the pricing
  table's reader (`selling-readers.scan.test.ts` holds both). The readers that ask neither leave plans out by hand: the AI page writer, the
  redirects' live addresses and targets, the looks' product preview, review requests and imported reviews. The cart and checkout sell a
  plan through `offeredTo()`, which asks no kind.
- **Its address:** `/p/{handle}` of a plan leads (307) to the store's published page holding the Plans component (`planPricingPath()`,
  loaded on the product page's miss path only), else the store's 404.
- **The pricing table on a store's page:** `getStorePlans()` (`src/server/store-plans.ts`, cached with the catalogue): each plan in the
  shopper's market, a card per plan from the cheapest a month, at what a subscriber pays each month and each year (the variant's price less
  its option's discount, in the market's own currency, with VAT unless the store sells only to businesses), its excerpt under its name, its
  free trial under the price. `PlansView` takes the store's plans as `sale`: each card's button, and a yearly price under a monthly one, is a
  plain form to `choosePlanAction()` (`cart/plan-action.ts`, loaded with the store's plans only), which works before any script. The
  builder offers the component on a store's pages and articles while Subscriptions is on, without Kaizena Flow's currency and button address.
- **Choosing a plan:** `choosePlan()` (`src/server/cart.ts`) takes any other plan out of the cart (another billing period too), then puts
  this one in, one (`ONE_RULE`: a plan is bought one at a time), and the shopper goes to the cart, where the subscription's terms are agreed
  to (the consent `placeOrder()` asks for) and checkout starts. `checkout-kinds.int.test.ts` has the scenario; `store-plans.int.test.ts`
  holds the rest.
- **The platform:** Kaizena Flow's own plans have had their pricing table since D142 and give access to Kaizena Flow itself; they are sold
  through Stripe Billing on the platform's account, not as products, so nothing is missing there.
- **Kaizena Life (another product):** its store makes *Kaizena Life Plus* and *Running Analyzer* as plans (no welcome PDF any more) and a
  page with the Plans component as its pricing page. Life still matches a subscription by its SKU and the buyer's email until step 2.

## Step 2: access in an app (designed, not built)

What the owner asked for: "the ability to approve access to a store owner's own app, third-party or otherwise".

- **Access is a fact Flow keeps, derived from the subscription:** who (the customer, and the app's own reference for them when it has
  one), which plan (product, variant, SKU, billing period), and whether they have access now and until when. Active (a trial counts) gives
  access; a cancellation that waits keeps it until the period's end; a payment failing, a pause or an end takes it away. The app never
  interprets Flow's subscription states: it reads the access.
- **A plan names the app it gives access in,** an app installed in the store (D441):
  - **A third-party app** (someone else's software sold through the store) asks the new scope `access:read` in its OAuth request. The owner
    approves it on Flow's consent screen, which says what it means: "See who has access to the plans you link to this app: their email,
    plan and until when." Uninstalling ends it at once.
  - **The owner's own app** (Kaizena Life's case): *Connect your own app* under the plan, with its events address. Flow makes a private app
    of the store's own, installs it with `access:read`, and shows its signing secret and key once. The same machinery underneath, so one
    path to build, test and secure; Homer types an address, Lisa can see the app it made.
  - An app sees access to the plans linked to it only: never the store's other plans, orders or customers (data minimisation: an app is a
    processor). A plan can be linked to more than one app (`plan_apps`).
- **What the app gets:** signed events `access.granted`, `access.changed` (another billing period, a new end) and `access.ended` to its
  events address (D354 signatures, the installation's endpoint, D441), each with the access as it is now; and `GET /api/admin/v1/access`
  (by email or the app's reference, and a list with a cursor) to put right anything an event never said. An event only says something
  changed; the app reads the access again, as Life does today.
- **Who it belongs to:** a signed hand-off. The app links its user to the pricing page with its own reference and a signature made with its
  secret (`?app=…&ref=…&ts=…&sig=…`); Flow checks the signature and the time, keeps the reference on the cart, the order and the
  subscription, and every event and answer carries it, so the app never matches by email. Without a hand-off the access carries the buyer's
  email, and the app matches a confirmed account by it, as Life does today.
- **The shopper:** the order confirmation and their subscription page say where the plan is used ("Open Kaizena Life"), from the app's
  address.
- **Kaizena Life** then moves from its Admin API token, its own endpoint with the `subscription.*` topics and SKU matching to *Connect your
  own app*: `access.*` events and the hand-off from its *Upgrade* buttons. Its plans' features stay Life's to decide.

## Not done

- Step 2 above.
- Changing a running plan from monthly to yearly, or to another plan, is still a cancel and a new purchase (D911); an upgrade that prorates
  through Stripe comes after step 2.
- The shopper's pages still say "delivery" in places for a service, and a plan's withdrawal rules are a service's; a lawyer's reading of a
  digital service's withdrawal waiver is due before plans are sold widely (Kaizena Life's review of 25 November).
