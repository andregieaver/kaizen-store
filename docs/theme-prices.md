# Premium themes (D286)

The owner (19 October 2026): "Let's add the ability to set pricing for themes in order for us to sell them. Free should still be an
option. When a user chooses a Premium theme, they should not have to pay upfront. Payment should be withdrawn when the site/store goes
live."

## The rules

* **Free or Premium.** A theme with no price is free (every theme until now, and every one that is made). Premium is a price in every
  currency stores are billed in (the plans' currencies), without VAT: `commerce.theme_prices`, set on the theme's page in the platform's
  admin (*Price*, saved at once, not with the theme's draft) through `setThemePrices()`.
* **Once per store.** A store pays for a theme once and keeps it, with every preset and every update; switching away and back costs
  nothing more. One price per store, in the currency of its plan, else of its own country, else the first the theme has
  (`commerce.theme_price_for()`). Norwegian stores pay 25 % MVA on top, as on their plan (`billingTaxRates()`).
* **Nothing up front.** Trying a theme (*Add to my themes*, *Try it in your store*), previewing it and customising it before switching are
  free. A store pays when the theme **goes live** on it and the store is **open** (its setup completed, `setup_completed_at`):
  * chosen at sign-up, at *Create a store*, or made live before the store opens: **owed**, and **due** the moment the store opens
    (`commerce.stores_open_theme_purchases()`), at the price agreed or the theme's price then if that is lower. Only the theme live when
    the store opens is paid for: another going live before that cancels what was owed.
  * made live on an open store: **due** at once, and only after the owner pressed a button that says the price (*Pay NOK 3,490 and use it*).
* **The database records it.** Whatever makes a theme live (applying, switching, putting a look back, a request approved), the trigger
  `commerce.theme_installs_charge()` makes the purchase, so no way of making a theme live skips it. On an open store it refuses a premium
  theme the store does not have unless the transaction carries the price the person agreed to (`kaizen.theme_charge`, `chargeToken()`),
  so nobody is charged a price they were not shown. Store templates (`starter`, `is_template`) and stores that are not open are never
  charged. A theme a platform admin applies to a store is given (`grant`).
* **A theme's first price** leaves the stores that already have it free (`granted`); **making a theme free again** cancels what was owed
  or due and not yet invoiced.
* **Purchases only go forward** (`owed`, `due`, `invoiced`, `paid`; or `granted`, `cancelled`, `void`) and are never deleted
  (`commerce.theme_purchases_rules()`).

## Charging

`chargeDueThemePurchases()` (`src/server/theme-prices.ts`) invoices what is due: right after the store opens or the owner pays (`after()`),
and from the five-minute job. One Stripe invoice on Kaizena Flow's account per purchase, to the store's own Stripe account (as its plan),
with one line for the theme: paid at once with the plan's card when the plan is paid by card, otherwise sent as an invoice due in 14 days.
Every step is safe to repeat (the invoice is kept on the purchase as soon as it exists, its line found by its mark, idempotency keys), and
a try that fails waits longer each time with the problem in words, shown on the theme's page in the platform's admin. The billing webhook
marks it paid (`applyThemeInvoiceEvent()`), and a referred store's payment earns its referrer as its plan invoices do
(`commerce.referral_earn()`, `theme_invoice:{invoice}`).

## Where it shows

* The platform's admin: the theme's *Price* card, with how many stores paid, owe or were given it, and any purchase not yet invoiced.
* The theme store: the price on each card and on the theme's page (*Free to try: you pay when your store goes live with it.*), and in its
  structured data (`offers`).
* Sign-up and *Create a store*: the theme cards say it is premium, its price, and that nothing is paid now.
* Design settings: each theme says what making it live costs this store; applying or switching to one says the price before the button
  that pays. The setup wizard's last step says what opening charges. Billing lists the store's premium themes with their invoices.

## Not done here

* A copy of a store (`duplicate_store()`) keeps the original's look as its own *Custom*, so it does not pay for a premium theme it was
  copied wearing. Copies are the owner's own stores.
* A theme is not taken away when its invoice is voided or not paid: the purchase says so, and the platform's admin follows it up.
