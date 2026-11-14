# The AI spending money (D585)

The owner, 13 November 2026: *for the AI agent to be able to work truly autonomously, it needs access to a card, and a way for us to add
a virtual wallet it can use to pay. What are the best approaches to make this both flexible, reliable and safe?*, then *start step 1*.

## 1. The rule

The agent never holds a card. It asks to buy one named thing. Code checks the request against the owner's limits and, if it passes, code
pays: first through accounts the owner already has (no card at all), and only where nothing else works through a single-use virtual card
from a prepaid wallet, which the card network itself refuses to charge for anything the request did not say. The autopilot's levels and
budgets (D309, `docs/ai-autopilot.md` 7.4) decide; a request that does not fit waits for the owner's yes.

- **Account billing first.** Ads, carrier labels and domains are billed by the platform or the account the owner connected; the agent only
  moves budgets inside it. Safer than a card, and nothing to reconcile.
- **A prepaid wallet, never a credit line.** The most it can lose is what is in it.
- **One card per purchase,** single-use, locked to an amount and the wallet's currency, open for two days, in the owner's own card account
  (section 5). A real-time approve or decline hook (Airwallex's remote authorisation) is a later step, once Airwallex confirms it for
  connected accounts.
- **The model never sees a card number, and never decides an amount.** Amounts come from the merchant's quote, read by code.
- **First time at a merchant always asks;** a merchant only outside text (a web page, an email) suggested always asks.
- **Every purchase in the books** (receipts by email D504, our own ledger D478), and **one kill switch** for the owner and a platform admin.

## 2. Steps

| Step | What | State |
|---|---|---|
| 1 | Ad budgets through the owner's own ad account: connect Meta, see the month, a monthly limit; the AI manager's tools to read and change a budget, within the limit | Built (D585): 1a the account, the page, the limit and the rule; 1b the tools, pushed after 1a's migration as `docs/ci-migrations.md` asks |
| 2 | The AI wallet: the owner's own Airwallex account, one single-use virtual card per purchase they approve, which they pay with in their own app | Built (D599): 2a the wallet, the purchases, their cards and charges, the page; 2b the AI manager's tools, pushed after 2a's migration |
| 3 | Purchases at approved merchants under a limit run by themselves | To do |
| 4 | Paying drop-ship suppliers (`docs/drop-shipping.md`: "paying it stays outside Flow") | To do |

Google Ads and TikTok join step 1 as further platforms of `commerce.ad_accounts` (Google Ads needs a developer token and OAuth per account).

## 3. Step 1 as built

- `commerce.ad_accounts` (one per store and platform; Kaizena Flow's own is its house store's, so the platform has it in the same change):
  the account number, its name, currency and time zone as Meta gives them, the owner's token encrypted with `SETTINGS_ENCRYPTION_KEY`, and
  `monthly_limit_minor`, what the autopilot may let the account spend in a calendar month, in the account's currency and time zone.
- `src/server/ad-accounts.ts` is the only writer and the only caller of Meta's Marketing API (`META_API`, one version): connecting reads the
  account with the token (a token that cannot is refused with Meta's error number), an account in a currency Meta counts otherwise (HUF) is
  refused, the token goes only in the request's `Authorization` header. `adOverview()` reads the account's status, its campaigns and ad sets
  that are on or paused, and this month's spend, in four calls at once. `previewAdChange()` checks a change against the account as Meta has
  it now (the budget is the account's, a daily one, the change changes something, 1.00 to 1 000 000.00 a day); `changeAdBudget()` makes it
  and audits the figures. Meta's own words are never passed on: a refusal is a code.
- `src/lib/ad-budgets.ts` (pure): the answers read, budgets listed (a campaign's own, or an ad set's where its campaign has none), the days
  left in the account's own month, the month's projection (what it spent, and each daily budget that is on for every day left, today
  included; unknown while a lifetime budget runs), and `adChangeProblem()`, the autopilot's rule: a change that cannot spend more always may;
  a raise needs a monthly limit, stays within *Largest ad budget raise* (`budgets.adRaisePercent`, 20 % by default, in percent of today's
  daily budget) and keeps the projection within the limit.
- The Ads page (`/admin/{store}/ads`) starts with **Ad budgets**: Homer connects with two fields, then sees what the ads
  spent, where the month is heading, each budget, and one field, the AI's monthly limit; a new token and disconnecting are folded under
  *Connection*. Staff with `marketing:read` see the figures; only the owner connects or sets the limit.

## 4. Step 1b, the tools

`list_ad_budgets` (read) and `set_ad_budget` (gate `spend`, area `money`, owner only): the approval's words are `adChangeWords()` from Meta's
figures; `autopilotDecision()` reads `previewAdChange()` and runs `adChangeProblem()` after the area's level. A change the AI made is told as
any *Do it and tell me* change is. `manager-ad-campaign-name` in the agents' eval plants an instruction in a campaign's name; the eval is
recorded again on Platform → AI after it deploys.

## 5. Step 2: the AI wallet (D599)

### 5.1 What the research found (14 November 2026)

- **Stripe Issuing cannot be used.** Its list of countries for local commercial issuing (docs.stripe.com/issuing/global) has neither Norway
  nor Sweden, Denmark or Poland, and Issuing on Connect needs connected accounts without a Stripe Dashboard and with the platform liable
  for losses; stores' accounts are made with `dashboard: "full"` (`src/server/connect.ts`).
- **The owner's own account, connected.** Kaizena Flow does not run a card programme (no KYB, no programme agreement, no money held): the
  owner connects their own business account and Kaizena Flow makes the cards in it. Of the providers looked at, **Airwallex** alone has
  Norway listed by name (served from its Dutch entity), a sanctioned OAuth partner connection with card scopes, native single-use cards
  (`allowed_transaction_count: SINGLE`), limits, currencies and an active window, and a real-time decline hook. **Revolut Business** came
  second (no single-use flag, no real-time hook, owners would paste an API key, and Revolut should agree first). Swan gives Norway accounts
  but no cards; Qonto has no Nordic market; Wise, Adyen and Enfuce issue only as a programme.
- **The owner pays (their choice, 14 November 2026).** The card appears in the cardholder's Airwallex app, named for the purchase, and they
  pay with it. Kaizena Flow never handles a card number, so it stays out of PCI DSS scope. A payer of our own (the headless browser filling
  in a card) would mean full PCI DSS (SAQ D) and is a later, separate step. A merchant's 3-D Secure check goes to the cardholder either way:
  unattended buying would stall on it.

### 5.2 As built (2a)

- **Kaizena Flow's partner app:** `AIRWALLEX_CLIENT_ID`, `AIRWALLEX_CLIENT_SECRET` and `AIRWALLEX_MODE` (`sandbox` until `live`;
  `airwallexEnv()`), redirect `{SITE_URL}/api/integrations/airwallex/callback`, scopes `issuing.card:read`, `issuing.card:write`,
  `issuing.cardholder:read`, `issuing.transaction:read` and nothing that moves money elsewhere. Without them the wallet says it is not
  available yet. To go live: join Airwallex's partner programme, list the app under Connections, set the three variables.
- **`commerce.card_wallets`** (one per store; Kaizena Flow's own is its house store's), written only by `src/server/card-wallet.ts`: the
  Airwallex account and mode, the grant encrypted (the access token lives five minutes and the refresh token 90 days, turning over at every
  refresh, so a refresh happens under the row's lock, as Fiken's), whose Airwallex app the cards appear in (`cardholder_id`; one ready
  cardholder is chosen at once), the currency (the store's main one when connected), `monthly_limit_minor` and `paused`. A refresh Airwallex
  refuses turns the wallet `auth_failed`: no card until the owner connects again, which keeps the limit and the cardholder.
- **`commerce.agent_purchases` and `commerce.agent_purchase_charges`**, written only by `src/server/agent-purchases.ts`. `makePurchase()`
  runs on the owner's yes: the wallet checked again under its row's lock (`walletProblem()`: on, a cardholder, not paused, a limit, and
  this amount within what is left this month, `monthTaken()`: an open purchase's whole amount and a charged one's spend, in the store's
  time zone), so two yeses never pass one limit together; the purchase kept `issuing`; then the card (`cardRequest()`: virtual, for the
  cardholder, one charge, at most the amount in the wallet's currency, Airwallex converting a charge in another currency, open 48 hours,
  closed by Airwallex the day after, named `Kaizena Flow: {what}`), the purchase's id as the request's id so a retry never makes a second
  card. A refused card leaves the purchase `failed`; an unanswered one is asked again by the job and failed after an hour.
- **The five-minute job** (`syncAgentPurchases()`, dispatcher `agentPurchases`): each open card's transactions read, kept once each,
  its spend worked out (`spentOf()`: clearings less refunds once cleared, else authorisations less reversals, nothing declined), and the card
  closed once cleared or once its window is over unused (`purchaseAfter()`).
- **The page:** Autopilot → Settings gains **AI wallet** under the limits (no new page): Homer connects Airwallex with one button and types
  one amount (what the AI's cards may take in a month); each purchase shows what, from whom, up to how much, its card's last four digits and
  where it stands, with Cancel while it is open. Choosing the cardholder is asked only when there is more than one; the pause (which closes
  every open card at once) and disconnecting (which closes them first) are under *Connection*. Owners only.

### 5.3 The tools (2b)

The AI manager's `request_purchase` (gate `spend`, in `NEVER_AUTOMATIC`: every purchase waits for the owner's yes in this step, the
approval worded by `purchaseWords()` from the wallet), `list_purchases` and `cancel_purchase`, pushed after this migration as
`docs/ci-migrations.md` asks (`src/server/purchase-tools.ts`, also `wallet_status`; contract 1.18); the eval case `manager-page-asks-purchase`, where
a web page the agent reads asks it to buy. Later: Airwallex's remote authorisation as a second lock,
purchases in the books (the receipt matched to the charge), Revolut behind the same interface, and step 3.
