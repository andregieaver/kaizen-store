# Generators of Kaizena Flow's own pages

Pages of kaizenaflow.com made from `docs/site-design.md`'s recipes by code kept here, so a page can be made again when the product moves on.
The comparison pages have their own generator (`docs/comparison-evidence/pages/`, `docs/comparison-pages.md`).

| Page | Address | Generator | Row id |
|---|---|---|---|
| Store Manager | `/store-manager` | `store-manager.test.ts` | `6adcc040-3916-4a40-81b2-7e6cff781b40` |
| Languages and Currencies | `/languages-and-currencies` | `languages-and-currencies.test.ts` | `664ec8d9-171e-4c8f-bfe7-b66151da30f3` |
| Investors | `/investors` | `investors.test.ts` | `a4ec2279-6f0f-443c-a2fc-bb315ee76044` (Kaizena Flow's own store) |
| Mission Statement | `/mission-statement` | `mission-statement.test.ts` | `f3a4b3cd-35bf-4ed0-bcd7-84e96178eb91` (Kaizena Flow's own store) |

`try-the-page-builder.test.ts` (*Try the page builder*, D457 S4) is here too, with its own parts and its notes in `docs/builder-sandbox.md`.

The parts the pages above are built from (the hero, three cards, feature rows, highlighted cards, questions, the end) and the check are
`parts.ts`, in the shape of the feature pages the owner published on 5 November 2026 (`docs/site-design.md` 6.11).

## Running one

```bash
pnpm exec vitest run --config docs/site-pages/vitest.config.mts
```

Each generator builds its page, checks it as the editor's save does (`pageInput`, then the page checker `pageIssues()` with the platform's
theme and text styles) and runs the claims filter (`findClaims()`) over its words; the test fails on a blocking issue or a claim. It writes
`{page}.page.json` and `{page}.check.json` to the system's temporary folder (`kaizena-site-pages`), never into the repository. Each run makes
new part ids.

## Saving one

**Where:** while kaizenaflow.com is served from Kaizena Flow's own store (D484, since 7 November 2026), its pages are that store's rows
(`store_id` the house store, `commerce.house_store()`): a new page is inserted there, with its `saved` version and a `store.page_saved` entry, as
`savePage()` does for a store. The platform's own rows (`store_id` null) no longer draw the site and refuse to save while the switch is on.

As `docs/site-design.md` section 9 says: the page is saved as a **draft** over its row, as the editor's save does for a live page (`draft`,
`updated_at`/`updated_by`, a `saved` version in `commerce.page_versions`, a `platform.page_saved` entry in the activity log), in one
statement guarded by the row's `updated_at`, so an edit made meanwhile is never overwritten, and by the md5 of `jsonb::text` the checked
JSON gives, so the stored draft is exactly the checked page. **The live page is unchanged until the owner publishes it** at Website → Pages.

## Store Manager, 5 November 2026

The owner asked to recreate `/store-manager` "as you've done with the other pages", focused on what the AI Store Manager does for a store
owner. The live page (22 October) was a copy of *About us*. The draft has twelve rows in the shape of the feature pages the owner published
that day (Customer Care, Campaigns, Discounts): the hero, *Ask anything / Tell it what to do / Leave it running*, five feature rows (figures,
building, marketing, the daily work, the autopilot), *You stay in charge* (the three levels and what always waits), *Your way* (⌘K, voice,
memory, skills, notices, Claude and ChatGPT through the owner MCP), the Dream Factory, research and brand, six questions and the main
action. Every line is something built, its source beside it in the generator: `docs/rules/admin/ai.md`, the decisions (D94, D103 to D105,
D308 to D311, D328 to D331, D346, D350, D418, D437, D439) and the tools of `src/lib/owner-tools.ts`. No issues and no claims found.

Before publishing: look at it on a phone and in dark mode in the builder; screenshots of the AI manager's panel, an approval card and the
Autopilot page would make the feature rows better (none were added: the owner's feature pages of 5 November have no pictures either).
**Published by the owner on 5 November 2026 at 17:33.**

## Languages and Currencies, 5 November 2026

The owner asked for an updated `/languages-and-currencies` "to promote what Kaizena Flow is capable of internationally". The live page
(22 October) was a placeholder: a copy of *About us* under a *Localize* heading. The draft has eleven rows: the hero (*Sell Across Europe
From One Store*), *Speak / Show / Take* (languages, currencies, payments), six feature rows (languages, currencies, VAT, EU rules, shipping and
customs, country by country), three highlighted cards (the AI Store Manager adding a country, B2B abroad, data kept in Dublin), six
questions and the main action. Its sources are beside each row in the generator: `docs/rules/storefront.md` (D109, D110, D335, D338, D342,
D343), `docs/rules/admin/commerce.md` (D153, D157 to D161, D291, the carriers) and production's own tables read that day: 27 languages in
`commerce.platform_languages` and 28 countries (the EU's 27 and Norway) in `commerce.countries`. No issues and no claims found.

**Held back on purpose:** the shop's own words (buttons, checkout, emails) are written by hand in Norwegian, Swedish, Danish and English, and
`commerce.ui_translations` was empty in production on 5 November, so in the other 23 languages a shopper sees them in English until a
platform admin presses *Translate and review* at Platform → Languages (the nightly job then keeps them filled). The page therefore says *27 languages* of
the owner's own words (products, pages, menus, articles) and names the four the shop comes in. Once the other languages are translated, the
hero, the first card and the question *Which languages can my shop speak?* can say the whole shop speaks all 27. Vipps (through Mollie, live
payments not yet open) is not named.

## Investors and Mission Statement, 7 November 2026

The owner asked for an Investors page, "an elevator pitch to investors in the Kaizena Flow project or other projects that come out of
KaizenaLabs", and a Mission Statement "with mockup content based of what's written on the about us page". The footer already linked
`/investors` and `/mision-statement` (misspelt), both 404.

- **Investors** (nine rows): the hero (*Invest in AI That Runs Businesses*) with *Talk to Us*, a mail to `support@kaizenalabs.com` (the store's
  contact address; the owner may want an address of its own for investors), the pitch as three cards (the problem, our answer, why now),
  what is built, how Flow makes money (plans and a fee per sale, falling on bigger plans, yearly cheaper, premium themes; no amounts, which
  the claims filter keeps out and `/pricing` holds), the lab, its three projects (Flow, Life, what comes next), the ask, six questions and the
  end. **No figure is claimed** that the repository or production does not show: no revenue, users, round, amount or valuation; the page
  says those are shared in a meeting. *The ask* is the owner's to sharpen once there is a round to name.
- **Mission Statement** (seven rows): the mission in About us's own words (*enhance the capabilities and livelihood of everyone*), three
  beliefs, Kaizena Flow and Kaizen Life (About us's descriptions), the team, the name and the home, where we are headed, and the end linking
  `/investors`.
- Both pass the editor's checks with no issues and no claims; looked at on a local build with the site's theme, its CSS's classes and text
  styles, at 1440 and 390 px, nothing wider than a phone. English only, as the other generated pages: the Norwegian is the owner's to add with
  the builder's translation.
- **The footer:** both footers (the store's and the platform's own, which platform routes such as sign-up draw) were saved as drafts with the
  one link corrected to `/mission-statement`; the live footers keep the old link until the owner publishes them.
