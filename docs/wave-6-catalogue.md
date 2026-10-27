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
- **Shown.** The term's page draws the picture and description above its products (`TermHeader`, drawn by `TermListing`, which the
  *Category products* component of a built `category` or `tag` page (D140) draws too, so a store's own term page has it); its metadata uses the description's first sentences where the SEO
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
- The term's row has *Order products*: its own products (not its subcategories') in order, each with *Move to top*, *up*, *down* and
  *Move to bottom*; saving writes the positions in one statement (`setTermOrder()`, only the store's own products of that term, positions
  0..n-1, the rest none).
- On a term's page `featured` (the default sort, *Featured* to shoppers) follows the manual order, then the others by when they were made
  (as `featured` was before); the other sorts are as today. A content grid of products choosing exactly one category or tag with the sort
  *Your order* (`manual`) follows it too (with none or several chosen there is no one order: newest first). Search results and the All
  products page are unchanged.
- A product's nearest category for its layout (D79) is unchanged by order.

### 3.3 A2: collections filled by rules

- **A rule collection** is a product category or tag whose `terms.rules` is set: `{ match: "all" | "any", conditions: [...] }` (at most 10
  conditions), checked by `termRulesSchema` (`src/lib/term-rules.ts`, pure). Its products are never `product_terms` rows (a trigger refuses
  one for a term with rules); they are worked out each time the term is read, so membership follows every change to a product (price,
  stock, tags, status, fields) with nothing re-run.
- **Conditions** (each a case in `conditionSchema`, `describeCondition()` for the words and `commerce.product_matches_condition()` for SQL):
  - in or not in a category (with its subcategories) or tag; a rule collection cannot name another rule collection (no loops);
  - price in the store's home market, as shown with VAT, at least and/or at most (minor units, `current_prices`; any active variant in range);
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
- **Store-scoped by construction:** the evaluator reads only the store's own rows, and `checkedRules()` resolves every id (category, tag,
  manufacturer, field) against the store before it is saved; an id of another store is dropped on save (`keepOwnIds()`, as D179's visibility
  rules do).

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

### 3.7 As built: A1 (2026-10-25)

- `terms.description`, `image_url`, `image_thumbnail_url`, `texts` and `product_terms.position` (migration `collections`; checks: page parts
  only on a store's product terms, `terms_page_parts`; a small copy needs its picture; positions from 0). `collections_copy` patches
  `clone_store()` and `duplicate_store()` to carry them; the store copy's picture step moves a term's picture (`store-copy-media.ts`), and
  the media library counts it as a use and moves it on Compress (`mediaUses()`, `rewriteAddresses()`).
- `src/lib/term-texts.ts` (pure): `cleanTermDescription()`, `termTextsInput(locales, main)`, `parseTermTexts()`, `termTextFor()`,
  `termsIn()`, `descriptionSummary()`. `termInput` carries the page parts unchecked (a cycle with `page-content` is avoided); the server
  checks them (`checkedPage()` in `src/server/taxonomy.ts`); a part left out of a save stays as it is.
- The order: `setTermOrder()` and `termProducts()` (`src/server/taxonomy.ts`), `manualPlace()` (`src/server/product-conditions.ts`) read by
  `listGridProducts()` (sort `manual` with `orderTerm`) and `listingProducts()` (`ListingScope.orderTerm`); `saveProduct()` now writes only
  the product terms it adds or removes, so a place survives a save.
- The storefront: `TermHeader` in `term-listing.tsx` (picture with the library's alt text in the page's language, name, description); the
  metadata's description falls back to the description's first sentences (`descriptionSummary()`) and its share picture to the term's own;
  the sitemap lists the picture. Names in the shopper's language in menus (`store-layout.tsx`, the builder's menu preview), the listing's
  filters and the chat's `navigate`.
- Translation: the `terms` scope lists each term's name and description (as runs) beside its search texts (`termUnit()`'s `page`), applied
  into `terms.texts` by `writeTerm()`; a description changed since it was translated is left out.
- The admin: the categories page passes `page` to `TermsManager`: `TermPageFields` (picture, description per language, other languages'
  names) in a term's edit form and `TermProductOrder` (*Order products*) on its row, with words in the `products` catalogue (`termPage`, en
  and nb). Content grids offer *Your order (one category or tag)*.
- Tests: `term-texts.test.ts`, `store-translate.test.ts`, `commerce.test.ts` (the rules and the copy), `collections.int.test.ts` (the page
  per language and its refusals, the worklist and the apply, the order on the grid and the listing, kept across a product save, another
  store's product never placed), `store-translate.int.test.ts` updated (every term now brings its name).
- A2, the AI manager's tools (3.4) and the e2e came next (3.8).

### 3.8 As built: A2 and the AI manager's tools (2026-10-25)

- `terms.rules` (migration `collection_rules`; check `terms_rules`: a store's product term only, never one that needs a unit price) and
  `collection_rules_sql`: the one evaluator, `commerce.product_matches_rules(store, product, rules)` over
  `commerce.product_matches_condition()` (plpgsql, `STABLE`, every value read by its JSON type so a wrong shape is no match and never
  raises, only active products, a `term` condition reading only `product_terms` so a collection cannot loop); triggers
  `product_terms_not_rules` (no products placed in a collection filled by rules) and `terms_rules_without_members` (rules only once the
  products placed by hand are out); `commerce.clone_term_rules()` remaps term and manufacturer ids, patched into `clone_store()` and
  `duplicate_store()`.
- Readers: `inTerms(ids)` in `src/server/product-conditions.ts` (placed by hand, or a collection whose rules the product meets) is what
  `listGridProducts()`, `listingProducts()`/`listingFacets()` and content grids ask; `inCategories()`/`withTags()` (search's and the
  listing's filters by address) and the sitemap's `listIndexedTerms()` read rules too; `termsOfProducts()` (campaigns and codes, so cart
  and checkout agree) and the campaign notices count the collections a product meets. `manualPlace()` puts a collection filled by rules
  newest first, so its page, *Featured* and a grid's *Your order* need nothing else. `scopedTermIds()` never places a product or page in
  one, so the product editor and imports cannot; the product editor shows it greyed (*filled by rules*), and the AI manager's product
  tools refuse to name it.
- Server: `src/server/term-rules.ts` (`ruleChoices()`, `checkedRules()`, `namedByRules()`, `countRuleMembers()` with each condition's
  count, `ruleMemberIds()`); `createTerm()`/`updateTerm()` take `rules` (turning on deletes the products placed by hand in the same
  transaction; turning off with `keepMatches` places what matched); a term another collection's rules name stays filled by hand;
  `termProducts()` lists what the rules hold; `setTermOrder()` refuses.
- Admin: `TermRulesFields` (`src/components/admin/term-rules-fields.tsx`) in the term's form: *Fill this automatically*, all or any, a row
  per condition with its own count and the whole count (debounced, the server's), the warning that hand-placed products are taken out,
  and *Keep the products that match now* when turning off; words in the `products` catalogue (`termRules`, en and nb). The row says
  *Filled by rules: n conditions* and offers no order.
- The AI manager: `list_categories` (`products:read`: names, addresses, counts, rules in words) and `update_category` (`products:write`,
  gated `public`: description through `findClaims()`, picture from the library, order by handle, rules with every name found in the store)
  in `src/lib/category-tools.ts` and `src/server/category-tools.ts`, through `updateTerm()` and `setTermOrder()`; preflight and approval
  words from the store; autonomy area `catalogue`.
- Tests: `term-rules.test.ts`; `commerce.test.ts` (the evaluator, the triggers, the copy); `collections.int.test.ts` (grid, listing and
  sitemap, a change followed at once, the count, campaigns' reach, foreign ids dropped, no loops, a product's save never placing, turning
  on and off, the AI tools); `e2e/signed-in/collections.spec.ts` (a description written in the panel shown on the page; a tag filled by
  rules with its live count, its page listing what the rules hold).
- Fixed on the way: A1's term page read its picture's alt text uncached, which broke the page's render for a term with a picture (found
  by the e2e); it is now read once and cached with the catalogue (`pictureAlt()` in `term-listing.tsx`).
- What A2 left (dragging in the order panel, collections filled by rules as filter choices) is A3 (3.9).

### 3.9 As built: A3 (2026-10-25)

- The order panel (`TermProductOrder`, `src/components/admin/term-page-fields.tsx`) is a dnd-kit sortable list: each row (`OrderRow`) has a
  handle to drag it, which the keyboard moves too (Space, the arrows, Space), beside the buttons that were there; the order is still saved
  in one press through `setTermOrder()`. A screen reader hears the product's name and place while it moves (`accessibility.announcements`,
  never dnd-kit's own words, which name ids) and how to move one. Words: `termPage.drag*` and the hint, en and nb.
- The shop's filter dialog lists a collection filled by rules beside those filled by hand, with its count: `listingFacets()` adds the
  collections each product of the page meets (`commerce.product_matches_rules()`) to the products' terms; choosing one filters through
  `inCategories()`/`withTags()`, which read rules since A2.
- Tests: `collections.int.test.ts` (the facet and its filter), `e2e/signed-in/collections.spec.ts` (a product dragged up by the keyboard and
  the order saved, waiting for what dnd-kit says before each key, since it measures the list after the lift).

## 4. Units B to I, outlined

### Unit B (D320): variants at scale

Detailed on 2026-10-25 from a read of the code, when its turn came. Shopify allows 3 options and 2,048 variants a product; Kaizena Flow
allowed 3 and 100. Built in three steps, each its own commit: B1 the limit, the save and the reads; B2 the editor's grid; B3 the shop's
picker.

**What the code does today.** The editor makes one variant per combination of option values (`variantsFor()` over `combineOptions()`)
and draws one table row each, every row with its own fields. `saveVariants()` writes each variant with its own statement, reads and sets
each price per market with two more, and writes each variant's stock with up to three, so a save of 2,048 variants in three markets is
some 15,000 statements in one transaction. The shop's buy part (`ProductBuy` in `product-parts.tsx`) offers every variant in one
`Dropdown`, each with a price drawn by the server (`<Price>` inside `PlanPrice`), so the part's payload grows with every variant. The
reads that build a product page, a card, the cart, search, JSON-LD and the feeds read variants in one query each already (no loop over
variants found); nothing holds them to that.

#### B.1 The limit (B1)

- `MAX_VARIANTS` is 2,048 (`MAX_OPTIONS` stays 3), read by `productInput`, the CSV import (`options.too_many`) and the AI manager's
  catalogue tools from the same constant. An option has at most `MAX_VARIANTS` values, so the editor never builds a combination list it
  must then refuse.
- The database holds it too: `commerce.product_variants_limit()`, a deferred constraint trigger on `product_variants`, refuses at commit a
  product with more than 2,048 **active** variants (switched-off variants are history, D-rule "never deleted", and do not count). It is
  deferred because a save inserts new combinations before it switches off the ones taken out. Its error (`variants.too_many`) becomes the
  owner's sentence in `saveProblem()`.
- The editor's request stays under the server actions' 4 MB limit at 2,048 variants in three markets (a unit test measures the JSON of
  such a product).

#### B.2 One save, set-based (B1)

`saveVariants()` keeps its rules (variants taken out are switched off, prices only through `commerce.set_price`, stock through
`writeStock()`'s rules and `withStockContext()`, levels locked in variant order) and writes them a few statements at a time, whatever the
number of variants:

- one read of the product's variants with their current prices;
- one `update … from jsonb_to_recordset()` for the variants kept, one `insert … select … returning` for the new ones;
- one `select commerce.set_price(…) from jsonb_to_recordset()` for the prices that changed, one `update` ending the prices taken away;
- stock: one insert for new variants' opening levels, one read of the existing levels `for update` in variant order, and one write per
  reason (`opening`, `correction`) with the figures worked out in code from what was read, as `writeStock()` decides them today;
- one `update` switching off the variants taken out.

An integration test (`variants-scale.int.test.ts`) saves a product of 2,048 variants (16 × 16 × 8) in three markets, then saves it again
with every price and stock changed, and holds each save under a time budget (`SAVE_BUDGET_MS`, 20 s on CI: a few times what it takes,
so only a save that has gone back to a statement per variant breaks it); it checks the prices' history and the stock movements are those
of the old one-by-one save.

#### B.3 Reads that do not grow per variant (B1)

The same test counts the statements (`pg`'s `Client.prototype.query`) of the reads a shopper's page and the store's jobs make for one
product, at 2 variants and at 2,048: the product page (`getProductDetail()` and the buy part's stock, `getVariantStock()`), a product card
(`listGridProducts()`), the listing (`listingProducts()`), search (`searchProducts()`), the cart (adding a variant and `cartSummary()`),
JSON-LD (`productJsonLd()`, pure, from the page's own read) and the feed (`storeFeed()`). Each count must be the same at both sizes.

#### B.4 The editor's grid (B2)

- From 13 variants (`GRID_FROM`) the variant table draws only the rows on screen (`useVirtualRows()` in `src/components/admin/virtual-rows.ts`:
  each variant's rows are a `<tbody>` of their own, measured while drawn and again when a section opens inside it, the rest counted at an
  estimate, a spacer above and below; `aria-rowcount` and `aria-rowindex` keep the table's size for screen readers; no new dependency), so a
  product of 2,048 variants opens and types without freezing. With fewer, every row is drawn, as before (Homer's product has a few). A variant's
  custom fields (D119) are drawn only while its section is open.
- From the same size, a filter per option (*All* or one value) with *Showing 64 of 2,048 variants*; for any product of several variants
  **Set for all shown**, one step away (a button that opens the fields): a price per market, stock, a SKU pattern (`{handle}`, `{n}` and an
  option's name, `skuFromPattern()`, refused while it names no option or would give two variants one SKU, `skuPatternProblem()`), weight, and
  for sale or not. Only the fields filled in are set, only on the variants the filter shows (stock and weight only on those shipped), as one
  change the owner then saves with the rest.
- The pure parts are `src/lib/variant-grid.ts` (`filterVariants()`, `setForShown()`, `skuFromPattern()`, `skuPatternProblem()`,
  `visibleRange()`), unit-tested; the words are the `product` catalogue's `grid` (en, nb).

#### B.5 The shop's picker (B3)

- A product of a few variants keeps today's one dropdown with each variant's picture, stock and price. From a number of variants the store
  sets on the buy part of its product layout (`optionsFrom`, default `OPTIONS_FROM` = 12, *Each option its own list from* in the builder's
  product part fields), each option is a dropdown of its own (Colour, then Size, …), and the chosen variant's picture (the gallery, D84), stock,
  price and Add to cart follow the values chosen. The phone's bar then names the variant chosen and adds it, with no list of every variant
  (`ProductBar`'s `choosesOnPage`).
- A value that makes no buyable variant with the other values chosen is marked (*Not available*, still listed, skipped by the keyboard), worked
  out only by `buyableValues()` (`src/lib/variant-options.ts`, pure: per option, the values with at least one variant that is for sale and in
  stock, on backorder or a download, matching the other chosen values). The chosen variant's own value stays choosable. Choosing a value moves to
  the variant with every value chosen when it can be bought, else the buyable one with that value keeping the most of the others
  (`nearestVariant()`), else the exact one, shown sold out.
- The part's payload stops growing with each variant's price: the server draws one price per distinct price (`OfferedPrice`) and each variant
  names its own by place (`priceIndex`).
- Words: `m.variantUnavailable` in nb, sv, da and en by hand.

#### B.8 As built: B2 and B3 (2026-10-25)

- The editor (`product-editor.tsx`): `VariantGridTools` above the table (the filter from `GRID_FROM` variants, *Set for all shown* for any product
  of several), the table's rows drawn through `useVirtualRows()` from the same size, each variant's rows a `<tbody>` measured by one
  `ResizeObserver`, counts written in the admin's language. A variant's custom fields are drawn only while its section is open.
- The shop (`variant-choice.tsx`, `product-parts.tsx`, `product-bar.tsx`): `OptionLists` from the buy part's `optionsFrom` (`ProductBlock`,
  checked 2 to 2,048 by the page schema, the builder's *Each option its own list from*), values marked by `buyableValues()` and moved to by
  `nearestVariant()`; one price drawn per distinct price (`OfferedPrice`, `priceIndex`); the phone's bar names the chosen variant
  (`choosesOnPage`). `m.variantUnavailable` in four languages.
- Tests: `variant-grid.test.ts`, `variant-options.test.ts`, `variant-choice.test.ts` (a list per option from 12, one list below the store's
  number, the price drawn once), and `e2e/signed-in/variants-scale.spec.ts`: the editor of a product of 2,048 variants draws fewer than 100 rows,
  reaches the last one by scrolling, filters to 128 by a colour and sets their price, saved and read back from the database; a shop's product of
  12 variants offers a list per option, marks green (no size to buy) and blue M (sold out), and adds blue L.

#### B.6 Elsewhere

- The products grid (D165) and the order, draft and exchange editors list a product's variants as they did; a product of thousands of
  variants is searched by SKU there, as it is today.
- The feed is one item per variant (D302), so a 2,048-variant product is 2,048 items; JSON-LD's `ProductGroup` lists every variant, as
  Google's guidance for variant groups asks.
- Parity: `catalogue.products-with-variants-and-options-limits` closes with B3, its evidence the tests above.

### Unit C (D321): B2B in depth

Detailed on 2026-10-26 from a read of the code, when its turn came. Built in three steps, each its own commit: C1 price lists, C2 company
locations, roles, approvals and PO numbers, C3 catalogues that hide products.

**What the code does today.** A customer's group (`customer_tiers`) and company (`customer_companies`, roles `owner` and `employee`) give
one whole percentage off what is bought once (`memberDiscountFor()`, `memberLineOff()`), the same in `cartSummary()` and `placeOrder()`.
The cart and checkout read a line's price from `commerce.current_prices` in SQL (`getCart()`, `orderLineRows()`), in the country's own
currency, shown converted by `shown()`. The buy part of a product page is drawn per request inside `<Suspense>` (stock, `MemberNotice`);
listings, cards and the rest of the product page are cached for everyone. A product is offered to shoppers through `OFFERED`
(`src/server/product-conditions.ts`).

#### C.1 Price lists (C1)

- A **price list** (`commerce.price_lists`: name, an optional percentage off, active) is assigned to customer groups and companies
  (`price_list_assignments`, one target each: `tier_id` or `company_id`). It holds **fixed prices** per variant and currency
  (`price_list_prices`: VAT included, as market prices are, in minor units) and, with a percentage, takes that off the market price of the
  products in its scope. Its scope (`price_list_products`: products or product categories) is every product while empty.
- A buyer's lists are those of their own active group, their company (active, *Sell to businesses* on, the buyer its owner or employee) and
  their company's active group. For each variant the **lowest** price any of them gives wins, never above the market price: a fixed price
  in the market's own currency, else the percentage on the market price for a product in scope (half up to the minor unit). Worked out
  only by `commerce.buyer_price(store, customer, variant, market, market_amount)` (SQL, returning the price and the list), used by the cart
  (`getCart()`), checkout (`orderLineRows()`) and the product page's buy part (`listPricesFor()`), so the three agree.
- A list price applies to goods and appointments **bought once**: never to a purchase option (subscriptions keep their own discount), a
  stay's or rental's season pricing, or a gift card. A line priced by a list takes **no group or company percentage** on top (the list is
  the agreed price, D108's percentage is for lines without one); campaigns, codes, credits and the VAT rules apply as to any line.
- A list price is the buyer's own price, **never shown as a reduction** (decision 3): no struck-through price, no 30-day reference, no
  "save" words. The buy part draws it with `<Price>` given no reference, and says *Your price* (`m.yourPrice`, four languages).
  Cards and listings stay cached with the market price.
- The order keeps which list priced a line (`order_lines.price_list_id`), for the record and the analytics; the line's price is its own
  as ever. `cartSummary()` and `placeOrder()` agree on list prices with VAT in a euro scenario (`checkout-kinds.int.test.ts`).
- Admin: Customers → *Price lists* (`/admin/{store}/price-lists`, `customers:read`/`customers:write`): a list's name, percentage, scope,
  who it is for (groups and companies), and fixed prices per variant and currency through a product search (a CSV import is wave 7). Words in
  the `customers` catalogue (en, nb). The AI manager reads lists (`list_price_lists`, ungated); changing one is a person's.
- Copies: price lists are `never` in `COPY_RULES` (they name the store's own groups, companies and variants; decided when built, see
  C.4); not personal data (`NOT_PERSONAL`).

#### C.2 Company accounts in depth (C2)

- **Locations** (`company_locations`: a name, a billing address and a shipping address, at most 50 a company), edited by staff on the
  company's page and by the company's main account under *Your company*. A company member buys **for a location** they are assigned to
  (`company_location_buyers`: customer, location, role); checkout asks which (a member of one location is not asked) and fills its
  shipping address, the order keeping the location (`orders.company_location_id`) beside its own address snapshot.
- **Roles** at a location: `orderer` (places orders; over the limit they wait for approval) and `approver` (places orders and approves
  others' at that location). The company's main account is an approver at every location. A member with no location buys as today.
- **Approval**: a company's `approval_limit_minor` (in its credit currency, null for none). An orderer's order whose total (converted at the
  store's rates) is over it is placed and **waits for approval** before payment (decision 7): `orders.approval` (`waiting`, `approved`,
  `declined`), stock held for the approval window (`APPROVAL_DAYS`, 7) as a draft's is, the approvers emailed (`company.approval_waiting`,
  a staff-free email to the company's approvers at that location). An approver approves or declines from *Your company → Orders to
  approve*; an approved order is paid by the buyer through the order's pay link (Stripe's hosted page, as a draft's, D173) or on terms
  (D293) when the company has them; a declined or expired one is cancelled through `cancel_unpaid_order()`, releasing its stock. Never for a
  consumer, never for an approver's own order.
- **PO number**: asked at checkout for a company member (`orders.po_number`, at most 40 characters, required when the company says so,
  `customer_companies.po_required`), kept on the order, its invoice and credit notes (the snapshot's `poNumber`, SQL and
  `buildInvoiceSnapshot()` alike), shown on the order page, and matched by the order list's search. A euro scenario holds it.
- Shopper words (`m.companyAccount.*`) in nb, sv, da and en by hand; the approval email in `email-text.ts`. Locations and assignments are
  personal data (`PERSONAL_DATA`: erasure removes the buyer's assignments; the company's locations are the company's, `NOT_PERSONAL`);
  `COPY_RULES` `never`.

#### C.3 Catalogues (C3)

- A price list may be **exclusive** (*Only these products for these buyers*, decision 4; needs a scope): its scope's products are offered
  only to its buyers. For everyone else they are out of listings, search, recommendations, the sitemap, feeds and the chat agent, and their
  address answers not found: `OFFERED` (the shopper-facing condition, used by the cached reads) leaves out a product any exclusive list
  covers (`commerce.product_exclusive()`), and the reads made per request for a known buyer (the cart, checkout, the buyer's catalogue) ask
  `offeredTo(customer)` (`commerce.buyer_sees()`).
- A buyer reaches their exclusive products on **Your catalogue** (`/s/{store}/{market}/account/catalogue`, per request, signed in): the
  products their lists make theirs, each with its variants, their price and Add to cart. Product pages stay cached for everyone, so an
  exclusive product has no public page (the shared page cannot know the buyer).
- `catalogue.b2b-catalogs-and-price-lists` closes with C3, `catalogue.b2b-company-accounts` with C2.

#### C.4 As built: C1 (2026-10-26)

- Migrations `20261026014954_price_lists` (the four tables and `order_lines.price_list_id`) and `20261026015020_price_lists_sql` (row
  security, `commerce.buyer_lists()`, `commerce.price_list_covers()` and `commerce.buyer_price()`). A category in a list's scope reaches its
  subcategories, and a category filled by rules (D319) reaches what its rules match.
- `getCart()` and `orderLineRows()` take the price as `coalesce(buyer_price, market price)` under `LIST_PRICED`
  (`src/server/product-conditions.ts`: no purchase option, kind `goods` or `appointment`), so a line's `unitPriceMinor` is the list price
  and `cartSummary()`'s and `placeOrder()`'s group percentage and a code's per-unit figure skip a line with a `priceListId`. A campaign's
  free product is never list-priced. `getCart()` reads the signed-in customer itself unless told who (`bonus.ts` passes it).
- The buy part reads `listPricesFor()` only for a product with no purchase options, and the appointment picker for an appointment, each
  with `shown()` and *Your price*; the phone's bar carries the same amount. `MemberNotice` still names the group's percentage, which the
  cart gives to lines no list prices.
- Drafts (D173), order changes (D174) and exchanges (D239) are priced by their own builders at the market price: staff choose those prices.
- `COPY_RULES` `never` for the four tables (a copy starts with no lists rather than half-assigned ones; the spec's `catalogue` would have
  needed `duplicate_store()` rewritten for little gain). The admin is `/admin/{store}/price-lists` and `[listId]` (settings, who, the
  percentage's scope, fixed prices through a product search by title, handle or SKU), the AI manager's `list_price_lists`
  (`customers:read`, feature `shop`, read-only). Held by `src/db/commerce.test.ts` (the SQL), `price-lists.int.test.ts` (the writers and
  the reader) and the euro scenario in `checkout-kinds.int.test.ts` (cart, summary and order agree; the lowest list wins; no group
  percentage on top; the order line keeps its list).

#### C.5 As built: C2 (2026-10-26)

- Migrations `20261026020420_company_buying` (`company_locations`, `company_location_buyers`, the company's `po_required`,
  `approval_limit_minor` and `approval_currency`, the cart's and order's `company_location_id` and `po_number`, the order's `approval`,
  `approval_decided_by`, `approval_decided_at`) and `20261026020441_company_buying_sql` (row security; at most 50 locations a company,
  `company_locations_max()`; only an employee of the location's company has a row, `company_location_buyers_member()`, and leaving the company
  takes the rows away, `customers_leave_locations()`; an order keeps its location and PO number and its approval only moves from waiting,
  `orders_company_purchase()`; the PO number goes into the order's own invoice and from it into its credit notes, `documents_po_number()`).
- Staff edit locations, who buys at each and the buying rules on the company's page (`LocationsCard`, `src/server/company-locations.ts`). The
  main account is not given a row: it approves at every location. Members do not edit locations (as Shopify's B2B, where the merchant keeps
  them); the spec's *Your company* editing is not built.
- The cart asks a company member for the location (when they buy for more than one) and the PO number (`CompanyPurchase`, a plain form,
  `setCartCompanyPurchase()`), and says when an order over the limit will wait. `placeOrder()` checks both again inside its transaction
  (`buyerFacts()`; refusals `location`, `po_number`) and decides the approval by `needsApproval()`: only an orderer's order, the total converted
  into the limit's currency at the store's rates, one that cannot be converted waiting. Only goods bought once can wait, never with gift cards
  (refused as `approval`). A waiting order holds its stock until `APPROVAL_DAYS` after it was placed, starts no payment and converts its cart;
  on terms, who pays and the store's terms are recorded at once and the approval confirms it (`confirmOnTerms()`).
- The location's shipping address is not filled into the order: the payment page asks for the address as before. The order shows the location.
- *Your company* (`/account/company`) lists the orders to approve and the member's own waiting orders (`CompanyApprovals`); an approver
  approves or declines (`decideOrder()`, under the order's lock, the right read again), and the buyer pays an approved order on Stripe's
  hosted page with the store's terms recorded first (`startApprovedPayment()`, `ApprovedPayForm`). A lapsed session leaves an approved order
  as it is (`payment-outcome.ts` treats it as a draft's), held credits are not let go by the bonus sweep, and `expireApprovals()` in the
  five-minute job cancels any that waited, or waited for payment, longer than the window. Emails: `company.approval_waiting` to each approver
  and `company.approval_decided` to the buyer (`src/lib/approval-email-text.ts`, by hand in four languages, `HAND_WRITTEN_ONLY`).
- The PO number is on the admin order page, the order list's search and the invoice and credit note (`snapshot.poNumber`, the parity test's
  facts carry it). Location roles are personal data (export section `company`, erased with the person); locations are the company's
  (`NOT_PERSONAL`); both `never` in `COPY_RULES`. Held by `src/db/commerce.test.ts` and the euro scenario in `checkout-kinds.int.test.ts`.

#### C.6 As built: C3 (2026-10-26)

- Migrations `20261026082711_exclusive_catalogues` (`price_lists.exclusive`, and covering indexes for five foreign keys of C1 and C2) and `20261026082746_exclusive_catalogues_sql`
  (`commerce.product_exclusive()`, `commerce.buyer_sees()`, a partial index). A list marked exclusive hides only while it is on and has a scope:
  with nothing chosen it hides nothing, so a slip never empties the shop.
- `OFFERED` leaves out a product an exclusive list reaches, so every read made for everyone (listings, search, the product page, the
  sitemap, recommendations, feeds, the chat's reads, WordPress) leaves it out and its address answers not found. `offeredTo(customer)` is the
  same conditions with `buyer_sees()` and is asked by the cart (its lines and the add, `sellableQuantity()` reading the signed-in customer) and
  checkout (`orderLineRows()`), so a list's buyer can buy what the list makes theirs and nobody else can. The audience scan accepts either.
- *Your catalogue* (`/account/catalogue`, signed in, per request; `buyerCatalogue()`, linked from My account by `hasBuyerCatalogue()`) lists
  the goods bought once that the buyer's exclusive lists reach, each variant with *Your price* where a list prices it and a plain Add to cart
  (`addFromCatalogueAction()`, the cart's own add). Appointments, stays, rentals and products sold by subscription are not offered there.
- A change to a list refreshes the store's cached catalogue reads (`catalogTag`). The admin's list page has the switch (*Only these products
  for these buyers*) and shows the scope card for an exclusive list without a percentage; the AI manager's `list_price_lists` says
  `only_for_its_buyers`. Held by `src/db/commerce.test.ts` and the euro scenario in `checkout-kinds.int.test.ts`.

### Unit D (D322): bundles

Detailed on 2026-10-26 from a read of the code, when its turn came. Built in two steps, each its own commit: D1 the bundle and its sale, D2
bundles after the sale and around the store.

**What the code does today.** A product is one of `PRODUCT_KINDS` with variants; a goods variant's stock is `inventory_levels` per location,
read only through `commerce.variant_availability` (`in_stock`, `can_buy`), which every reader asks (the product page, listings, the cart's
`sellableQuantity()`, feeds, the chat, WordPress, back-in-stock). `placeOrder()` asks `allocateStock()` for the physical lines' variants
(`allocate()`: summed per variant, `deny` wins) and holds the units as `inventory_reservations` per variant and location; payment's
`commerce.draw_order_stock()` draws them from `order_lines` (physical, grouped by variant). Every restock (a refund, a cancellation, a return,
an order change) goes through `planRestock()`, limited by the order's own `sale` movements per variant. Prices are `commerce.prices` per
variant and market, only through `commerce.set_price()`; `current_prices` adds the 30-day reference. A product page is a layout of parts; its
details are cached, the buy part streams in.

#### D.1 The bundle

- A new kind `bundle` (`PRODUCT_KINDS`, the `products_kind` check). A bundle has **one variant** (no options, no purchase options, no
  files), delivered as physical goods; it holds no stock of its own (a level for a bundle's variant is refused by the database).
- Its components are `commerce.bundle_components` (store, the bundle's variant, a component variant, a quantity 1 to 99, a position): at
  most 20 components, and at least two units in all (one variant twice is a multipack), so "2 to 20 components" of the outline counts units at
  the low end. A component is an active-or-draft **goods** variant delivered physically, of the same store, not itself a bundle's, and of the
  bundle's VAT category (decision 2). The database holds the per-component rules when components are written and when the bundle's own VAT
  category or kind changes (a deferred constraint trigger); a change to a component is never refused for its bundle's sake: a component that
  moves to another VAT category, stops being physical goods or is archived makes the bundle one that cannot be bought until the owner puts it
  right. The count rules are the editor's (`productProblems()`), so a store copy of part of a catalogue never fails on a bundle whose
  components were left behind (that bundle simply cannot be bought).
- **Price**, `products.bundle_pricing`: `fixed` (the variant's own prices, as any product's) or `computed` (the sum of the components' current
  prices times their quantities, less `bundle_percent_off`, 0 to 90, half up to the minor unit, per market). A computed price is written by
  the database through `set_price()` (`commerce.refresh_bundle_prices()`) when the bundle's components or pricing change and when a
  component's price changes, so every path (the editor, imports, the AI manager, a price list's base) sees it as a plain price with its 30-day
  history. A market where a component has no price keeps the bundle's last price there; the editor says so.
- **Stock** is the lowest whole number of bundles the components' free stock allows (`floor(in_stock / quantity)`, components at their
  physical stock only: a bundle is never sold on backorder), worked out inside `variant_availability` so every reader gets it without a change;
  a bundle with an inactive, archived or sold-out component, or with fewer than two units, has none and cannot be bought.
- A bundle is a product of its own for search, listings, filters, feeds, the sitemap, reviews, recommendations, price lists, campaigns and
  codes (its line is an ordinary line, discountable like goods). It is not offered where only plain goods are: free gifts of campaigns, weekly
  boxes, draft orders, exchanges' replacements and order changes.

#### D.2 Selling it

- The cart treats a bundle as goods (`sellableQuantity()` caps at its derived stock). `placeOrder()` replaces a bundle line's want with its
  components' wants (quantity times the line's, policy `deny`), so `allocate()` holds component units as ordinary reservations, and writes the
  components on the order line (`commerce.order_line_components`: variant, SKU, title, quantity per bundle, position; frozen, never changed or
  deleted). `cartSummary()` and `placeOrder()` price the line as any goods line, so they agree with nothing new (a euro scenario holds it).
- `draw_order_stock()` draws a bundle line's components (its own variant is never drawn); a component bought on its own in the same order is
  one draw with it.
- `planRestock()` puts a bundle back as its components (the line's frozen components times the units going back), at the locations they
  were taken from, so a refund, a cancellation and a return need no change; the order page's restock maximum for a bundle line is what its
  components allow.
- An order holding a bundle line cannot be changed (`editBlock()`'s `bundle`): it is refunded or cancelled instead, in this wave.

#### D.3 Around the store (D2)

- The order page (staff and shopper), the packing slip and the pick list show a bundle's components under its line ("Includes 2 × …"); the
  pick list counts components, not bundles.
- The editor: the kind *Bundle*; a Components card (find a variant by title or SKU, quantity, order, remove), Price (*A price of its own* or
  *The components' prices less a percentage*, with the price it comes to per country) and the stock it comes to. The product page draws *What's
  inside* above the description, from the catalogue's cached read (components' titles, quantities and links to those offered).
- The AI manager reads a bundle's components through `get_product` and makes or changes one through its catalogue tools (`create_product`,
  `update_product` with `bundle`), gated as products are. A demo bundle is added to the template store (CLAUDE.md "Demo products").
- `bundle_components` are catalogue in `COPY_RULES` (copied by `clone_store()` and `duplicate_store()` where both variants are copied);
  `order_line_components` follow their order (`never` copied, as copied orders carry no stock); both `NOT_PERSONAL`.

#### D.4 Tests

- `src/db/commerce.test.ts`: the component rules, the computed price and its refresh, the derived stock, the draw and the frozen components.
- `checkout-kinds.int.test.ts`: a bundle from the cart to a paid order in euro (price, VAT, a campaign on it), its components held and drawn,
  a sold-out component refusing it, and a refund putting the components back.

#### D.5 As built: D1 (2026-10-26)

- Migrations `20261026102721_bundles` (`products.bundle_pricing`, `bundle_percent_off`, `bundle_components`, `order_line_components`) and
  `20261026102754_bundles_sql` (the rules, the derived stock in `variant_availability`, `refresh_bundle_prices()` and its triggers, the draw,
  and the patches of `clone_store()` and `duplicate_store()`).
- The rules are `commerce.bundle_problem()`, read at commit by `bundle_components_rules`, `products_bundle_rules` (a VAT category or kind
  that changes) and `variants_bundle_rules` (a component that stops being physical); `inventory_levels_not_bundle` refuses stock of a bundle's
  own and `order_line_components_frozen` any change of a sold bundle's components. A computed price is written at commit
  (`bundle_components_refresh`, `products_bundle_refresh`, `prices_bundle_refresh`), so a save that writes several components sets one price.
- `productInput.bundle` (`bundleInput`: pricing, percentage, components) and `bundleProblems()`; `saveProduct()` refuses a product that would
  become a bundle or stop being one, checks the components in words first (`componentProblems()`), writes them with
  `saveBundleComponents()`, writes no stock for a bundle and no typed price for a computed one. The editor offers the kind *A bundle* on a new
  product only and draws `BundleSection` in place of the variants (find by name or SKU, quantity, order, the stock and the price it comes to,
  `src/lib/bundles.ts` for the preview, held to the SQL by `bundles.test.ts`).
- The cart, `placeOrder()` and the order line: `bundle_components` rides on the checkout's rows (`bundleComponentsOf()`), its wants replace
  the bundle's, and `insertOrderLine()` writes them. Campaigns, codes, price lists (`LIST_PRICED`), the in-stock filter, wishlists'
  add-all and WordPress treat a bundle as goods. `planRestock()` expands a bundle (`expandBundleItems()`); the event keeps the components'
  parts marked with their bundle and the bundles in `restockedBundles`, which the bundle's line counts. `editBlock()`'s `bundle`.
- Held by `src/db/commerce.test.ts` (rules, stock, computed price, draw, frozen components) and the euro scenario in
  `checkout-kinds.int.test.ts` (price, stock, holds, draw, a refund putting the components back, the edit refused, a sold-out component).

#### D.6 As built: D2 (2026-10-26)

- Migration `20261026130020_bundles_relax`: a component's own change is no longer refused (D1 refused a component's VAT category or delivery
  that broke its bundle, which kept owners from changing a product because a bundle held it); `variant_availability` gives such a bundle no
  stock and checkout's rows ask its `can_buy`, so it cannot be bought until put right. `planRestock()` refuses a bundle line whose components
  were not kept rather than ever stocking the bundle's own variant; the AI manager's `set_stock` refuses a bundle's SKU in words; the control
  center's stock counts and the reorder suggestions leave bundles out, and reorder counts the units bundles took of each component.
- Migration `20261026125949_bundles_demo`: `commerce.add_demo_bundle()` (*Demo: Kaffepakke*, SKU `DEMO-VERDIPAKKE`, two white mugs and a tote at 10 % off them,
  `public/demo/bundle.svg`), called for production's template and by `supabase/seed.sql`; `clone_store()` copies it with its components.
- `OrderView` lines carry `components`; the admin order page and the shopper's order page say "Includes 2 × …" (`componentsText()`,
  `m.bundleIncludes`, nb, sv, da and en), the packing and parcel slips print it under the line (`includes`), and the pick list counts a
  bundle's components on the shelf and never the bundle (`PickInputLine.components`, by product and by order).
- The product page's description part draws *What's inside* (`m.bundleInside`) from `bundleItemsOf()`, read inside the catalogue's cached
  `getProduct()` (each component linked to its own page while that is offered). The admin's product list shows a bundle's derived stock.
- The AI manager's `get_product` names a bundle's components, pricing and the stock they allow; `create_product` and `update_product` take
  `bundle` (components by SKU, `componentsBySku()`, pricing and percentage) and save through `saveProduct()`, gated as products are.
- Bought bundles count as bought for recommendations (`purchasedProductIds()`). Held by `pick-list.test.ts` and the euro scenario
  (order view, slip, pick list, the page's items).

### Unit E (D323): quantity rules and price breaks

Detailed on 2026-10-26 from a read of the code, when its turn came. Built in three steps, each its own commit: E1 a variant's quantity
rules, E2 a product's price breaks, E3 a price list's rules and breaks.

**What the code does today.** A cart line holds 1 to `MAX_LINE_QUANTITY` (20) units, capped at the stock (`settleQuantity()` in
`src/lib/cart.ts`, `sellableQuantity()` and `changeLine()` in `src/server/cart.ts`); the product page and the phone's bar add one unit at a
time, and the cart's quantity field sets the line. A line's price is the market's, or the buyer's list price (`commerce.buyer_price()`, D321)
for goods, bundles and appointments bought once (`LIST_PRICED`), read in SQL by `getCart()` and `orderLineRows()`; the product page's buy
part reads `listPricesFor()`. A *tiered* campaign (D299 E3) gives a percentage by the basket's items, set on a campaign rather than a
product. The WordPress cart (D170) quotes a line at the market price, at most 20 units.

#### E.1 A variant's quantity rules (E1)

- A variant has `min_quantity` (default 1), `max_quantity` (none by default) and `quantity_step` (default 1), each 1 to 9,999
  (`MAX_ORDER_QUANTITY`); the minimum and the maximum are whole steps and the maximum is at least the minimum (checks on
  `product_variants`). They apply to goods and bundles; a variant of another kind keeps the plain rule (the editor shows no fields, the
  reader gives `PLAIN_RULE`).
- The rules are pure in `src/lib/quantity-rules.ts`: `quantityProblem(quantity, rule)` (`min`, `max`, `step`, or null), `lineMax(rule)`
  (the maximum, else twenty steps from the minimum: `min + 19 × step`, so the plain rule keeps 20, at most 9,999), `nextQuantity(current,
  asked, rule)` (adding to an empty line gives at least the minimum, rounded up to a step; adding to a line adds whole steps) and
  `fitQuantity(wanted, available, rule)` (the largest quantity the rule allows that the stock allows, none below the minimum). The shopper's
  words are `ruleWords()` from `m.quantityRule` (nb, sv, da and en by hand).
- The cart: Add (the product page, the phone's bar, *Your catalogue*) keeps sending what it sends; `changeLine()` makes it
  `nextQuantity()` and fits it to the stock, so *Add to cart* on a variant sold in sixes puts six in, then twelve. Setting a line's quantity
  to one the rule refuses is refused (`outcome: "quantity"`, the line unchanged); the quantity field carries `min`, `max` and `step`, so the
  browser says why before it is sent. A line whose rule changed after it was added shows status `quantity` with the rule's words and blocks
  checkout as an unavailable line does (`summary.blocked`). `available` and the field's maximum are `lineMax()` (or the stock, as before).
- Checkout: `placeOrder()` refuses a cart line whose quantity breaks its rule (`problem: "quantity"`, `m.problemQuantity`); a campaign's free
  product is not held to it. A line with a purchase option is held to the rule when bought; later changes to the subscription are not
  (they keep `MAX_LINE_QUANTITY`). Drafts (D173), order changes (D174) and exchanges (D239) are staff's and are not held to it.
- The product page says the rule under the variant's stock note (*Sold in sixes*, *At least 12*, *At most 48*), from the buy part read per
  request; a variant on backorder is capped at `lineMax()`.
- WordPress (D170): the quote gives each line its rule (`quantity_rule`) and counts the quantity fitted to it, with status `quantity` and
  the words when the asked quantity does not fit; the hand-over fits each line the same way (`fitQuantity(nextQuantity(0, asked))`); the
  plugin's stepper and quantity field follow `min`, `step` and `max`, and lines may hold up to 9,999 units. The zip is rebuilt.
- The editor: each shipped or downloaded variant of goods or a bundle has *How many at a time* (minimum, maximum, in steps of) beside its
  stock rules, with *Use for every variant*; `productInput` refuses what the database would (`quantityRuleProblems()`). The AI manager's
  `get_product` names a variant's rule and `create_product`/`update_product` take `min_quantity`, `max_quantity` and `quantity_step` per
  variant. `clone_store()` and `duplicate_store()` copy the columns. No new table.

#### E.2 A product's price breaks (E2)

- A **price break** (`commerce.price_breaks`: the product, a variant or every variant (`variant_id` null), `from_quantity` 2 to 9,999 and
  either a whole `percent` 1 to 99 off the market price or `amounts`, a unit price per market with VAT in the country's own currency, as
  `prices` keeps them) gives a lower unit price from that many units in one line. At most 10 per product (`price_breaks_max()`), one per
  variant (or every variant) and quantity.
- A line's price is worked out only by `commerce.line_price(store, customer, variant, market, market_amount, quantity)` (SQL, returning the
  price, the list that gives it and the break's quantity): the lowest of the market price, the product's breaks the quantity reaches (a
  fixed one only in a market it names) and the buyer's list offers (`buyer_price()`'s), so it is `buyer_price()` at one unit. `getCart()`
  and `orderLineRows()` read it under `LIST_PRICED` with the line's quantity instead of `buyer_price()`, so the cart and the order agree; the
  cart line carries `breakFrom` and says *Price for 10 or more* (`m.priceBreaks`).
- A break is the price at that quantity, **never shown as a reduction** (decision 3): no struck-through price, no 30-day reference, no
  "save" words. A line priced by a product's break is still the shop's price for everyone, so the group's percentage (D108), campaigns,
  codes and credits apply to it as to any line; a line a list prices takes none of the group's percentage, as in C1.
- The product page's buy part shows the chosen variant's breaks as a table (*Price by quantity*: *1 or more*, *10 or more*, … and the
  price each, drawn with `<Price>` and the store's VAT display) from `priceBreaksFor()`, which asks `line_price()` at each step for this
  buyer, so the table is what the cart charges; a step that is not lower than the one before is left out. Products with purchase options
  show none (breaks are for goods bought once). Cards, listings, feeds and structured data keep the price of one unit.
- The WordPress quote prices each line with `line_price()` (no buyer) at its fitted quantity, so its subtotal is the store's cart.
- The editor's *Price by quantity* card (goods and bundles): rows of a variant or every variant, from how many, and a percentage or a price
  per market, checked by `productInput` (`priceBreakProblems()`) and written in `saveProduct()`'s transaction. The AI manager's
  `get_product` names them. `COPY_RULES` `catalogue`: `clone_store()` and `duplicate_store()` copy them; not personal data.
- `checkout-kinds.int.test.ts` holds a euro scenario: a break by percentage and a fixed break, the cart, the summary and the order agree,
  the group's percentage on top of a break, and the table's prices are the cart's.

#### E.3 A price list's rules and breaks (E3)

- A price list may give its buyers breaks of their own for a variant (`price_list_breaks`: from how many, a percentage off the market price or a
  unit price per currency, as `price_list_prices`; at most 10 a variant in a list) and quantity rules of their own (`price_list_quantity_rules`:
  per variant, minimum, maximum and step, as E1's). By variant, as the list's fixed prices are, so the list's page keeps one shape.
- `line_price()` also takes the buyer's lists' breaks the quantity reaches; a buyer's rule for a variant is only
  `commerce.quantity_rule(store, customer, variant)`: a rule one of their lists gives (the one with the lowest minimum, then the highest
  maximum, then the smallest step), else the variant's. The cart, checkout, *Your catalogue* and the product page read the rule there.
- Admin: the list's page has *Price by quantity for these buyers* and *How many at a time for these buyers* for the variants found by the same
  search as fixed prices; words in the `customers` catalogue. Both tables are `never` in `COPY_RULES`, as the lists are.
- The parity row `catalogue.volume-pricing-and-quantity-rules` closes with E2 (a variant's breaks and rules, the cart and the order
  agreeing); E3 gives price lists theirs.

#### E.4 As built: E1 (2026-10-26)

- Migrations `20261026133526_quantity_rules` (`product_variants.min_quantity`, `max_quantity`, `quantity_step` with their checks) and
  `20261026133612_quantity_rules_copy` (`clone_store()` and `duplicate_store()` carry them). The rules are `src/lib/quantity-rules.ts`
  (`ruleOf()`, `ruleForKind()`, `lineMax()`, `quantityProblem()`, `nextQuantity()`, `fitQuantity()`, `ruleWords()`, `ruleProblem()`);
  `MAX_LINE_QUANTITY` lives there (re-exported by `src/lib/cart.ts`) beside `MAX_ORDER_QUANTITY`, and `settleQuantity()` takes the rule.
- `sellableQuantity()` returns the rule and caps `available` at `lineMax()`; `changeLine()` adds by `nextQuantity()`, refuses a set below the
  minimum or between steps (`outcome: "quantity"`, the line kept) and puts nothing in when the stock does not reach the minimum. `getCart()`'s
  lines carry `rule` and the status `quantity`, which blocks checkout; the cart page says the rule under the line (or *Change the quantity: …*)
  and the quantity field has the rule's `min`, `max` and `step`. A restored cart (the reminder's link) puts a line the rule no longer allows back
  at the nearest quantity it does. `placeOrder()` refuses with `quantity` (`m.problemQuantity`).
- The product page reads the rule from the cached `getProduct()` (`ProductVariant.rule`) and says it after the stock note; *Your catalogue*
  gives its quantity field the rule. The editor's *How many at a time* sits under each variant of goods or a bundle (the step moves the minimum
  and maximum to whole steps; *Use for every variant*), words in the `product` catalogue (en, nb). The AI manager's `get_product` names a rule
  that is not one at a time; `create_product` and `update_product` take `min_quantity`, `max_quantity` and `quantity_step` per variant.
- WordPress: the quote's `quantity_rule` and `fitted` (see `docs/wordpress-plugin.md`), the hand-over fitted the same way, lines up to 9,999;
  plugin 1.2.0. Held by `src/lib/quantity-rules.test.ts`, `src/db/commerce.test.ts` (the checks and the copy) and
  `src/server/quantity-rules.int.test.ts` (add, refuse, block, checkout, stock below the minimum, hand-over and quote).

#### E.5 As built: E2 (2026-10-26)

- Migrations `20261026152834_price_breaks` (`commerce.price_breaks`: product, variant or every variant, `from_quantity`, `percent` or
  `amounts`; one per variant and quantity, `NULLS NOT DISTINCT`) and `20261026152908_price_breaks_sql` (row security,
  `commerce.break_amounts_ok()` and the `price_breaks_amounts` check, `price_breaks_rules()` (a variant of the product, at most 10),
  `commerce.line_price()`, and `clone_store()`/`duplicate_store()` copying them). `line_price()` takes a list's offer only where it is lower than
  the shop's own price at that quantity, and is `buyer_price()` at one unit (a break starts at two).
- `getCart()` and `orderLineRows()` read `line_price()` under `LIST_PRICED` with the line's quantity (so a break never reaches a purchase option,
  a stay or a gift card); cart lines carry `breakFrom` and the cart says *Price for 10 or more* (`m.priceBreaks.applied`). A line priced by a
  break has no `priceListId`, so the group's percentage, campaigns, codes and credits work on it as on any line.
- The product page's buy part reads `priceBreaksFor()` (`src/server/price-breaks.ts`: `line_price()` at the variant's minimum and at each break,
  `breakSteps()` keeping only the falls) for products without purchase options and draws `PriceBreakTable` under the chosen variant's price,
  one table per distinct table (`OfferedVariant.breakIndex`, `breakTables`). Cards, listings, feeds and structured data keep the price of one unit.
- The editor's *Price by quantity* card (`price-breaks-section.tsx`, goods and bundles): every variant or one, from how many, a percentage or a
  price per market typed as market prices are (`keptAmount()`), checked by `priceBreakProblems()` and saved by `savePriceBreaks()` in
  `saveProduct()`'s transaction (a product of another kind keeps none). Imports and bulk edits keep them, as they save through the editor's
  own read. Words in the `product` catalogue (en, nb) and `m.priceBreaks` (nb, sv, da, en).
- The WordPress quote prices each line with `line_price()` at its fitted quantity (`quantityPrices()`, no buyer; no 30-day reference beside a
  break). The AI manager's `get_product` names the breaks; changing them is the editor's.
- Held by `src/lib/price-breaks.test.ts`, `src/db/commerce.test.ts` (`line_price()`, the rules, the copy), `src/server/price-breaks.int.test.ts`
  (the editor's save, the WordPress quote) and the euro scenario in `checkout-kinds.int.test.ts` (the cart, the summary and the order agree at
  each quantity, the table's prices are the cart's, the group's percentage comes off a break).

#### E.6 As built: E3 (2026-10-26)

- Migrations `20261026154238_price_list_quantities` (`price_list_breaks`, `price_list_quantity_rules`) and
  `20261026154336_price_list_quantities_sql` (row security, the amounts check keyed by currency, at most 10 breaks a variant in a list,
  `line_price()` with the buyer's lists' breaks, `commerce.quantity_rule()`). A list's break is a list offer: the lowest list offer wins where it is
  lower than the shop's own price at that quantity, so a line it prices takes no group percentage, and the cart says *Price for 10 or more*.
- `getCart()`, `sellableQuantity()`, `orderLineRows()` and `buyerCatalogue()` read the rule through `quantity_rule()` for the signed-in buyer
  (a guest and the WordPress cart get the variant's own); the product page's buy part reads `buyerRulesFor()` for the rule's words and
  `priceBreaksFor()` starts the table at the buyer's minimum and adds the buyer's lists' breaks.
- The list's page (`[listId]/page.tsx`) has the two cards, saved by `saveBreaksAction()`/`setListBreaks()` (the rows replace the list's breaks,
  every row checked first) and `saveRulesAction()`/`setListRules()` (three empty fields take the list's rule away); audited as
  `price_list.breaks_saved` and `price_list.rules_saved`. Both tables are `never` in `COPY_RULES` and not personal data.
- Held by `src/db/commerce.test.ts` (the SQL), `price-lists.int.test.ts` (the writers) and the euro scenario in `checkout-kinds.int.test.ts` (a
  group member's Add to cart puts in the list's minimum at the list's break price; the cart, the summary and the order agree).

### Unit F (D324): search merchandising

Built on 2026-10-26 in three steps (F1, F2, F3), each as specified below; D324 in `docs/decisions.md` records what was built and the migrations.

Detailed on 2026-10-26 from a read of the code, when its turn came. Built in three steps, each its own commit: F1 synonyms, F2 pins, boosts,
buries and search redirects, F3 the AI manager's tools and the tracker.

**What the code does today.** The store's search (D72 to D75) is `searchProducts()` in `src/server/search.ts`: keyword matches
(`matchingIds()`: a `websearch_to_tsquery` over `product_translations.search` in the market's language, trigram closeness to titles, SKUs,
category and tag names, public custom fields) and, with the store's AI, matches by meaning (`meaningMatches()`), merged by reciprocal rank
fusion in `rankedSearch()`, then drawn by `listGridProducts()` in that order (`sort: "given"`) unless the search asked for a price or newest
order. Query understanding (`understandQuery()`) turns a search into filters, kept only through `cleanFilters()`: a category or tag only when
the typed words name it (`namesTerm()`). Its answer and the query's vector are kept in `commerce.search_cache` under a key of everything they
depend on; the results themselves are worked out per search and never cached. The type-ahead is `suggestProducts()` (prefix keyword search
only). The chat agent searches through `searchProducts()`; recommendations through `rankedSearch()`. `/admin/{store}/search` (Settings,
Tools; `settings:read`) shows the last 30 days' searches, the share that found nothing and the zero-result searches. Manual redirects (D168)
send an address to a page; nothing sends a search there.

#### F.1 Synonyms (F1)

- `commerce.search_synonyms`: a store's groups per language (`locale`, one of the store's kept languages): `kind` `both` (every word in
  `words` means the others, 2 to 20) or `one_way` (each of `words`, 1 to 20, also finds `means`, 1 to 20; a search for a word of `means` does
  not find `words`). A word is a word or a short phrase, kept as `normalizeQuery()` leaves it (lower case, single spaces), 1 to 60
  characters, letters, digits, spaces, hyphens and apostrophes only; a group repeats no word; at most 500 groups a store. Written only by
  `src/server/search-synonyms.ts` (`saveSynonym()`, `deleteSynonym()`), checked by `synonymInput` (`src/lib/search-synonyms.ts`, shared
  with the browser), audited `search.synonym_saved`/`search.synonym_deleted` (area `settings`).
- The expansion is pure: `expandQuery(text, groups)` (`src/lib/search-synonyms.ts`) gives the query's alternatives: for each group with a
  word the query holds as whole words, the query with that word put in place of each word it means (both ways for `both`, from `words` to
  `means` for `one_way`), longest word first, at most `MAX_ALTERNATIVES` (8), never the query itself. A unit test holds it (phrases, word
  boundaries, one way only, the cap, accents).
- Keyword search uses them: `matchingIds()` reads the market language's groups (`synonymsFor()`, one small read per search, store-scoped)
  and ORs each alternative's `websearch_to_tsquery` (or, while typing, its prefix query) into the query's; title closeness and SKUs stay on
  what was typed. Search by meaning is unchanged (the vector is the query's).
- Query understanding uses them: `cleanFilters()` counts the alternatives' words as typed when it asks whether a search names a category or
  tag (`UnderstandingContext.aliases`), so "couch" can keep the category Sofas when the store says they are the same; the aliases are part of
  the understanding's cache key, so a changed group asks again and no stale answer is served. The prompt itself is unchanged.
- The admin: a *Synonyms* card on `/admin/{store}/search` (writes need `settings:write`): the groups of the chosen language as lines
  ("sofa = couch = settee", "jumper → sweater"), *Add a synonym* with two fields (the words, and for one way what they mean), delete.
- Copied with the store (`COPY_RULES` `catalogue`; `clone_store()` and `duplicate_store()` copy the groups), not personal data.

#### F.2 Pins, boosts, buries and search redirects (F2)

- `commerce.search_rules`: a store's rules, each an `action`: `pin` (a product put first, in the rules' `position` order), `boost` (a product
  or a category or tag moved up), `bury` (moved down) or `redirect` (the search goes to a page of the store, `target`, a path in
  `normaliseTarget()`'s normal form, D168). A rule is for every search (`queries` empty; boosts and buries only) or for searches that hold
  one of its `queries` (`match` `contains`: the phrase's words in order, whole words) or are one of them (`exact`). A pin and a redirect name
  at least one query. At most 200 rules a store. Written only by `src/server/search-rules.ts` (`saveRule()`, `deleteRule()`), checked by
  `searchRuleInput`; the product and the term must be the store's own (a term of kind `product`); audited `search.rule_saved`/`deleted`.
- The order is pure: `merchandise(ids, rules, facts)` (`src/lib/search-rules.ts`): the rules that apply to the query (`rulesFor()`), then the
  pinned products first in their order (a pinned product the search did not find is added only when the search has no filters, and only if
  it is offered in the market: read through `listGridProducts()`, which leaves out what is not), then the boosted, then the rest, then the
  buried, each group keeping the search's own order; a product both boosted and buried stays where it was. Applied in `searchProducts()`
  after the fusion and before paging, only to the search's own order (a search asking for a price or newest order keeps that order); the
  chat agent's search follows it. Type-ahead and recommendations do not (keyword only, and candidates).
- A search redirect: the search section asks `searchRedirect()` before searching, and a query that a `redirect` rule matches goes to
  `marketPath()` + its target (308-free: a `redirect()` from the streamed section), logged as a search with no results counted
  (`redirected` true on `search_queries`), so the report says it was sent on.
- The zero-result report offers, per search, *Add a synonym* (the search's words, prefilled) and *Send to a page* (a redirect rule for the
  search, the target chosen from the store's published pages, categories and tags, or typed). A *Rules* card lists pins, boosts, buries and
  redirects by the search they are for, with delete.
- No cache serves a stale merchandised result: the results are worked out per search, and the one cached answer that depends on
  merchandising, query understanding, has the synonyms in its key (F.1).
- Copied with the store (`catalogue`; products and terms mapped to the copy's), not personal data.

#### F.3 The AI manager and the tracker (F3)

- Owner tools (`settings` area): `search_merchandising` (read: the groups and rules, the zero-result searches of 30 days),
  `save_search_synonym`, `save_search_rule` and `delete_search_merchandising` (gate `public`: they change what shoppers find), through the
  same writers; in `TOOL_AREAS` as `website`.
- The row `catalogue.search-merchandising-synonyms-boosts-pins` is rated on the criteria above with the integration tests named there.

### Unit G (D325): videos and 3D in the gallery

Built on 2026-10-26 in three steps (G1, G2, G3), each as specified below; D325 in `docs/decisions.md` records what was built and the migrations.

Detailed on 2026-10-26 from a read of the code, when its turn came. Built in three steps, each its own commit: G1 the model and the server,
G2 the editor and the product page, G3 the languages, the AI manager, copies and the tracker.

**What the code does today.** A product's gallery is `commerce.product_media` (a picture's `url`, its `thumbnail_url`, a `position`, `alt`
keyed by language), at most 12 (`MAX_MEDIA`), written only by `saveProduct()` (it deletes and rewrites the rows in the editor's order) from
`productInput.media` (`{ url, thumbnailUrl, alt }`, the alt in the main language only: every other language is stored as the product's
title, so the media library's translated alt texts, D89, never reach it). The product page draws them with `ProductGallery` (pictures that
swipe, thumbnails beneath, a variant's picture taking the first place, D84). Every other reader takes the first row's `url` or
`thumbnail_url` as the product's picture: cards and listings (`catalog.ts`), the cart, orders, the admin's list, the feeds, structured
data, WordPress, wishlists, campaigns, cart reminders, standing orders, exports. Uploaded videos already exist for page rows (D86:
`VideoUploadButton`, `startVideoUploadAction`, the public `page-videos` bucket, 50 MB, MP4 or WebM, compressed in the browser by D213,
`registerVideo()` keeping them in the media library) and YouTube and Vimeo play only on a press (`embedUrl()`, `EmbeddedVideo`, D91, D209).
There is no 3D anywhere.

#### G.1 The model (G1)

- **One picture per item, always.** `product_media` gains `kind` (`image`, `video`, `model`; default `image`), `source` (for a video:
  `upload`, `youtube`, `vimeo`; else null) and `media_url` (the video file, the YouTube or Vimeo address, or the model file; null for a
  picture). `url` and `thumbnail_url` stay the item's **picture**: a picture's own, a video's or a model's poster. So every reader of the
  product's picture is right unchanged (a video first in the gallery gives the card its poster), and only the gallery and the editor read
  `kind`. Checks: an `image` has no `source` or `media_url`; a `video` has both, `source` one of the three; a `model` has a `media_url` and
  no `source`.
- **Limits** (`src/lib/product-media.ts`, shared with the browser, stated in the editor): at most `MAX_MEDIA` 20 items (was 12), of which at
  most 5 videos and 3 models; a video file MP4 or WebM up to 50 MB (D86's bucket), a model a GLB file up to 20 MB in a new public bucket
  `product-models` (`model/gltf-binary` only; a glTF is a set of files and is refused: the editor says to export a GLB). `productInput`
  checks the counts and the shapes (`mediaProblems()`, unit-tested); `saveProduct()` checks that an uploaded video's or model's address is a
  file in the store's own folder of its bucket (`ownMediaFile()`), so a product never plays another store's or another site's file, and a
  YouTube or Vimeo address through `embedUrl()`. The buckets refuse other types and larger files themselves.
- **Uploads.** A model is started by `startModelUploadAction()` (`products:write`, `storageRefusal()` first, a signed upload for one new path
  in `{store}/`) and kept in the media library as kind `model` (`registerModel()`, the `media_kind` check widened), drawn there as a tile
  saying *3D model*; videos keep D86's path. `mediaUses()` and `rewriteAddresses()` read `media_url` too, so the library says where a video
  or model is used and Compress moves it.
- **Alt text per language** (decision 5's words, G3): `productInput.media[].alt` stays the main language's, and `alts` (by language) holds
  the others the owner typed. `saveProduct()` stores what was typed in each language and, where nothing was, the product's title in that
  language, as it did for pictures (so every reader keeps its words; `getProductForEdit()` shows a stored title as empty). A video's alt is
  its title for screen readers; a model's describes what it shows.
- **Copies.** `clone_store()` and `duplicate_store()` copy the new columns (and `clone_store()` the thumbnail it left out); the store-copy
  job copies files in `product-models` as it does `page-videos` (`COPYABLE_BUCKETS`).

#### G.2 The editor and the product page (G2)

- **Editor (Homer).** The *Pictures* card becomes *Pictures and videos*: *Add pictures* as today, and beside it *Add a video* (upload, or
  paste a YouTube or Vimeo address) and *Add a 3D model* (Lisa's step, under *More*). An uploaded video's poster is the still D86 takes; a
  YouTube or Vimeo video needs a picture chosen or uploaded (the editor asks for it, and nothing is fetched from YouTube or Vimeo); a model
  needs one too. Each item shows its kind, its picture, its words (with *In other languages* one step away) and Earlier, Later, Remove; the
  limits are said under the buttons.
- **Product page.** `ProductGallery` draws each item in the owner's order: a picture as today; an uploaded video as a `<video controls
  preload="none" playsinline>` with its poster (no autoplay, sound only when the shopper plays it); a YouTube or Vimeo video as
  `EmbeddedVideo` (nothing loaded before the press); a model as its poster with *View in 3D*, which loads `<model-viewer>`
  (`@google/model-viewer` 4.3.1 with its `three` peer, imported only on that press, never in a page's first scripts, D211) and shows the model with camera controls;
  a browser that cannot run it keeps the poster. Thumbnails mark videos and models with an icon and their words. Swiping away from a
  playing video pauses it. A variant's picture still takes the first place (D84).
- **Words.** Shopper words (`m.gallery.*`: play, *View in 3D*, *3D model*, *Video*) in nb, sv, da and en by hand; owner words in the
  `product` catalogues (en, nb).

#### G.3 Languages, the AI manager, copies and the tracker (G3)

- The items' words in the store's other languages are in the store translation worklist (scope `products`, one item per gallery item), as
  every translatable text is (rule 5).
- The AI manager's product tools read and keep the gallery as it is: `get_product` lists each item's kind and words; a tool that sets the
  pictures replaces the pictures only and keeps the videos and models in their places (`product-tools.ts`). Feeds and structured data keep
  the pictures (a video's or model's poster is a picture); no feed attribute for video is sent.
- The row `catalogue.product-media-video-and-3d` is rated on the criteria above with: `product-media.test.ts` (limits, shapes, own files),
  `product-media.int.test.ts` (save, order, a foreign file refused, the card's picture, copies, `mediaUses()`), and an e2e that adds a video
  and a model in the editor and sees them, in order, on the product page.
- Not in this unit: AR (Apple's Quick Look needs a USDZ file), video in feeds, video structured data (`VideoObject` needs an upload date
  and a description the item does not keep).

### Unit H (D326): content types

Detailed on 2026-10-27 from a read of the code, when its turn came. Built in four steps, each its own commit: H1 the model and the admin,
H2 entries on the site (references, grids, pages), H3 languages, the AI manager and the tracker, H4 Kaizena Flow's own site.

**What the code does today.** Custom fields (D118 to D120) are groups of field definitions (`commerce.field_groups.fields`, `FieldDef[]`
from `FIELD_TYPES`) on things the store already has (`FIELD_ENTITIES`: products, variants, pages, articles, terms, the store, customers,
orders), with what was entered kept in `commerce.field_values` (a row per thing and language) and handled in memory as `FieldData` (the
values the same in every language, and each language's own words). Everything around a value works on that shape and the definitions:
`parseFieldChanges()` checks an editor's change, `applyChanges()` lays it over what is kept, `requiredProblems()` asks for required fields,
`shownGroup()` turns it into what a shopper sees, `keepOwnRelations()` drops what points outside the store and `resolveRelations()` draws a
relation as a link, leaving out what is gone. The admin edits a group in `FieldGroupEditor` (fields card, `FieldTypePicker`,
`FieldEditorDialog`, a live `FieldsForm` preview) and values in `FieldsForm`. A content grid lists pages, articles, products or its own
items (`GridSource`, every reader through `sourceTraits()`); the field loop draws a repeater's rows. Blocks bind to a thing's public fields
(`bindPage()`). Pages nested under a parent are served by `[slug]/[...sub]`. Field groups are store-only (`store_id` not null), and
`clone_store()` copies field values as they are, ids inside them included (so a copy's relations still name the template's things, which
the readers then leave out). There are no standalone entries of an owner's own type.

#### H.1 The model (H1)

- **A type** is `commerce.content_types`: `store_id` (null for Kaizena Flow's own site, H4), `key` (`t_` and 12 hex, made once and never
  changed: what fields and grids name a type by, so a copy needs no remapping), `name` (1 to 80), `slug` (its web name, the address part of
  its pages, `^[a-z0-9]+(-[a-z0-9]+)*$`, 1 to 60, unique per owner, never one of `RESERVED_STORE_PAGE_SLUGS`, and fixed once an entry of it
  has been published), `fields` (`FieldDef[]`, checked by the same definition schema and limits as a group's, `MAX_GROUP_FIELDS`), which
  field is its `title_field` (a text field; required), its `summary_field` (text, text area or rich text) and `picture_field` (a picture),
  `has_pages` and `layout_id` (H2), `position`. At most 50 types an owner. A type's field may be of any type a product's may (D118 to
  D120) and the new `entry` type (H2); `staffGroupProblem()`'s rules do not apply (entries are never a person's).
- **An entry** is `commerce.content_entries`: `store_id`, `type_id`, `slug` (1 to 120, the slug shape, unique in its type, never `ab`),
  `draft` and `published` (`EntryContent`: the `FieldData` of its values and its search texts, `seo: { title, description }` per language
  as page texts are, D55), `published_at`, `first_published_at`, `position` (the owner's order), and who and when. At most 10,000 entries
  an owner. The site reads `published` only; *Publish* copies the draft over it, *Unpublish* clears it, and an entry whose draft differs
  says *Changes not published*.
- **One way to write** (rule 1): types only through `src/server/content-types.ts` (`saveContentType()`, `deleteContentType()`,
  `orderContentTypes()`), entries only through `src/server/content-entries.ts` (`saveEntry()` for the draft, `publishEntry()`,
  `unpublishEntry()`, `deleteEntry()`, `moveEntry()`), checked by `contentTypeInput` and `entryInput` (`src/lib/content-types.ts`, shared
  with the browser). An entry's values go through `parseFieldChanges()` against its type's fields, money through `moneyProblems()`, files
  through `isOwnFieldFile()` and relations through `keepOwnRelations()`; publishing asks `requiredProblems()` and a title. A type that
  loses a field loses that field's values in every entry, draft and published, in the same transaction; a field's type never changes once
  saved (as a group's). Deleting a type deletes its entries (asked once, with their number), each as `deleteEntry()` does.
- **Deleting an entry clears the references** (the row's criterion): in the delete's transaction every `entry` value that names it, in
  field values and in other entries' drafts and published content, loses it (`withoutEntry()`, pure over the definitions and the data;
  the rows are found by the id in their text), so no stored value points at an entry that is gone.
- **Store-scoped** (rule 3): every query takes the owner (`store_id is not distinct from`); `content-types.int.test.ts` shows one store
  cannot read, write, reference, list or show another's types or entries. Audited `content.type_saved`, `content.type_deleted`,
  `content.entry_saved`, `content.entry_published`, `content.entry_unpublished`, `content.entry_deleted` (area `website`); the screens and
  actions ask `website:read`/`website:write`.
- **Copies and personal data** (rule 4): both tables are `settings` in `COPY_RULES` (always copied with the store, as headers and footers are); `clone_store()` and `duplicate_store()`
  copy them with `clone_id()` ids, and `commerce.clone_entry_refs()` makes every copied entry id inside the copy's entries and field values
  the copy's (a uuid is unique, so replacing its text cannot touch anything else). In `NOT_PERSONAL`: the owner's own content; a type is
  never on customers or orders.

#### H.2 The admin (H1)

- **Website → Content** (`/admin/{store}/content`, a new item in the Website section and `ADMIN_PAGES`). Homer: the store's types as
  cards (name, how many entries, *Add an entry*); with none, *Create a content type* and four starting points to begin from
  (`CONTENT_TYPE_PRESETS`: *Team members*, *Questions and answers*, *Locations*, *Events*), each a type with its fields made, which the
  owner can change before saving.
- **A type's entries** (`/admin/{store}/content/{type}`): a `List` of its entries (title, *Draft*, *Published* or *Changes not published*,
  last changed), a search by title, *New entry*, and Earlier and Later for the owner's order. *Edit the type* is one step away.
- **An entry** (`/admin/{store}/content/{type}/{entry}`): the type's fields as one `FieldsForm`, the language being written chosen as in
  the product editor (only where the store has more than one), its address (following the title until changed) and search texts when the
  type has pages, and *Save draft*, *Publish*, *Unpublish*, *Delete*. Leaving with unsaved changes asks.
- **A type** (`…/{type}/settings`, Lisa's step): its name, web name, fields (the field group editor's fields card, picker, field dialog and
  preview, shared as `FieldsSection`), which fields are its title, summary and picture, and (H2) whether entries have pages and their
  layout.
- Owner words in a new `content` admin catalogue (en and nb, D312); `CONTENT_TYPE_PRESETS`' names and fields in both.

#### H.3 Entries on the site (H2)

- **References.** A new field type `entry` (Relational: *Entries of a content type*), with `contentType` (the type's key) and `multiple`,
  on any thing that has fields and in any type: `parseValue()` keeps entry ids, `keepOwnRelations()` keeps only the owner's own entries of
  that type, the editor's lookups list the type's entries by title, and `resolveRelations()` draws one as its title, linked to its page
  when its type has pages, and only while it is published.
- **Grids.** A content grid's source `{ type: "entries", contentType }` (a type's key): its published entries, sorted newest, oldest, by
  title or in the owner's order (`manual`), at most the grid's limit; a tile's heading is the title field, its excerpt the summary field,
  its picture the picture field, its link the entry's page when its type has pages, and up to three of the type's plain fields as tile
  lines (`tileFields`). `SOURCE_TRAITS` gains `entries` (looked up; no products, terms or field entity), cached under `contentTag(owner)`,
  which every writer refreshes. The field loop stays a repeater's: a type's entries are listed by the grid, which draws the same slots.
- **Pages.** A type with `has_pages` serves `/{type}/{entry}` through the nested-page route (`[slug]/[...sub]`): a page at that address
  wins; else a published entry of a type with pages is drawn by its type's layout, else the standard entry view (its picture, title and
  every public field through `CustomFieldsView`). A layout is a page of the new type `entry_layout` (the `pages_type` check widened),
  designed in the page builder from *Design the entry page* on the type, its heading, rich text, image and button blocks bound to the
  type's public fields (`bindPage()` with the entry's fields as one group, D119), made from a starting layout. The page's title is its
  search title, else its title field's; its description the search description, else the summary; `hreflang` per language as a page's; it
  is in the store's sitemap while published (`listIndexedEntries()`), and an unpublished or deleted one answers through
  `missOrRedirect()`. A published entry whose address changes leaves a permanent redirect (`commerce.redirects` kind `entry`, written by a
  trigger as a product's, resolved to its current address).

#### H.4 Languages, the AI manager and the tracker (H3)

- **Translation worklist** (rule 5): a scope `content`, one unit per entry, its translatable fields' words and its search texts, written
  into the entry's draft (an entry, like a page, is published by a person).
- **AI manager** (rule 7, area `website`): `list_content_types`, `list_entries` and `get_entry` read; `save_entry` writes a draft (seen by
  no shopper, so ungated) through `saveEntry()`; `publish_entry`, `unpublish_entry` and `save_content_type` are gated `public`, checked
  first (`preflightContentTool()`), described in words made from the entry or type.
- The row `catalogue.metaobjects` is rated on its criteria with `content-types.test.ts`, `content-types.int.test.ts`,
  `content-entries.int.test.ts` and an e2e that defines a type, publishes an entry, lists it in a grid and opens its page.

#### H.5 Kaizena Flow's own site (H4)

- Platform admins have the same screens at `/admin/platform/content`; Kaizena Flow's entries are served at `/{type}/{entry}` (and
  `/no/{type}/{entry}` with the Norwegian texts, D312) and listed by grids on its own pages, and are in its sitemap. A type of Kaizena
  Flow's holds no money or file field (it has no currencies and no field files' folder).
- Not in this unit: entries in site search and the chat agent's knowledge, entry versions (D305), and entries as an A/B test's target.

### Unit I (D327): a standard product taxonomy

A product may be given a category from a standard taxonomy (decision 1) kept apart from the store's own categories and the tax code
(`products.standard_category`, a stable id). A searchable picker in the product editor; the category's attributes (colour, size, material,
…) are offered as a field group and as listing filters, values checked against the category; the feeds (D302) send the category (and
Google's id where the taxonomy maps to it). A model may suggest a category from the product's own words, which staff accept (feature
`product_taxonomy`, through the D76 writer's rules).

## 5. Decisions (taken by the owner on 2026-10-25: all as recommended)

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
