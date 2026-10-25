# Wave 6: catalogue (decisions D319 to D327)

The contract for wave 6 of `docs/parity-plan.md`: how a store's products are grouped, how big a product may be, products made of
products, prices that follow quantity and buyer, what a gallery holds, how search is steered, content types of the owner's own and a
standard product taxonomy. Written on 2026-10-25 from the wave 6 rows of `docs/parity/rows` as re-rated that day (commit `b5d3b0be`),
the plan, CLAUDE.md and a read of the code. Code, tests and texts follow this file; a unit that must change course says so here first.

**What exists today (read in the code).**

- **Categories and tags** (D50): `commerce.terms` per store and kind of content; product categories nest, tags are flat; a product's are
  `product_terms` (no position). A term has a name and slug in the store's main language only, an SEO title and description per language
  (`terms.seo`, D168), a product layout (D79) and the unit-price flag (D160). Its page is `/category/{slug}` or `/tag/{slug}`
  (`term-listing.tsx`, a page role since D140), sorted by `LISTING_SORTS` (`featured` is the order products were added). The translation
  worklist's `terms` scope carries only the SEO texts (`termWork()` in `src/server/store-translate.ts`), so names are never translated.
  Nothing fills a term by rule.
- **Variants**: `MAX_OPTIONS = 3`, `MAX_VARIANTS = 100` (`src/lib/product-input.ts`), enforced by `productInput`, the CSV import and the AI
  manager's product tools, with no database check. The editor (`product-editor.tsx`, one client component of about 3,000 lines) lists one
  row per variant; the storefront's picker does not mark combinations that cannot be bought.
- **Kinds**: `PRODUCT_KINDS` are goods, appointment, stay, rental and gift card. No bundle; "buy X get Y" and campaigns (D114, D299) only
  discount ordinary lines.
- **Quantity**: tiered campaigns by number of items (D299 E3) are the only quantity breaks; the cart caps a line at `MAX_LINE_QUANTITY` (20)
  and at stock; no minimum, maximum or increment.
- **B2B**: companies with a customer group, owner and employees, payment terms (D108, D293); a group is one percentage off what is bought
  once. No price lists, no per-group catalogue, no locations, approvals or PO number.
- **Media**: a product's gallery is up to 12 pictures (`MAX_MEDIA`); videos exist only in pages (D209) and as row backgrounds.
- **Search** (D72 to D75): keyword and meaning merged, query understanding, a zero-result report; no synonyms, boosts or pins.
- **Custom fields** (D118 to D120): groups of fields on products, variants, pages, articles, terms, the store, customers and orders; no
  standalone entries of an owner's type.

## 1. The units, in the order they are built

| Unit | Decision | What | Rows it moves |
|---|---|---|---|
| A | D319 | Collections in depth: a category's or tag's own description and picture per language, translatable names, a manual product order; collections filled by rules | `catalogue.collections-manual` (5), `catalogue.smart-rule-based-collections` (3) |
| B | D320 | Variants at scale: 2,048 variants over 3 options, a matrix editor with bulk fill, reads that do not grow per variant, a picker that marks what cannot be bought | `catalogue.products-with-variants-and-options-limits` (4) |
| C | D321 | B2B in depth: price lists (fixed or a percentage, per currency) for groups and companies, catalogues that hide products from others, company locations, buyer roles, order approvals and PO numbers | `catalogue.b2b-catalogs-and-price-lists` (3), `catalogue.b2b-company-accounts` (3) |
| D | D322 | Bundles: a product made of components with a fixed or computed price, stock from its parts, components on the order line and back on a return | `catalogue.bundles` (3) |
| E | D323 | Quantity rules and price breaks per variant (and per price list): minimum, maximum, increment; from N units, a price or a percentage | `catalogue.volume-pricing-and-quantity-rules` (2) |
| F | D324 | Search merchandising: synonym groups per language, boost, bury and pin (for all searches or one query), zero-result actions | `catalogue.search-merchandising-synonyms-boosts-pins` (2) |
| G | D325 | The product gallery takes videos (uploaded or YouTube and Vimeo) and 3D models, in the owner's order, with alt text per language | `catalogue.product-media-video-and-3d` (2) |
| H | D326 | Content types: the owner's own kinds of entries (fields from the existing types), entries with drafts and languages, referenced, listed and given pages | `catalogue.metaobjects` (2) |
| I | D327 | A standard product taxonomy: a category from a shared list with stable ids, its attributes as fields and filters, into the feeds | `catalogue.standard-product-taxonomy` (2) |

Combined listings (`catalogue.combined-listings`, weight 1, Shopify Plus only) are **not in this wave** (decision 6 below).

Each unit is its own commit (or a few) with its own migration(s), tests and decision row, shipped before the next starts. Unit A is
detailed in section 3; the others are outlined in section 4 and get their detail when their turn comes. `pnpm parity` says the wave, if
every row closes, takes core parity from 73.6% to about 76%.

## 2. Rules for every unit

1. **One way to write.** A catalogue change goes through the function the editor calls (`saveProduct()`, `createTerm()`/`updateTerm()`, the
   price functions), checked by the input schema the browser shares (`productInput`, `termInput`). An import, the AI manager and a bulk
   action call the same functions. Prices change only through `commerce.set_price` (or a price list's own writer, unit C); stock only
   through the inventory triggers (D172).
2. **The cart and the order agree.** Anything that changes what a line costs (price lists, breaks, bundles) is worked out by one function
   that `cartSummary()` and `placeOrder()` both call, with a scenario in `checkout-kinds.int.test.ts`, euro included.
3. **Store-scoped.** Every new table holds `store_id`, every query takes it, and an integration test shows one store cannot reach another's
   rules, lists or entries. A rule never reads another store's data.
4. **Copies and personal data.** Every new store-owned table is classified in `COPY_RULES` (catalogue things are copied with the store; who
   is in a company is people's data, `never`), and in `PERSONAL_DATA` or `NOT_PERSONAL`.
5. **Words.** Shopper words in nb, sv, da and en by hand; owner words in the admin catalogues (en and nb, D312); new translatable texts go in
   the translation worklist as well as the editor.
6. **Visitors' pages stay fast.** Listings and product pages stay cached (`'use cache'`, `catalogTag`), nothing per visitor is read in a
   cached function, and nothing new loads zod or `lib/page-content` in a visitor's scripts (D211).
7. **The AI manager and the feeds.** Each unit's things are readable and, where they change the site, changeable through the AI manager's
   tools (gated as rule 2 of `docs/ai-autopilot.md` says); what a shopper sees in a feed (D302) follows the storefront.
8. **Homer and Lisa.** The default screen is the simple one (a category's picture, words and products in order); rules, per-size and
   per-language details are one step away.

## 3. Unit A (D319): collections in depth

Shopify's collections are what Kaizena Flow calls a store's product categories and tags (D50). This unit gives them what a merchant uses
collections for: a page of their own that says something, products in the order the merchant wants, and collections that fill themselves.

### 3.1 A1: a category's or tag's own page

- **Description and picture.** A product category or tag gets a `description` (rich text, D43's Tiptap JSON cleaned by `cleanRichText()`,
  at most 5,000 characters as text) and a picture (`image_url`, `image_thumbnail_url`, from the media library, alt text from it through
  `commerce.media_alt()`). Both are optional; with none the page is as today.
- **Per language.** The name, the description and the picture's alt text are per language: the main language in the columns, the others in
  `terms.texts` (`{ "sv-SE": { "name": "…", "description": {…} } }`, keyed by the store's locale strings as `terms.seo` is), read through
  `termTextFor(term, locale)` (the language's own, else the main language's; never another language's). A slug stays one per term (D168's
  redirects keep working).
- **Shown.** The term's page draws the picture and description above its products (`TermHeader`, a new part of the `category` and `tag`
  page roles, D140, so a store that built its own term page places it); its metadata uses the description's first sentences where the SEO
  description is empty (`termMetaDescription()`), and the picture as its share image where none is set. The sitemap lists the picture
  (`image:image`). Menus, content grids and the chat agent (`navigate`) show the translated name.
- **Translated.** The worklist's `terms` scope adds the name and the description (`termWork()`), applied by `applyTranslations()` like
  the SEO texts; AI suggestions pass `findClaims()`. Menus that link a term (D52) show its translated name.
- **Edited.** `TermsManager` (`src/components/admin/terms.tsx`) opens a term in a panel: name, slug, picture (the library's picker),
  description (the rich-text field the builder uses), SEO (as today) and the product layout; Lisa's step shows the languages.

### 3.2 A1: products in the owner's order

- `product_terms.position` (integer, not null, default the next number for that term): the order of a product within a category or tag. A
  product added to a term comes last; saving a product keeps the positions of the terms it stays in (`saveProduct()` writes only rows it
  adds or removes).
- The term's panel lists its products in order with drag handles (dnd-kit, as the menu editor) and *Move to top* / *Move to bottom*;
  saving writes the positions in one statement (`setTermOrder()`, only the store's own products of that term, positions 0..n-1).
- On a term's page `featured` (the default sort, *Featured* to shoppers) follows the manual order, then the newest; the other sorts are as
  today. A content grid choosing one category or tag with sort `featured` follows it too. Search results and the All products page are
  unchanged.
- A product's nearest category for its layout (D79) is unchanged by order.

### 3.3 A2: collections filled by rules

- **A rule collection** is a product category or tag whose `terms.rules` is set: `{ match: "all" | "any", conditions: [...] }` (at most 10
  conditions), checked by `termRulesSchema` (`src/lib/term-rules.ts`, pure). Its products are never `product_terms` rows (a trigger refuses
  one for a term with rules); they are worked out each time the term is read, so membership follows every change to a product (price,
  stock, tags, status, fields) with nothing re-run.
- **Conditions** (each a case in `ruleCondition()`, `describeRule()` for the words, `ruleClause()` for SQL):
  - in or not in a category (with its subcategories) or tag; a rule collection cannot name another rule collection (no loops);
  - price in the store's home market, as shown with VAT, at least and/or at most (minor units, `current_prices`);
  - in stock (any active variant sellable, `variant_availability`);
  - manufacturer is one of (`products.manufacturer_id`);
  - a variant option has a value (`options->>'size' = 'M'`, the option's name as the store writes it);
  - a public, filterable custom field (D119) equals or, for a number, is in a range;
  - product kind; created in the last N days (*new arrivals*).
- **Never members:** products that are not active or not offered (`OFFERED`, D178), as every listing.
- **Where it works like a manual one:** its page and metadata, menus (D52), content grid sources (`sourceTraits()`, D155) and the
  sitemap. It has no manual order (`featured` is the newest first) and is not a product's "nearest category" for layouts.
- **The editor:** in the term's panel, *Fill this automatically* turns rules on; each condition is a row with a live count of the products
  that match (`countRuleMembers()`, debounced, the store's own products only); turning rules off keeps no members (the owner chooses
  products by hand again, or the panel offers to keep the current matches as manual members).
- **Store-scoped by construction:** `ruleClause()` binds the store id and resolves every id (category, tag, manufacturer, field) against the
  store before it is used; an id of another store is dropped on save (`keepOwnRuleIds()`, as D179's visibility rules do).

### 3.4 The AI manager

`list_categories` (names, kinds, product counts, rules described in words) and `update_category` (description, picture from the library,
order, rules; a published category's change is `public`-gated, its words through `findClaims()`) in `OWNER_TOOLS`, with `TOOL_WORDS` and
`TOOL_PERMISSIONS` (`products:read`/`products:write`).

### 3.5 Data and copies

- `terms`: `description` jsonb, `image_url`, `image_thumbnail_url`, `texts` jsonb (default `{}`), `rules` jsonb (null), checks on shape and
  size; `product_terms.position` integer. No new table.
- `clone_store()` and `duplicate_store()` copy the new columns (rules' ids remapped to the copy's terms and manufacturers; an id that cannot
  be remapped drops its condition); the picture goes through the media rewriting (`mediaUses()`, `rewriteAddresses()`).
- `removeDemoContent()` (D260) keeps a term whose description, picture or order was changed since its mark.

### 3.6 Tests

`term-rules.test.ts` (schema, words, every condition's SQL shape); `collections.int.test.ts`: description and picture per language on the
page and in metadata, a translated name in the worklist and a menu, the manual order on the term page and a grid, positions kept across a
product save, a rule collection following a price change, a stock change, a tag removed and an archived product with nothing re-run, a
rule naming another store's tag dropped, a trigger refusing a manual member of a rule collection, the copy remapping rules; e2e: the
term page's header and order, the panel's drag and live count (signed-in project).

## 4. Units B to I, outlined

### Unit B (D320): variants at scale

`MAX_VARIANTS` becomes 2,048 (three options kept), checked by `productInput`, the import and the tools, and by a database trigger
(`product_variants_limit()`). The editor's variant table becomes a virtualised grid (only the rows on screen are drawn) with a filter per
option value and *Set for all shown* (price per market, stock, SKU pattern, weight, active); one save stays one transaction, with a time
budget held by an integration test at 2,048 variants. The reads that build a product page, a card, the cart, search, JSON-LD and the feeds
are checked for a query per variant (an integration test counts statements). The storefront picker shows each option as a dropdown above
a size the store can set and marks a value that makes no buyable combination with the others chosen (`buyableValues()`, pure).

### Unit C (D321): B2B in depth

- **Price lists** (`price_lists`, `price_list_prices`): a list is assigned to customer groups and companies; each holds, per currency, a
  fixed price per variant or a percentage off the market price. `listPriceFor()` decides a signed-in buyer's price and is what the
  catalogue (per request, inside `<Suspense>`, never in a cached read), `cartSummary()` and `placeOrder()` use; a list price is never shown
  as a reduction (no struck-through price, no 30-day reference; decision 3).
- **Catalogues**: a list may also limit what its buyers see (products or categories); a product hidden from a buyer is out of listings,
  search, recommendations, the sitemap and feeds for everyone not in a list that includes it, and its address answers not found. Products
  stay public unless a list is set to "only these" (decision 4).
- **Companies**: locations (`company_locations`: billing and shipping addresses), buyers assigned to locations with a role (`buyer`,
  `orderer`, `approver`), an approval limit per company in its credit currency, and a PO number asked at checkout, kept on the order,
  invoice and credit notes, and in the order list's search. An order over the limit waits as `awaiting_approval` before payment
  (decision 7).

### Unit D (D322): bundles

A product of kind `bundle` with components (`bundle_components`: variant and quantity, 2 to 20 components, goods only, all of one VAT
category; decision 2), priced fixed or as the sum of its components less a percentage. Its stock is the lowest whole number of bundles the
components' sellable stock allows (`bundleStock()`, read through `variant_availability`); a bundle with a sold-out component cannot be
bought. `placeOrder()` reserves each component's stock (D172's `allocate()` on the components) and writes the components on the order line
(`order_line_components`, frozen); a refund or return restocks the components in proportion (`restockPlan()`). It is a product of its
own for search, listings, feeds and reviews; a demo bundle is added to the template (CLAUDE.md "Demo products").

### Unit E (D323): quantity rules and price breaks

Per variant (and per price-list price): `min_quantity`, `max_quantity`, `quantity_step`, checked by `quantityProblem()` in the cart's add
and change, in `placeOrder()` and in the WordPress cart (D170); and breaks (`from` units: a unit price or a percentage), applied by
`breakPrice()` in `cartSummary()` and `placeOrder()` and shown on the product page as a table. `MAX_LINE_QUANTITY` rises to the variant's
maximum (at most 9,999) where one is set. Breaks are not reductions under the 30-day rule (decision 3).

### Unit F (D324): search merchandising

Synonym groups per language (`search_synonyms`: two-way groups and one-way "this means that"), expanded in `rankedSearch()`'s keyword part
(`websearch_to_tsquery` with the group's words OR'd) and in query understanding; boosts, buries and pins (`search_rules`: a product or a
category, for every search or for queries matching words, pins first in their order) applied after the fusion and before paging. The
zero-result report offers *Add a synonym* and *Send this search to a page* (a search redirect). Every change is part of the search cache's
key (`cached()`, a merchandising version per store) so no stale result is served. Copied with the store.

### Unit G (D325): videos and 3D in the gallery

`product_media` gains a `kind` (`image`, `video`, `model`): a video is uploaded (D86's `VideoUploadButton`, compressed by D213) with a
poster, or a YouTube or Vimeo address (`EmbeddedVideo`, nothing loaded before its play press); a model is a GLB or glTF file shown with
`<model-viewer>` loaded only on the pages that have one, with the poster as the fallback (decision 5). Alt text per language for every
item, the library's `mediaUses()` covers them, and the limits (items, sizes, durations) are stated in the editor and enforced on the
server. The order is the owner's, the first item the card's picture (a picture, or a video's poster).

### Unit H (D326): content types

An owner defines a type (`content_types`: name, slug, fields from `FIELD_TYPES`, which field is the title, whether entries have pages) and
creates entries (`content_entries`: draft and published, texts per language, D55's model), on a page of their own under Website. A
relation field (D119) may point at a type's entries; deleting an entry clears the references. A content grid and a field loop (D120) list a
type's entries; a type with pages serves `/{type-slug}/{entry-slug}` through a page role drawing the entry (`entry` blocks bound to its
fields, D119), with title, search texts and a sitemap entry only when published. Entries are in the translation worklist and copied with
the store. Platform and stores alike (Kaizena Flow's own site can have types too).

### Unit I (D327): a standard product taxonomy

A product may be given a category from a standard taxonomy (decision 1) kept apart from the store's own categories and the tax code
(`products.standard_category`, a stable id). A searchable picker in the product editor; the category's attributes (colour, size, material,
…) are offered as a field group and as listing filters, values checked against the category; the feeds (D302) send the category (and
Google's id where the taxonomy maps to it). A model may suggest a category from the product's own words, which staff accept (feature
`product_taxonomy`, through the D76 writer's rules).

## 5. Decisions needed from the owner

| # | Decision | Options | Recommendation |
|---|---|---|---|
| 1 | **Which standard taxonomy** (unit I) | Shopify's open Standard Product Taxonomy (published on GitHub with attributes and a mapping to Google's); Google's product taxonomy (categories only, what Merchant Center reads); none | Shopify's open taxonomy, with its mapping to Google's ids for the feeds, after its licence is read and recorded when the unit is built; a taxonomy update is a migration. |
| 2 | **A bundle's VAT** (unit D) | Components must share one VAT category; mixed categories split the price by component | One category per bundle in this wave. A mixed supply's split is a rule that differs by country and needs an accountant; refused with a plain message until then. |
| 3 | **Price lists and breaks under the 30-day rule** (units C, E) | Shown as reductions with a 30-day reference; shown as the buyer's own price, never struck through | The buyer's own price, never shown as a reduction: a list price is an agreed price for a signed-in buyer, and a break is the price at that quantity, so neither is an advertised reduction (the Omnibus rule in `docs/wave-1-trust.md` stays as it is for campaigns and codes). Needs the same legal review as the other consumer texts. |
| 4 | **What a catalogue hides** (unit C) | A list only changes prices; a list can also hide products from everyone outside it | Both, chosen per list ("Only these products for these buyers"); hidden products answer not found to others, so a B2B-only range is possible. |
| 5 | **3D models** (unit G) | Videos only; videos and 3D with Google's `<model-viewer>` (Apache 2.0) loaded only where a model is | Videos and 3D, `<model-viewer>` self-hosted under `public/` and loaded only on product pages that have a model, never on pay routes. |
| 6 | **Combined listings** | Build now; leave | Leave: Shopify offers it only on Plus, weight 1; unit B's larger variant limit covers most of the need. The row stays missing with this reason. |
| 7 | **Order approvals** (unit C) | Approval before payment for every company order over the limit; only for orders on payment terms | Every order over the company's limit waits for an approver before the buyer pays (the order is placed, stock held for the approval window of 7 days, then paid by card or on terms), emailed to the approvers; never for consumers. |
| 8 | **Order of units** | As in section 1; or B2B (C) first | As in section 1: collections (the must-have) first, then variants, then B2B. |
