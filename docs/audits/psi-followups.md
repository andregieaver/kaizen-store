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
  `Permissions-Policy` everywhere (28 October 2026, `PERMISSIONS_POLICY`): no camera, location, USB or topics; the microphone for the site's
  own voice features only; payment left to the default Stripe's wallets need.

## Build into development (conventions that compound)

- [x] **REL-02, REL-06** `log()` (`src/server/log.ts`, JSON lines) for new code; `commerce.cron_jobs` keeps the last run of every cron
      route and of each dispatcher job (`tracked()`, `runJobs()`, `trackedRoute()`), a throwing job no longer fails the others, the
      platform home lists jobs that are late or failing (`src/lib/cron-health.ts`) and Usage and limits shows them all; `maxDuration`
      on every cron route, held by `cron-routes.scan.test.ts`.
- [x] **REL-02** Move the remaining `console.error` lines in `src/server` to `log()`; send an alert (email to platform admins) when a
      job turns failing. The alert is D389's (`alertFailingJob()`, `src/server/cron-alerts.ts`); every `console.error` in `src/server`
      outside `log.ts` went to `log()` in D400 (206 calls in 81 modules, ids and counts only: a visitor's path and a provider's error text
      are no longer logged).
- [x] **CODE-02** `typedRows()`/`typedRow()` and `col` (`src/server/typed-rows.ts`) for new reads and money reads, a rule in CLAUDE.md,
      and the gift card liability reads converted first.
- [x] **CODE-02** Convert the other money reads as they are touched (analytics, payouts, refunds, tax reports first). D400 converted
      Finance's refunds, lost disputes and spend (`analytics-totals.ts`, through `checkedRows()` over `setBased()`), the payouts report
      (`payouts-report.ts`) and the refunds page's totals (`analytics-refunds-data.ts`); the tax reports read documents through
      `tax_document_groups()` and their exports log no money. The other analytics loaders still read `Row` and move over when touched.
      D404 converted the rest: 41 money reads in 15 analytics loaders, each row described with `col` and checked (`checkedRows()`,
      `typedRows()`), jsonb results included; reads of counts, names and dates only stay as they were.
- [x] **AGT-10, AST-09** The agents' safety eval (`src/lib/agent-eval.ts`, `src/server/agent-eval.ts`): the chat and the manager with
      their real prompts and tools on scripted tool answers that hide instructions (product text, knowledge, a customer's note, a
      support message, a page), plus off-topic, invented prices, prompt extraction and an asked-for refund; run from Platform → AI,
      each run kept per model (`commerce.ai_eval_runs`).
- [x] **AGT-05, AST-07, AST-01, AST-05** (re-score 2026-10-26) Every model call is recorded with who made it (`ai_usage.acted_by`), and page
      builds, pictures and page looks run as whoever asked, so the autopilot's monthly budget counts everything it causes; a call no price
      covers stops it while it has a limit; broadcasts are never automatic and emails to customers at most `customerEmailsPerWeek`
      (default 5) a week; AI answers by email are marked as the AI's; D334.
- [ ] **AGT-14** Replay stored manager turns with thumbs as labels. Done (D391): the prompts are versioned (`promptVersions()`, kept with
      every AI manager and chat answer and eval run) and the evals run in CI against a recorded model (`agent-eval-replay.int.test.ts`
      replays `src/data/agent-eval-recording.json`, a run downloaded from Platform → AI; the gate is live once the first recording is kept).
- [x] **AGT-04, AGT-11** The AI manager can start an A/B test at a time (`start_experiment` with `at`) and keep follow-ups
      (`follow_up`, daily or weekly too, which also covers a weekly "what needs a look"); D318.
- [x] **AGT-04** Turns started by events: the order rule action *Ask the AI manager* queues a follow-up for the paid order in the name of
      whoever saved the rule (owners only, at most 20 a store a day); D318.
- [x] **AGT-01 (marketing)** Broadcasts (`list_broadcasts`, `draft_broadcast`, `send_broadcast` gated, now or at a time), segments
      (`list_segments`), customer tags (`tag_customer`) and email automations (`list_email_automations`, `switch_email_automation` gated);
      this also gives scheduled broadcasts (AGT-04).
- [x] **AGT-01 (gift cards)** `issue_gift_card` (gated `spend`): emailed to the person it is for, its code never in the AI manager's answer.
- [x] **AGT-01 (support)** `get_support_conversation`, `add_support_note`, `reply_to_support` (gated `send`), `end_support_conversation`; D318.
- [x] **AGT-01 (team and plan)** `list_staff`, `invite_staff`, `change_staff_role`, `remove_staff` (gate `access`), `billing_overview`,
      `change_plan`, `end_plan` (gate `spend`), the owner's; D318.
- [x] **AGT-01 (orders)** `preview_order_change`, `change_order` (gate `spend`), `preview_exchange`, `propose_exchange` (gate `send`),
      `process_exchange` (gate `spend`); D318.
- [x] **AGT-01 (Work)** `work_overview`, `list_work_clients`, `list_work_assignments`, `log_time`, `issue_work_invoice` (gate `send`); D318.
- [x] **AGT-01 (reviews)** No tool, on purpose: review moderation stays on the Reviews page, since a review's words are never sent to a
      model (D301), so the agent could not judge one.
- [x] **ACC-01** Axe on the `signed-in` Playwright project: `e2e/signed-in/a11y.spec.ts`, ten owner pages and four platform pages, no
      serious or critical finding at the start.
- [x] **ACC-02, UX-11** Focus stays on the button that sent a buy form (`useKeepFocus()`, `src/components/keep-focus.ts`: add to cart,
      the phone's bar, gift cards, bookings, box deliveries); a skip link in the admin shell (`#admin-main`); a Pause button on a moving
      brands strip (ACC-06, reversing D204's choice of none).
- [x] **ACC-02** The other storefront forms that disable their button while sending (account, company, privacy, codes, withdrawal,
      reviews, exchanges, pay links: about 25) keep the focus: one listener per page, `KeepFocusEverywhere` (D390), in the storefront
      and Kaizena Flow's own site; the AI manager's box is focused by ref or `data-ai-composer`, never its placeholder (ACC-08).
- [x] **ACC-04** Kaizena Flow's front page reads at 4.5:1 (migration `platform_front_contrast`), text on a part's own background holds
      that background's colour set (`kz-on-light`/`kz-on-dark`, the footer's *Cookies* link in dark mode), and `pageIssues()` checks the
      colours the site's and the page's CSS give class names (D390).
- [x] **DATA-02, PERF-04** `src/server/store-writers.scan.test.ts`: a new writer of `commerce.stores` must refresh `storeTag(slug)`;
      the 23 that rely on their callers are listed and the list only shrinks. The search cache's `understand` entries were already keyed
      on the store's categories and tags (the instructions are part of the key, `src/server/query-understanding.ts`): the audit's doubt
      there was unfounded.
- [x] **DATA-02** Move the 23 listed writers to refreshing the tag themselves (D400: each now calls `refreshTag(storeTag(slug))` or
      `refreshStoreById()` after its write; `refreshTag()` does nothing outside Next, so jobs and tests run them as they are). One stays
      listed in `store-writers.scan.test.ts`: `store-roles.ts`, which runs while a page renders (a tag cannot be refreshed there) and
      writes only `role_templates_offered`, which no cached read shows.
- [ ] Dev-only advisories (Vitest's and drizzle-kit's local dev servers: vite, `@vitest/mocker`, esbuild) at the next Vitest upgrade.

## Leave for the launch run-up

- [ ] **REL-04** Run the first drill. Point-in-time recovery is off by the owner's decision (25 October 2026: daily backups, RPO up to
      24 hours, revisit at launch); `docs/runbooks/restore.md` has the targets (RTO 1 hour proposed), the copy's scheduled jobs as the
      first step, the replay of Stripe, Mollie, carriers and emails, and `scripts/restore-check.mjs` for the checks. Still to do: the drill
      itself (lifts the audit's only gating cap) and a daily copy of `product-media`, `documents` and `digital-files` to a second EU bucket.
- [ ] **REG-06, REG-07, REG-08** Sign the pending DPAs, move the platform's AI to the EU path, an AI Act note; tell customers about tone
      scoring. Written as drafts for the owner's and a lawyer's review (28 October 2026): the threat model (`docs/security.md`, SEC-01),
      the breach runbook (`docs/runbooks/breach.md`) and the DPIA for the AI features (`docs/dpia-ai.md`), whose findings are still open:
      a shopper's erasure does not reach the AI manager's conversations. Done in code (D391): those conversations are kept 12 months after
      each message or the owner's own period, and the chat tells customers when their tone is read and conversations summarised, the
      support settings page telling the owner.
- [ ] **REG-02** Legal review of the platform's terms, privacy notice and DPA. Published 30 October 2026 (D408, after the PSI re-score
      found none of them on production): written from the business details (all filled in, no placeholders) in English and Norwegian by
      the `platform_legal_pages` drill, and linked from the theme footer beside Cookies. A person's review is what is left.
- [x] **REG-03, DATA-05** Owner and staff account erasure; a whole-store export. Built 28 October 2026 (D377): Your account → *Delete
      your account* (`eraseOwnAccount()` in `src/server/account-erasure.ts`: the account made anonymous in place, its memberships, the AI
      manager's conversations, memories, notices, skills and follow-ups, devices, recovery codes and staff emails gone, its applications
      emptied, its sign-in user deleted; refused for the last owner of a store not closed, a platform admin, a host or a domain's holder;
      a fresh sign-in and the email typed), and Close store → *Take your store with you* (`storeExport()` in `src/server/store-export.ts`:
      the website, look and settings as one JSON file, never a secret or a person, the owner's), beside the CSV files.
- [ ] **REL-09, PERF-01, PERF-02, PERF-11** Status page and SLOs; real-user vitals; a Dublin-side measurement of `/admin`; per-route
      bundle budgets. Real-user vitals of Kaizena Flow's own site and the admin are measured (D390, Platform → Usage and limits); the
      status page is D360; its SLOs since 30 October 2026 (each part's objective over 30 days from the same checks, `SLO_TARGETS` and `sloOf()` in `src/lib/status.ts`: 99.9 % for stores, sign-in and payments, 99.5 % for email and background work, shown with the minutes of failed checks still allowed); per-route budgets since 30 October 2026 (`e2e/performance.spec.ts` `FIRST_SCRIPTS_BUDGETS`: the product page, Kaizena Flow's front page, sign-up, status, sign-in and forgot password, beside the front page's), set after measuring them found the signed-out pages loading the admin's whole English text (2.0 to 2.1 MB of first scripts, now 0.71 to 0.84 MB): `ActionForm`, `PasswordField` and the sign-in panels read their words through `admin-text-context.tsx` (`useCommonText()`, `useSignInText()`), whose provider carries no catalogue. A Dublin-side measurement of `/admin` remains.
- [x] **SEC-02** Leaked-password protection is on (Supabase Auth, the owner, 25 October 2026), and the admin's password sign-in has
      its own limit per email: 10 wrong tries in 15 minutes stop it for that address, counted alike for every address under a keyed
      hash (`src/server/sign-in-limit.ts`); a sign-in link still works.
- [x] **SEC-05, SEC-10, SEC-11** Nonce-based CSP on admin and storefront (Report-Only first); budgets on `/api/consent` and
      `/api/ab/*`; logging failed sign-ins and permission denials. Done (D389): a site-wide `Content-Security-Policy-Report-Only` (`siteReportOnlyCsp()`, without a nonce, which the prerendered pages cannot carry) reporting to `/api/csp-report`, counted as `csp.violation` log lines with the directive, the blocked origin and the area only; `takeBudget()` on `/api/consent` (`consent`) and `/api/ab/assign` (`ab`); `admin_sign_in.failed`, `admin_sign_in.locked`, `admin_sign_in.two_step_failed` and `auth.permission_refused` log lines with ids only. Enforcing it waits for what the reports show.
- [x] **SEC (advisor)** `public.rls_auto_enable()`: EXECUTE revoked from PUBLIC, `anon` and `authenticated` (migration
      `revoke_rls_auto_enable`; the event trigger still fires, tested).
- [ ] **ACC-09, UX-12** A recorded manual screen-reader pass of checkout, the builder and the inbox; WebKit in the storefront e2e.
