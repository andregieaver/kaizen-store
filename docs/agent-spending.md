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
- **One card per purchase,** locked to an amount, a currency and a merchant, expiring in hours; every authorisation answered by our own rule
  in real time (Stripe Issuing's `issuing_authorization.request`), declined when no approved purchase matches.
- **The model never sees a card number, and never decides an amount.** Amounts come from the merchant's quote, read by code.
- **First time at a merchant always asks;** a merchant only outside text (a web page, an email) suggested always asks.
- **Every purchase in the books** (receipts by email D504, our own ledger D478), and **one kill switch** for the owner and a platform admin.

## 2. Steps

| Step | What | State |
|---|---|---|
| 1 | Ad budgets through the owner's own ad account: connect Meta, see the month, a monthly limit; the AI manager's tools to read and change a budget, within the limit | 1a built (D585): the account, the page, the limit, the rule. 1b: the tools (a push of their own, after the migration, as `docs/ci-migrations.md` asks) |
| 2 | The wallet and single-use cards (Stripe Issuing on the stores' connected accounts), every purchase asked | To do. Check with Stripe that Issuing for Connect platforms works in the EEA and Norway; Swan, Adyen Issuing or Wallester behind the same interface if not |
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

## 4. Step 1b, the tools (next push)

`list_ad_budgets` (read) and `set_ad_budget` (gate `spend`, area `money`, owner only): the approval's words are `adChangeWords()` from Meta's
figures; `autopilotDecision()` reads `previewAdChange()` and runs `adChangeProblem()` after the area's level. A change the AI made is told as
any *Do it and tell me* change is. The eval is recorded again on Platform → AI after it deploys.
