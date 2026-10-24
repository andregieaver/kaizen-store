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

- [ ] **REL-02, REL-06** A JSON `log()` helper (level, store id, request id from `x-vercel-id`) for new code, and a `cron_runs` row per
      dispatcher run with a "not run in 15 minutes" banner on the platform home; `maxDuration` on every cron route.
- [ ] **CODE-02** Typed database reads for new code and money queries (zod `.parse` or `sql<T>`), with a line in CLAUDE.md. No rewrite
      of the existing calls.
- [ ] **AGT-10, AGT-14, AST-09** An eval harness for the AI manager and the chat (stored turns, thumbs as labels, the injection
      corpus), before widening the agent's reach.
- [ ] **AGT-04, AGT-11** Scheduling and follow-ups the agent can write (scheduled experiments and broadcasts, "follow up on"), then
      event-triggered turns.
- [ ] **AGT-01** Task parity, gated like the existing tools: staff and roles, billing, broadcasts, segments, automations, reviews,
      order edits, exchanges, support replies, Work.
- [ ] **ACC-01** Axe on the `signed-in` Playwright project.
- [ ] **ACC-02, UX-11** Keep focus on the buy button after adding to the cart (it falls to `<body>` today); a skip link in the admin
      shell; a Pause control on the brands marquee (ACC-06).
- [ ] **DATA-02, PERF-04** A scan test pairing every writer of `stores` with a `storeTag` refresh; a taxonomy version in the search
      cache key for `understand` entries.
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
