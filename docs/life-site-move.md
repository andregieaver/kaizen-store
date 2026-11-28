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
   footprints, bell, briefcase and quote join the icon list (`src/lib/icons.ts`, `ListIcon`).
2. **Cards block** (`cards`): items each with a marker (an icon in a tinted circle, a number, a coloured monogram, or a round picture),
   eyebrow, title, text, a points list (checks or dots), a badge with a tone, and a link; columns per screen size, the card's look, and
   optional filter chips by an item's group. It holds Life's feature cards, pains, numbered steps, use-case cards, the integrations
   explorer, the roadmap, the add-on card and the team.
3. **Badge** (`badge`): a small pill with an icon and words, as over a hero heading.
4. **Questions shown open**: the FAQ block's look where every answer is shown, in cards.
5. **Glow**: a row's or column's soft radial light from the top, as behind Life's heroes and call-outs.
6. **A picture per language**: an image block's picture may differ by language (its translations), for illustrations with words in them.
7. **Boxed checks**: an icon list's look with each line in a bordered box.

Illustrations: Life's app previews are drawn in HTML. They are captured from the live site at twice their size, in each language
(`/`, `/nb/…`, `/sv/…`), as WebP, kept in the store's media library with alt texts, and placed as pictures (6 above).

## Steps

1. Inventory and this plan. Done 28 November 2026.
2. The parts above, each with its rules, words and tests, usable by every store and Kaizena Flow's own site.
3. The Life store's theme: dark palette from Life's `globals.css` (background `#000000`, surface `#1c1c1e`, text `#ffffff`, muted
   `rgba(235,235,245,.72)`, border `rgba(84,84,88,.6)`, accent `#0975e2` with white), Geist for headings and text at weight 700 for
   headings, pill buttons, cards at 9 px, content 1152 px wide; header and footer pages.
4. The importer (`scripts/life-site/`): builds each page's content from the message files and Life's rows, checks it with `pageInput`
   and `pageIssues()`, and saves it as a draft through the Admin API (an owner token for the store, `content:write` and
   `products:manage`); pictures through the media endpoints. Run first against a local copy of the store for screenshots.
5. Checks: every page in each language beside the old one (desktop and phone screenshots), the copy compared word for word, links,
   titles, descriptions, language links and the sitemap; redirects for addresses that change.
6. The switch: kaizenalife.com to the store, the app to app.kaizenalife.com, only with the owner's go-ahead.
