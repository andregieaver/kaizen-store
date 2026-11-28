# Moving kaizenalife.com into Kaizena Flow (D916)

A working plan (the owner, 28 November 2026: "migrate the pages of kaizenalife.com, their copy and images, and recreate their design
and layout ... you are allowed to create additional blocks to close [a builder] gap"). Kaizena Life's marketing site moves from the
lifesaver-app repo into the Flow store `kaizena-life`, built from Flow's own blocks on a theme of its own, so it stays editable in the
builder. Steps are ticked here as they land, with the date and commit.

## Decisions

- **Source, not scraping.** The copy comes from lifesaver-app's message files (`messages/{en,nb,sv}/{marketing,useCases,legal}.json`)
  and Life's database (`blog_articles`, `app_settings`, the team); pictures from Life's Supabase storage (`blog`, `branding`). The live
  site is the visual reference and the check, never the source.
- **Languages: en, nb, sv**, the three the site publishes (`MARKETING_LOCALES`; de and es fall back to English there). English is the
  pages' own language, nb and sv their translations. The store keeps its markets' languages (da, de) for the shop.
- **Same look, rebuilt from blocks**: the Life store's theme carries the design; pages follow it. No page-wide CSS copies.
- **The domain** (later, the owner's go-ahead first): Flow serves kaizenalife.com, the app moves to app.kaizenalife.com.
- **App screens stay in the app**: sign-in, sign-up, `/app`, `/api`, `/auth`, invites, the podcast guest link.

## The pages

| Life address | Flow page | Sections (Flow parts) | New parts it needs |
|---|---|---|---|
| `/` | front page | hero with glow (badge, H1, text, note, two buttons, sign-in line); app preview; six feature cards; "for the deliberate few" band (text + four checked rows); how it works (three numbered steps); closing call-out card | badge, cards (icon, number), glow, boxed checks, illustration pictures |
| `/features` | `features` | hero; seven feature rows (icon, eyebrow, H2, text, dot list) with an illustration beside five, alternating; comparison table; button | cards' points list, illustrations |
| `/plans` | `plans` (the starter `pricing` page goes) | hero; Plans component filtered to the Kaizena Life category, Monthly/Yearly; add-ons card (Running Analyzer); footnotes; questions, every answer shown | FAQ shown open |
| `/running-analyzer` | `running-analyzer` | intro; four "how" cards in two columns; three accuracy tiers (H3 + table); principles (check list); call-out box | cards |
| `/about` | `about` | narrative (rich text from `app_settings.sales_agent_knowledge`); team grid (round picture, name, role, bio, X link) | cards with a round picture |
| `/integrations` | `integrations` | hero; integrations explorer (filter chips by category, cards with a coloured monogram, "Mobile app" badge, capabilities list); call-out | cards' filter chips and monograms |
| `/use-cases` | `use-cases` | hero; five use-case cards linking on; call-out | cards with a link |
| `/use-cases/{the-entrepreneur,the-family,the-community,the-organiser,the-biohacker}` | `use-cases/…` | hero (two columns, illustration); pains (four cards); solutions band (five or six rows with eyebrow, H3, text, check list, illustration); a day in the life (timeline); roadmap (status badges); quote; call-out | cards' badges, illustrations |
| `/blog`, `/blog/{slug}` | the store's blog and 38 articles | Flow's blog listing; each article with its picture, author (Hermes) and the AI disclosure | none |
| `/privacy`, `/terms`, `/support`, `/accessibility`, `/account-deletion` | pages of those slugs | rich text from `legal.json` (account deletion is English only in Life) | none |
| 404 | the store's not-found page | `common.notFound` | none |

Header: logo, Features, Use cases, Integrations, Pricing, Blog, About, languages, Sign in (to the app), "Get started". Footer: name and
tagline, the ten links of Life's footer, cookie settings, copyright. Both are header/footer pages of `site` and `menu` parts.

Not moved, decided one by one: the sales agent's video avatar (the app's API; Flow's own site chat is the candidate), the cookie banner
(Flow's consent banner replaces it), the language picker (Flow's languages part).

## Gaps in the builder, closed with new parts

1. **Icons**: Lucide's bot, video, calendar-days, radio, list-checks, dumbbell, plug, rocket, users-round, clipboard-list, activity, eye,
   footprints, bell, briefcase and quote join the icon list (`src/lib/icons.ts`, `ListIcon`). Done 28 November 2026 (dab6704d).
2. **Cards block** (`cards`): items each with a marker (an icon in a tinted circle, a number, a coloured monogram, or a round picture),
   eyebrow, title, text, a points list (ticks or dots), a badge with a tone, and a link; columns per screen size, the card's look, and
   optional filter chips by an item's group. It holds Life's feature cards, pains, numbered steps, use-case cards, the integrations
   explorer, the roadmap, the add-on card, the team, and the questions on `/plans` (every answer shown, as Life shows them). Done 28
   November 2026 (a078bf0e).
3. **App preview** (`appPreview`): Life's illustrations are HTML mockups of the app (a window with dots and an address, a sidebar, a
   briefing card, checklists, bar charts, a chat, progress rings, a calendar heatmap, a kanban, invoice rows), full of words in three
   languages. The block draws them from eleven kinds of editable part, translated with the page, in the theme's colours, instead of a
   picture per language. Done 28 November 2026.

Made with what the builder has: the hero's badge is an icon list of one line inside a pill (the block's border, corners and padding);
the glow behind heroes and call-outs is a row's radial blur (`GRADIENT_STYLES.radial`, focus at the top centre, the accent's tint on
the background); checked rows are an icon list.

## Found while importing (28 November 2026)

- **Add-ons**: Running Analyzer and Podcast Studio are sold in Life; the Flow store sells Free, Plus and a draft Pro only. As plan products in
  a category of their own they would show in a second Plans component on `/plans`; until then that page has no add-ons and no prices are
  written into it.
- **Questions on `/plans`** are the FAQ component (boxed, the first open), not every answer shown as Life does: it keeps the FAQPage data
  Life's page carries for search engines.
- **About** is English in every language, as Life's is. Its pictures are copied into the store's library on the real import
  (`--copy-pictures`).
- **Small text in Life's blue** uses `#0a84ff` (Life's own text blue) and the glow `#0a1a33`: the button blue `#0975e2` reads at 3.4:1 on
  the glow, and the page check asks 4.5:1.

- **Articles' dates**: Flow dates an article when it is published, so the 38 articles would all carry the day they are published unless
  the API takes a first-published date; Life's dates are 30 June to 23 November 2026.
- **Header and footer, as Life has them** (its `nav.*` and `footer.*` words, in all three languages): the header holds the logo
  (`site`, logo), a menu (Features `/features`, Use cases `/use-cases`, Integrations `/integrations`, Pricing `/plans`, Blog `/blog`,
  About `/about`), the languages part, Sign in (to the app) and a Get started button to `/plans`; the footer holds the name with
  "Continuous improvement, one day at a time.", a menu (Features, Use cases, Integrations, Pricing, Sign in, Cookie settings, Privacy,
  Terms, Support, Accessibility) and "© 2026 Kaizena Life. All rights reserved.".

## Steps

1. Inventory and this plan. Done 28 November 2026.
2. The parts above, each with its rules, words and tests, usable by every store and Kaizena Flow's own site.
3. The Life store's theme, from Life's `globals.css`, as Design settings take it (hex only, so Life's translucent text and lines are
   given as they look on black): always dark; dark palette background `#000000`, surface `#1c1c1e`, text `#ffffff`, secondary text
   `#a9a9b0`, lines `#38383a`, accent `#0975e2`, text on accent `#ffffff`; light palette (unused while always dark) `#f4f5f8`,
   `#ffffff`, `#0b0d12`, `#59595f`, `#ebecf0`, `#0068da`, `#ffffff`; Geist for headings and text, headings bold, filled pill buttons,
   cards medium (8 px, Life's 9 px), fields small, content 1152 px wide. Tried on a local copy of the store 28 November 2026 with the
   Cards and App preview pages. On the real store it is set in Design settings (the Admin API has no write for a theme); header and
   footer pages come with the import.
4. The importer (`scripts/life-site/`, run with `node scripts/life-site/run.mjs`, its header has the arguments): builds each page once
   per language from the message files with the same ids, keeps English and makes Norwegian and Swedish translations with the builder's
   `translationOf()`, checks it as the editor's save does (`pageInput`, `pageIssues()`, `cleanTranslations()`; a search engine's text
   over its length is cut at a word), and saves it as a draft through the Admin API (`POST /pages`, `PATCH` for a page of the same
   address made before); pictures through the media endpoints. The front page is done and checked on a local copy of the store beside
   kaizenalife.com, 28 November 2026, and so are features, plans, Running Analyzer, integrations, the use cases with their five pages, about
   and the five legal pages (17 pages, each checked locally beside its Life page). What Life builds from its database or code is kept beside
   the importer as dated copies (`scripts/life-site/data/`: the plans' features, the integrations, the about page's story and team, the
   legal documents, read with `htmlToRichText()`). The blog's 38 articles are read at import time from kaizenalife.com (its RSS feed and
   each article's page: body, picture, author, the AI disclosure) and saved as draft articles (`--only blog`, or `blog:slug`).
   The header and footer are not the API's to make (it makes pages and articles; menus it only reads): they are built in the admin
   from Life's (below), or the Admin API gains headers, footers and menus first. The token is the owner's (`content:read`, `content:write`,
   `products:manage`), a network secret of the session for `kaizena-life.kaizenstore.site` (kaizenaflow.com's `Authorization` holds the
   incident log's). Before the real import the owner makes English the store's main language with Norwegian and Swedish offered
   (Settings, Languages and currencies; Norway shows Norwegian, Sweden Swedish) and switches on Languages (Settings, Features).
5. Checks: every page in each language beside the old one (desktop and phone screenshots), the copy compared word for word, links,
   titles, descriptions, language links and the sitemap; redirects for addresses that change.
6. The switch: kaizenalife.com to the store, the app to app.kaizenalife.com, only with the owner's go-ahead.
