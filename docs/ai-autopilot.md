# The AI manager's autopilot (decisions D308 to D311)

The contract for turning the AI manager (D94, D103 to D106) from an assistant that answers into a manager that works. Written on 2026-10-22
from the owner's goal, a read of the manager's code at commit `144ce5c` and the parity rows of the AI domain. Code, tests and texts follow
this file; a unit that must change course says so here first.

**The goal (the owner's words).** An AI manager that listens to a store owner's goals and vision, crafts a plan to bring it about, plans and
builds the store, works on the owner's behalf on its own, loops the owner in only for critical decisions, and reports progress, concerns and
challenges from time to time. The same for Kaizena Flow's own site, with the platform admin as the owner.

**What exists (read in the code).**

- The turn loop: `runTurn()` (`src/server/owner-assistant.ts`) streams from the store's AI connection with tools, up to ten rounds a
  turn, 300 turns a store a day; it already runs headless for Kaizen Life (`src/server/store-mcp.ts`), so a turn needs no browser.
- 103 store tools (`OWNER_TOOLS`), 17 platform tools, 9 manager tools, 41 playbooks (`ASSISTANT_SKILLS`) and memory per account (D103).
  The tools read, analyse and run operations; **none builds**: no tool creates or edits a product, saves or publishes a page, edits a
  menu, sets up shipping or applies a theme. The only page and product writes are `archive_product` and `unpublish_page`.
- Approvals: a tool with a gate (`send`, `public`, `spend`) is only kept (`assistant_approvals`) and runs on the person's yes
  (`decideApproval()`, `decide_approval` with `saysYes()` on the person's own message).
- Builders that run without a browser: `saveProduct()` (with `writeProduct()` in the content packs as the template), `savePage()`, the page
  studio's `planPage()`/`buildDraft()`/`fillPicture()`, `applyDesignPreset()`/`installDesignPreset()`, `saveStoreMenu()`,
  `saveNavigation()`, `saveShippingMethod()`, `saveShippingSettings()`, `saveStoreDetails()`, `setMarkets()`, `saveLanguages()`,
  `createLegalStarter()`, `setPageRole()`, `getSetupProgress()`.
- Jobs: the five-minute dispatcher, the every-minute marketing route and the pack-pictures route (300 s, work in `after()`, in the
  asker's name), scheduled by `pg_cron`; claims with an expiry as the data jobs do (`claimJob()`).
- Cost: every call metered (`metered()`, `ai_usage`, by feature); only recommendations have a monthly cap.
- Seeing: `seeing(connection)` gives a model that sees pictures; Chromium screenshots through `looking()` (one browser per look). Store page
  previews need a signed-in session; only the replicator's frame opens with a token.

**What is missing.** Hands (building tools), a will of its own (goals, a plan and a loop that runs without a person in the chat), a sense of
proportion (autonomy levels and budgets the owner sets), a voice (a decisions page and reports) and eyes (looking at what it built).

## 1. The units, in the order they are built

| Unit | Decision | What | Rows it moves |
|---|---|---|---|
| A1 | D308 | Catalogue tools: create and edit products (texts, variants, prices, pictures, categories and tags), as drafts or live | `ai.admin-ai-assistant-that-performs-tasks` |
| A2 | D308 | Website tools: build a page from a brief (the page studio, headless), change a page's words and rows, publish, choose a page's place, menus and the header and footer; on stores and on Kaizena Flow's own site | `ai.ai-page-and-theme-generation`, `ai.admin-ai-assistant-that-performs-tasks` |
| A3 | D308 | Setup tools: the store's details, countries, languages and currencies, flat rate and shipping methods, opening the store; the setup wizard's steps as tools | `ai.admin-ai-assistant-that-performs-tasks` |
| A4 | D308 | Design tools: list themes and presets, add one to the store's library, try it, make it live (a premium theme is a `spend`) | `ai.ai-page-and-theme-generation` |
| H | D302 | Product feeds (wave 5 unit H, outlined in `docs/wave-5-marketing.md` 10), woven in here: the agent uses them too | wave 5's rows |
| B1 | D309 | Goals and plans as data; the audit log says when the AI acted | `ai.assistant-memory-and-saved-skills` |
| B2 | D309 | The work loop: steps run in the background, checked in code, within the owner's autonomy levels and budgets | `ai.workflow-builder-with-ai-generation`, `ai.admin-ai-assistant-that-performs-tasks` |
| B3 | D309 | Decisions and reports: one page of what waits on the owner, a digest by email, a weekly report | `ai.proactive-insights` |
| L | D311 | Legal pages by AI: researched from fetched sources, checked in code, kept current | `international.legal-page-templates-and-policy-generator` |
| C | D310 | Eyes: the agent photographs its drafts and judges them with the model that sees pictures | `ai.ai-page-and-theme-generation` |

Each unit is its own commit (or a few), with its own tests, decision row and parity moves, shipped before the next starts. Each unit's
section below is written in full before it is built; B2 onwards are outlined and get their detail when their turn comes.

## 2. Rules for every unit

1. **One way to write.** A tool calls the same function a screen calls, with the same validation (`productInput`, `pageInput`,
   `menuInput`, `methodInput`, …). No tool writes SQL of its own and no new writer of a table appears for the AI.
2. **Drafts are free, the public is gated.** Anything only staff see (a draft product, a draft page, a theme added but not live) is
   ungated. Anything shoppers or customers see or receive (publishing, making a product active, changing a live menu, prices on live
   products, emails, a theme going live) carries a gate (`public` or `send`), and anything that costs money a `spend`. Until B2 a gated call
   waits for the person's yes as today; from B2 the owner's autonomy level decides.
3. **Facts from tools, figures from code, words through the filters.** The model never states a price, a stock level or a figure it was not
   given; amounts are written by `formatMoney()`; public words pass `findClaims()`; legal words pass unit L's checks.
4. **Store-scoped and permitted.** Every tool takes the store from the principal, has a `TOOL_PERMISSIONS` entry (`products:write`,
   `website:write`, `settings:write`, …), a `TOOL_FEATURES` entry where a feature stands behind it, and works only on an open store.
   Kaizena Flow's own site uses the same tools with the platform principal (`store: null`), where a tool makes sense there.
5. **Refreshed and audited.** A tool refreshes the tags the screen refreshes (`catalogTag`, `pagesTag`, `designTags`, …) and is audited
   as the screen's action is; from B1 the entry also says the AI did it.
6. **Metered.** Every model call names its feature in `AI_FEATURES` (`ai_builder`, `autopilot`, `ai_eyes`, `legal_writer`).
7. **Homer and Lisa.** The owner talks to the manager; the screens stay the place to see and change everything it did.

## 3. Unit A1 (D308): catalogue tools

| Tool | What | Gate |
|---|---|---|
| `create_product` | A new product from the model's arguments: kind (goods only in A1), titles and descriptions per language, options and variants (SKU, price per market as text in the market's currency, stock, weight, delivery), categories and tags by slug (new ones made), pictures by URL from the media library or made by the picture model (D283's `makeSitePicture()`), status `draft` | none |
| `update_product` | A change to an existing product, given as the fields to change; read with `getProductForEdit()`, merged, saved whole | none while draft; `public` when the product is active and the change touches what shoppers see |
| `set_product_status` | Draft to active (checked by `productProblems()`: a price, a manufacturer, an EU responsible person) or back | `public` |
| `set_prices` | Prices of variants per market, through `saveProduct()` (so `commerce.set_price` and its history) | `public` on an active product |
| `write_product_texts` | Descriptions, SEO title and description and excerpt for products, from the product's own facts (D76's writer, now as a tool) | as `update_product` |

The tool input is a zod schema of its own (shorter than `productInput`, with defaults the screen would choose: the store's main market and
language, the standard VAT category, `txcd_99999999`), turned into a `ProductInput` by a pure `toProductInput()` (unit-tested) and saved by
`saveProduct()` with the owner's `actor`. A price is text in the market's currency read by the screen's own parser. The answer names the
admin page of the product. Tests: integration tests make, change, activate and price a product through the tools and read it back through
the product screen's reader; a product with problems is refused with the screen's words; another store's product is never found.

## 4. Unit A2 (D308): website tools

| Tool | What | Gate |
|---|---|---|
| `build_page` | A page from a brief (title, purpose, audience, key points, facts, sections, call to action, tone, pictures yes or no): the page studio's `planPage()` then `buildDraft()` headless, pictures made one at a time after (`fillPicture()`); saved as a draft | none |
| `edit_page` | A change to a page's words or rows: replace a text (by `mapTexts()`'s keys, as find and replace does), add a row from the page studio's patterns, remove a row, move a row; checked by `pageInput`, saved as a draft (a page version is kept, D305) | none |
| `publish_page` | Publishes a draft (the accessibility checker's blocking issues refuse it unless the owner's level allows acknowledging them) | `public` |
| `set_page_place` | Front page, All products page, or a role (blog, search, 404, a working page, a legal role) | `public` |
| `save_menu` | A menu's items (pages, products, categories, tags, the site's links, an address) by `saveStoreMenu()` | `public` when the menu is in use |
| `set_header_footer` | Which menus the standard header and footer show, the logo from the media library (`saveNavigation()`) | `public` |

On Kaizena Flow's own site the same tools work with the platform principal (Kaizen's pages, `PageOwner` null), so the platform admin can say
"build a landing page for photographers" in the platform's manager. Tests: a page built from a brief is a valid draft with the brief's facts and
no claims; an edit keeps the rest of the page; publishing with a blocking issue is refused; a menu link to another store is refused.

## 5. Unit A3 (D308): setup tools

`set_store_details` (`saveStoreDetails()`), `set_countries` (`setMarkets()`), `set_languages` and `set_currencies` (D109's savers),
`set_flat_shipping` (`saveShippingSettings()`), `save_shipping_method` (`saveShippingMethod()`), `setup_status` (`getSetupProgress()` and
`setupStepsFor()` in words: what is done, what is next, what only the owner can do) and `open_store` (`completeSetup()`, gated `public`).
What only a person can do is said, never attempted: Stripe's or Mollie's onboarding (identity and bank, the owner's own), a carrier's
agreement, a domain's DNS records; the tool answers with the page and the one thing to do there. Tests: a store set up by the tools reaches
`readyToOpen` as the wizard's does.

## 6. Unit A4 (D308): design tools

`list_themes` (published themes and presets, with prices, `listOfferedDesigns()` and `themeCharge()`), `add_theme` (`installDesignPreset()`,
not live, ungated), `try_theme` (the install's preview address for the person) and `make_theme_live` (`applyDesignPreset()`: `public`, and
`spend` when the theme costs money and the store does not own it, with the charge the owner was shown). Tests: adding never changes the
live look; going live through the tool equals going live from Design settings; a premium theme is never made live without its charge.

## 7. Unit B (D309): goals, plans and the work loop (outline)

- **Goals** (`assistant_goals`, per store or the platform): the owner's vision in their words, and typed targets the code can measure
  (revenue a month in the main currency, orders, conversion, a launch date, a number of products or pages), each read by an existing
  analytics function. Made in conversation (`set_goal`) and shown on a Goals page.
- **Plans** (`assistant_plans`, `assistant_plan_steps`): a plan is the model's, its steps are not free text: each is a kind from a fixed
  catalogue (`STEP_KINDS`: a tool call or a playbook with its arguments, a question for the owner, a wait for a date or a figure), with the
  steps it depends on, a check in code that says it worked (a product exists and is active, a page is published and has no blocking
  issue, a figure moved), a status, tries and its result. The model proposes and revises plans; the code validates every step.
- **The loop**: `/api/cron/autopilot` every minute, one step per store at a time, claimed with an expiry; a step runs as a headless turn
  limited to the step's tools, with a time limit and the store's budget; its check decides done, try again or ask; three failures make it a
  question for the owner. Never `decide_approval` in a turn the autopilot runs (its words are not a person's yes).
- **Autonomy levels** per area (catalogue, website, design, setup, marketing, messages to customers, money): *Ask me first*, *Do it and tell
  me*, *Just do it*; default *Ask me first* for everything public and for money. Budgets: AI spend a month, the deepest discount, the
  largest price change, theme purchases. Never automatic whatever the level: refunds over the budget, payment and payout settings,
  staff and permissions, closing the store, deleting anything.
- **Decisions and reports**: one Decisions page (approvals, questions with options to pick, things only the owner can do), an email digest,
  and a weekly report (figures from the analytics functions, progress against the goals, concerns and what it will do next, written by the
  model over the figures and checked by the claims filter).
- **The audit log says when the AI acted**: `audit()` gains `by: "person" | "ai_manager" | "autopilot"`, kept with the entry and shown on
  Activity.

## 8. Unit L (D311): legal pages by AI (outline)

This changes D158's rule that a legal page's words are hand-written starters and never a model's. The owner's decision (2026-10-22): a strong
agent can research and compile legal texts better than most store owners, so a store's legal pages are written and kept current by the AI,
with no person reviewing each text. What keeps them right is how they are made:

- **Sources, not memory.** A register of the official sources per country and topic (EUR-Lex for the directives and regulations, Lovdata,
  Riksdagen, Retsinformation, the consumer and data protection authorities' own pages), fetched by code through `safeFetch()`, kept with
  the day read and a hash. The model writes from the fetched text given as data, never from what it remembers (a model's memory still
  links the EU's ODR platform, repealed in 2025).
- **Citations checked word for word.** Each section names the source it rests on and quotes it; the code refuses a section whose quote is
  not in the fetched text.
- **The store's facts, checked against the store.** Every fact comes from `legalFacts()` and the store's settings, and the code checks the
  page against them: the return window and who pays return shipping as `return_settings` say, the withdrawal period never under 14 days,
  the seller's name, number and address as the store's details, the carriers and tracking tools the store uses, no `[[placeholder]]` left.
- **Every topic, every language.** `REQUIRED_TOPICS` and `CONDITIONAL_TOPICS` are checked as they are for the starters, in each of the
  store's languages; words pass the claims filter (no promise the store has not made).
- **Kept current.** Sources are fetched again on a schedule; a changed source or a changed store fact (a new country, a new carrier, a new
  tracking tool, another return window) writes the affected pages again, published at the owner's level for legal pages, with the reason
  in the report. Every version is kept (`page_versions`, and `legal_snapshots` for what a buyer accepted), with its sources and the model.
- **The owner's part** is one choice when they turn it on, said plainly once: the AI writes and keeps the store's legal pages, and as the
  seller the store stays responsible for them. The hand-written starters stay as the fallback when there is no model or a source cannot be
  read. Kaizena Flow may have a lawyer read the generator's rules and the source register once per country (recommended, not a gate).

The consumer texts that are part of the product itself (the withdrawal function, emails, the checkout's words, `HAND_WRITTEN_ONLY`) are not
in this unit and stay as they are until a later decision.

## 9. Unit C (D310): eyes (outline)

A signed, short-lived preview address for one draft page (as the replicator's frame, for a page id), photographed at a phone's and a
computer's width through `looking()`, judged by the model that sees pictures (`seeing()`) against a fixed list (nothing cut off or
overlapping, words readable on their background, pictures in place, the call to action visible), its answer read into findings by code,
together with `pageIssues()` and `findClaims()`. A build step's check can ask for it; a page goes back for one more round at most twice.
Store-wide: the home, a product page and the cart, photographed after a design change.

## 10. What stays with a person

Identity and money (the payment provider's onboarding, the bank account, payouts), agreements with carriers, a domain's DNS records, physical
work (packing, real product photographs, counting stock), and the owner's own taste where they want it: the agent asks them to pick between
two or three options rather than to judge one. Everything else is the agent's to do within the levels and budgets the owner sets.

## 11. Tests

Each tool: an integration test through the tool and a read back through the screen's own reader; refusals in the screen's words; another
store's things never reached; gated tools only kept until the yes. B: PGlite tests of the plan and step rules; an integration test of a plan
run to the end by the loop with a fake model; the autonomy levels and budgets. L: the citation check refuses an invented quote; the fact
checks refuse a page that disagrees with the store; a changed source writes the page again. C: the findings reader on fixed answers.
