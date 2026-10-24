# PSI follow-ups

What came of the [PSI audit of 2026-10-24](psi-2026-10-24.md), kept in one place so nothing deferred is lost. The rule agreed with the
owner: during development, do what protects the running system or gets dearer with every commit; leave paperwork and operational
maturity for the run-up to launch. Point IDs are the audit's.

## Decided

- **Deploys stay ungated by CI.** `next build` on Vercel already runs the full TypeScript check and fails on any error (Next's
  `typescript.ignoreBuildErrors` is off), so a type error never replaces the live deployment; a typecheck gate in CI would add minutes
  and no protection. Revisit at launch: wait for the `static` job (REL-03, CODE-07).

## Done (2026-10-24)

- **SEC-08** Next.js 16.3.6 → 16.4.2 (two critical RCE advisories, SSRF, DoS, cache poisoning), `eslint-config-next` to match,
  sharp 0.35.5, zod 4.6.7, `source-map-js` and `@vercel/cli-config`'s pinned zod held up by `overrides` in `pnpm-workspace.yaml`.
  `pnpm audit --prod` is clean. A CI job `audit` reports new high or critical advisories in production dependencies; it is in no
  job's `needs`, so it never holds back a deploy or a migration.
- **AST-01, SEC-12** One rule for every model prompt, `src/lib/prompt-safety.ts`: outside text (site, customers, files, pictures, web
  pages, tool results) is data, never instructions (`UNTRUSTED_TEXT`); input meant to steer (an owner's brief, staff's words) chooses
  the subject, never the rules (`RULES_STAND`). Added to the AI manager, product texts, alt texts, page translation, motion plans,
  the page studio, broadcast words, the domain assistant, memory learning and theme highlight words. `prompt-safety.scan.test.ts`
  fails for a new module with a system prompt that lacks it.
- **REL-01** `src/app/s/[store]/[market]/error.tsx`: a failed store page keeps the store's header, footer and theme and says so in the
  shopper's language (`pageError` in the four browser catalogues), with Try again, the store's front door and the error's reference.
  `src/app/global-error.tsx` for a failing root layout.
- **SEC-07** `nosniff` on every response; the admin may be framed only by Kaizena Flow and the theme store's own host
  (`frame-ancestors`, `src/lib/csp.ts`). `Referrer-Policy` is left to the routes, which set `no-referrer` where it matters.

## Build into development (conventions that compound)

- [x] **REL-02, REL-06** `log()` (`src/server/log.ts`, JSON lines) for new code; `commerce.cron_jobs` keeps the last run of every cron
      route and of each dispatcher job (`tracked()`, `runJobs()`, `trackedRoute()`), a throwing job no longer fails the others, the
      platform home lists jobs that are late or failing (`src/lib/cron-health.ts`) and Usage and limits shows them all; `maxDuration`
      on every cron route, held by `cron-routes.scan.test.ts`.
- [ ] **REL-02** Move the remaining `console.error` lines in `src/server` to `log()` as each module is touched; send an alert (email
      to platform admins) when a job turns failing.
- [ ] **CODE-02** Typed database reads for new code and money queries (zod `.parse` or `sql<T>`), with a line in CLAUDE.md. No rewrite
      of the existing calls.
- [ ] **AGT-10, AGT-14, AST-09** An eval harness for the AI manager and the chat (stored turns, thumbs as labels, the injection
      corpus), before widening the agent's reach.
- [ ] **AGT-04, AGT-11** Scheduling and follow-ups the agent can write (scheduled experiments and broadcasts, "follow up on"), then
      event-triggered turns.
- [ ] **AGT-01** Task parity, gated like the existing tools: staff and roles, billing, broadcasts, segments, automations, reviews,
      order edits, exchanges, support replies, Work.
- [x] **ACC-01** Axe on the `signed-in` Playwright project: `e2e/signed-in/a11y.spec.ts`, ten owner pages and four platform pages, no
      serious or critical finding at the start.
- [x] **ACC-02, UX-11** Focus stays on the button that sent a buy form (`useKeepFocus()`, `src/components/keep-focus.ts`: add to cart,
      the phone's bar, gift cards, bookings, box deliveries); a skip link in the admin shell (`#admin-main`); a Pause button on a moving
      brands strip (ACC-06, reversing D204's choice of none).
- [ ] **ACC-02** The other storefront forms that disable their button while sending (account, company, privacy, codes, withdrawal,
      reviews, exchanges, pay links: about 25) take `useKeepFocus()` too.
- [x] **DATA-02, PERF-04** `src/server/store-writers.scan.test.ts`: a new writer of `commerce.stores` must refresh `storeTag(slug)`;
      the 23 that rely on their callers are listed and the list only shrinks. The search cache's `understand` entries were already keyed
      on the store's categories and tags (the instructions are part of the key, `src/server/query-understanding.ts`): the audit's doubt
      there was unfounded.
- [ ] **DATA-02** Move the 23 listed writers to refreshing the tag themselves, as each is next touched.
- [ ] Dev-only advisories (Vitest's and drizzle-kit's local dev servers: vite, `@vitest/mocker`, esbuild) at the next Vitest upgrade.

## Leave for the launch run-up

- [ ] **REL-04** Confirm point-in-time recovery (five minutes in the Supabase dashboard: worth doing now), run the restore drill, write
      RPO and RTO, back up the `documents` bucket. Lifts the audit's only gating cap.
- [ ] **REG-06, REG-07, REG-08** Sign the pending DPAs, move the platform's AI to the EU path, write the breach runbook, a DPIA for the
      AI features and an AI Act note; tell customers about tone scoring.
- [ ] **REG-02** Legal review of the platform's terms, privacy notice and DPA; fill in the company name.
- [ ] **REG-03, DATA-05** Owner and staff account erasure; a whole-store export.
- [ ] **REL-09, PERF-01, PERF-02, PERF-11** Status page and SLOs; real-user vitals; a Dublin-side measurement of `/admin`; per-route
      bundle budgets.
- [ ] **SEC-05, SEC-02, SEC-10, SEC-11** Nonce-based CSP on admin and storefront (Report-Only first); leaked-password protection;
      budgets on `/api/consent` and `/api/ab/*`; logging failed sign-ins and permission denials.
- [ ] **ACC-09, UX-12** A recorded manual screen-reader pass of checkout, the builder and the inbox; WebKit in the storefront e2e.
