# Generators of Kaizena Flow's own pages

Pages of kaizenaflow.com made from `docs/site-design.md`'s recipes by code kept here, so a page can be made again when the product moves on.
The comparison pages have their own generator (`docs/comparison-evidence/pages/`, `docs/comparison-pages.md`).

| Page | Address | Generator | Row id |
|---|---|---|---|
| Store Manager | `/store-manager` | `store-manager.test.ts` | `6adcc040-3916-4a40-81b2-7e6cff781b40` |

## Running one

```bash
pnpm exec vitest run --config docs/site-pages/vitest.config.mts
```

Each generator builds its page, checks it as the editor's save does (`pageInput`, then the page checker `pageIssues()` with the platform's
theme and text styles) and runs the claims filter (`findClaims()`) over its words; the test fails on a blocking issue or a claim. It writes
`{page}.page.json` and `{page}.check.json` to the system's temporary folder (`kaizena-site-pages`), never into the repository. Each run makes
new part ids.

## Saving one

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
