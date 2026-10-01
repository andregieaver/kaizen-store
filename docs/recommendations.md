# Product recommendations (D139)

Upsells, cross-sells and complements picked for each shopper, shown in a **content grid** that recommends, and used by the
**chat agent** whenever it suggests or promotes products. Built on the store's own data; the AI may reorder the best
candidates but never adds a product, a price or a claim.

## What a shopper sees

- A product grid with **Recommend products for each shopper** on (page builder → content grid → General). It works in a
  product layout (around the page's product), on the All products page (around the filters chosen in the address), in an
  article or any page (around the page's words, categories, tags and public custom fields) and on working pages.
- The grid's *Only these* categories and tags keep it to those products; its limit says how many; its *Mix* says which of
  upsells, cross-sells and complements it shows; *Say why under each product* adds a line such as "Pairs well with …".
- The page is built with the recommendations **for everyone** (`standInFor()`, cached with the catalogue, no cart, account,
  session or AI). In the browser `RecommendedGrid` asks `/api/recommendations` for the shopper's own and swaps them in; a
  failed request leaves the grid as built. A store with recommendations off draws the grid empty and asks for nothing.
- The chat agent has a `recommend_products` tool: the same engine and rules, without the AI re-rank (the agent's own model
  words the answer), and "present only what it returns" in its rules. Off while the store's recommendations are off, when it
  tells the agent to search instead.

## How a recommendation is made (`src/server/recommend.ts`)

1. **Anchors** (`pickAnchors()`): the page's product, what the tab looked at (newest first), what is in the cart, what is in
   a wishlist; at most six, each weighted (`ANCHOR_WEIGHT`).
2. **Candidate lists**, each ranked: the owner's *goes with* pairings; products bought in the same paid orders (last year,
   not copied history); products close in meaning (`product_embeddings`, same `space` only); products sharing categories and
   tags; the shopper's searches (keyword search); the page's and searches' words by meaning (needs the store's AI and its
   monthly cap not reached); what sold most in 90 days (the cold-start answer). `fuse()` merges them by weighted reciprocal
   rank fusion and remembers which anchor helped each product most (`because`).
3. **Hard rules in SQL** (`recommendable()`): active, priced in the market, in stock now, right audience (B2B), not hidden by the
   owner, in the grid's categories and tags. In code: not the anchors, not in the cart, **not already bought**
   (`purchasedProductIds()`: by account, by email, or by a cart of this browser; goods only, since bookings are booked
   again; copied history and unpaid orders do not count), not *never with* an anchor.
4. **Kinds** (`classify()`, pure): an *upsell* is a dearer product of the same category within the owner's ceiling (above it
   the product is dropped); a *complement* is the owner's pairing, or cheaper than 60 % of the anchor's price with a
   co-purchase or shared tag; a *cross-sell* is another kind of product bought with it; the rest is *similar*.
   `chooseMix()` puts the owner's pairings first, then the strongest, then takes the kinds the grid mixes in turn, at most
   two of a category.
5. **AI re-rank** (optional, `rerank()`): the model gets the session as facts (a JSON message, never instructions) and up to
   16 candidates and answers with ids, a reason and a reference product. `parseRerank()` keeps only candidate ids, once
   each, known reasons and known references; `applyRerank()` moves them first and never shortens the list; `reasonFits()`
   refuses a reason that is untrue of the product (a cross-sell is never "a step up"). The answer is kept in
   `search_cache` (`rerank`) for the same question; the request waits 2.5 s and goes on with the plain ranking when late.
   Never asked: for the plain-ranking arm, with the AI switched off, with no text model, over the monthly cap, or with
   nothing to go on.
6. **The line under a product** is a fixed sentence (`m.recommend`, hand-written in nb, sv, da and en; AI-translated into
   other languages through the UI catalogue) with a title the store holds. The model's words are never shown, so the claims
   filter has nothing to catch.

## Session and consent

What the shopper's tab remembers (`kaizen_rec` in **session storage**: a random tab id, the products looked at, the searches
made, the products clicked from recommendations) never leaves the tab except to ask for recommendations and to report
what was shown or clicked. It is joined to no person and set only while the store's recommendations are on. It is listed in
`KNOWN_COOKIES` as *necessary* (a tab-only item that is gone when the tab closes, like `kaizen_chat`), which is a legal
judgement to confirm per country with the other cookie texts. The cart, wishlist, account and the orders of the device are read
from the request's own cookies on the server; nothing new is stored for them.

## Spend

Every model call goes through `aiFor(storeId, { feature: "recommendations" })` and `metered()`, so it shows on the usage
reports and uses the store's own key when it has one. The owner's **monthly token cap** (default 1 000 000, empty for none)
is counted from `commerce.ai_usage` for the calendar month (`tokensUsedThisMonth()`); at the cap the plain ranking is
shown. Embedding the shopper's words counts too.

## Measuring

`recommendation_events` (shown, clicked) and `recommendation_adds` (a recommended product put in a cart: the buy form carries
the tab's recent clicks as a hidden `rec` field, `RecommendField`, which `addToCart` checks against the product) are kept 90
days. `recommendationReport()` gives, per ranking (**the AI's** and the **plain** one a share of tabs is held out on,
`holdout_percent`, drawn from the tab id so a tab keeps its arm): visitors, shown, clicked, click-through, added, add-to-cart
rate, and orders of those carts that hold the product within 14 days, with the lines' revenue **per currency**
(never added across currencies) and revenue per visitor.

## Rules the owner sets (`/admin/{store}/recommendations`)

*Goes with* (offered first, as a complement, one way or both), *is never shown with*, *is never recommended*; the upsell
ceiling; the AI switch; the held-out share; the monthly cap. Margins are not in the catalogue, so the ceiling is the upsell
rule. Pairings and exclusions cache with `recommendTag()`.

## Category and tag pages (D140)

Category and tag pages are page roles like the cart: choose a published page for **Category pages** or **Tag pages** under
Page roles, with the **Category products** / **Tag products** component (`STORE_PARTS.category` / `tag`, drawn by
`TermListing`, the same listing the standard page is made of: name, the term's own custom fields, subcategories, Filter and
sort). Any other component can sit around it, among them a content grid that recommends: on such a page the grid
recommends around the term (`GridPlace.term`, `RecommendPlace` listing with `termId`; a category with the categories
below it). The standard page is shown until a page is chosen.

## Checking and tuning (D140)

- **The live comparison.** The report adds, per ranking, the tabs that clicked a recommendation and the tabs that put one in
  the cart, and compares the AI's ranking with the plain one on those two shares with a two-proportion z-test on tabs
  (`compareShares()`, `compareArms()`). A difference is called clear under p = 0.05 and only with at least 100 tabs in each
  ranking; the sentence the admin page and the AI manager give is built in code (`verdictWords()`): keep the AI, switch it
  off, or wait.
- **The check against past orders** (`replayOnOrders()`, admin "Run the check", AI manager `check_recommendations`): for the
  last 100 paid orders of two goods or more, one product is held back and the plain ranking (the order itself left out of
  co-purchase and sales, so it cannot vouch for itself) is asked what it would show a shopper who had looked at the others.
  It reports how often the product comes first, in the first 4 and in the first 12, and the mean reciprocal rank, against
  the best sellers shown to everyone. It uses no model and costs nothing; it measures whether the engine finds what people
  buy together, not what they would click. In a shop with few products the best sellers are all of them, so only the first
  places tell the two apart.

## The AI manager (D140)

Owner tools (also served to Kaizen Life's assistant): `get_recommendations` (settings, the AI's use against its cap, rules, the
live comparison), `set_recommendations`, `add_recommendation_rule`, `remove_recommendation_rule` (all kept for approval, and
checked before they are kept) and `check_recommendations`; a playbook, *Set up product recommendations*.

## Not done

- Verification against real traffic: the engine is tested on a small catalogue with a stand-in model. The live comparison
  above is how to find out whether the AI's order beats the plain one; it needs visitors, and the held-out share on.
- Articles are not recommended (by choice).
