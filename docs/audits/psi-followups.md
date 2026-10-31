# PSI follow-ups

What came of the [PSI audit of 2026-10-24](psi-2026-10-24.md), kept in one place so nothing deferred is lost. The rule agreed with the
owner: during development, do what protects the running system or gets dearer with every commit; leave paperwork and operational
maturity for the run-up to launch. Point IDs are the audit's.

## Decided

- **Deploys stay ungated by CI.** Decided 24 October 2026 on the ground that `next build` on Vercel ran the full TypeScript check, so a
  type error never replaced the live deployment. **That ground is gone since D378 (28 October 2026)**: to fit Vercel's 8 GB the build there
  skips the type check, and a push without a migration deploys at once. So today a type error can reach production, with CI's `static`
  job red beside it within about five minutes; a push with a migration still waits for every check. The choice is the owner's: gate
  direct deploys on `static` (a deploy then waits about five minutes) or keep them ungated and accept that window (REL-03, CODE-07).
  Corrected 30 October 2026 (PSI re-score item 8).

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
- [ ] **AGT-14** Replay stored manager turns with thumbs as labels. Labels since 30 October 2026: Platform → AI counts the owners' thumbs per AI manager prompt version (`managerRatingsByVersion()`, counts only, never a conversation's words), beside the eval runs, so a new version is compared with the last by the people who use it; replaying rated turns against a new prompt remains. Done (D391): the prompts are versioned (`promptVersions()`, kept with
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
- [x] Dev-only advisories (Vitest's and drizzle-kit's local dev servers: vite, `@vitest/mocker`, esbuild) at the next Vitest upgrade. Done 30 October 2026: Vitest 5.0.5 (`@vitest/mocker` 5.0.5), vite held at 8.3.5 and drizzle-kit's loader at esbuild 0.25.12 by overrides in `pnpm-workspace.yaml`; `pnpm audit` (dev included) finds nothing, `db:check` and every test suite pass.

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
- [x] **REL-09, PERF-01, PERF-02, PERF-11** Status page and SLOs; real-user vitals; a Dublin-side measurement of `/admin`; per-route
      bundle budgets. Real-user vitals of Kaizena Flow's own site and the admin are measured (D390, Platform → Usage and limits); the
      status page is D360; its SLOs since 30 October 2026 (each part's objective over 30 days from the same checks, `SLO_TARGETS` and `sloOf()` in `src/lib/status.ts`: 99.9 % for stores, sign-in and payments, 99.5 % for email and background work, shown with the minutes of failed checks still allowed); per-route budgets since 30 October 2026 (`e2e/performance.spec.ts` `FIRST_SCRIPTS_BUDGETS`: the product page, Kaizena Flow's front page, sign-up, status, sign-in and forgot password, beside the front page's), set after measuring them found the signed-out pages loading the admin's whole English text (2.0 to 2.1 MB of first scripts, now 0.71 to 0.84 MB): `ActionForm`, `PasswordField` and the sign-in panels read their words through `admin-text-context.tsx` (`useCommonText()`, `useSignInText()`), whose provider carries no catalogue. A Dublin-side measurement of `/admin` since 30 October 2026: the status checks' website probe also fetches `/admin/sign-in` from the functions' region (Dublin) to its last byte and keeps the time in `status_checks.duration_ms` (never a reason to call the website down); Platform → Usage and limits shows the median and slowest 5 % over 7 days (`adminFromDublin()`).
- [x] **SEC-02** Leaked-password protection is on (Supabase Auth, the owner, 25 October 2026), and the admin's password sign-in has
      its own limit per email: 10 wrong tries in 15 minutes stop it for that address, counted alike for every address under a keyed
      hash (`src/server/sign-in-limit.ts`); a sign-in link still works.
- [x] **SEC-05, SEC-10, SEC-11** Nonce-based CSP on admin and storefront (Report-Only first); budgets on `/api/consent` and
      `/api/ab/*`; logging failed sign-ins and permission denials. Done (D389): a site-wide `Content-Security-Policy-Report-Only` (`siteReportOnlyCsp()`, without a nonce, which the prerendered pages cannot carry) reporting to `/api/csp-report`, counted as `csp.violation` log lines with the directive, the blocked origin and the area only; `takeBudget()` on `/api/consent` (`consent`) and `/api/ab/assign` (`ab`); `admin_sign_in.failed`, `admin_sign_in.locked`, `admin_sign_in.two_step_failed` and `auth.permission_refused` log lines with ids only. Enforcing it waits for what the reports show.
- [x] **SEC (advisor)** `public.rls_auto_enable()`: EXECUTE revoked from PUBLIC, `anon` and `authenticated` (migration
      `revoke_rls_auto_enable`; the event trigger still fires, tested).
- [ ] **ACC-09, UX-12** A recorded manual screen-reader pass of checkout, the builder and the inbox; WebKit in the storefront e2e. WebKit since 30 October 2026: CI's e2e job runs the store's pages, search, the cookie notice, withdrawal, the cart, the shopper's account and the All products page in Safari's engine too (`webkit` project, `WEBKIT_SPECS` in `playwright.config.ts`, 32 tests), through HTTPS (`e2e/fixtures/https-proxy.mjs`, a certificate made for the run): a production build sets its cookies `Secure`, which WebKit refuses on `http://localhost`. The screen-reader pass remains a person's.

## From the re-score of 2026-10-30

The code items of [the re-score's ranked list](psi-2026-10-30.md) (Ranked improvements across segments), in its order; the owner's items
stay in the standing document's *What comes next*.

- [x] **ACC-05 (accessibility 2)** Field-level errors in `ActionForm` and a warning before the checkout hold ends. Done 30 October
      2026: an action that refuses with `formProblems(issues)` (`src/lib/form-problems.ts`) names each field's problem, and `ActionForm`
      marks those fields `aria-invalid`, describes each by its line in the list (`aria-describedby`) and moves the focus to the first,
      taking the marks away on the next answer (sign-up, setup's and the company page's business details, who the store sells to,
      delivery days; `e2e/sign-up.spec.ts`). The checkout's *held for 30 minutes* line becomes an alert five minutes before the hold ends
      and the page is drawn again at the end, offering to start over (`HoldClock`, `OpenCheckout.secondsLeft`); Stripe's session cannot be
      made longer, so starting over is the way to more time. Other forms move to `formProblems()` when touched.
- [x] **ACC-07 (accessibility 6)** No sideways panning on phones; 24 px targets in footers. The header's effect layer was clipped on
      30 October 2026 (`087e79cb`: a fixed gradient layer clips itself; `/`, `/sign-up`, `/status` and `/themes` measured 390 wide at
      390 px on production on 31 October). Footer targets done 31 October 2026: the footers' own links (contact email, cookies, the
      withdrawal function, legal pages, *Report illegal content*) are 24 px tall at least, and a bare social logo is a 24 by 24 target
      (WCAG 2.2 SC 2.5.8; `e2e/target-size.spec.ts` measures every footer link and button on Kaizena Flow's site and a store at 390 px,
      failing on the code before).
- [x] **ACC-08, ACC-03 (accessibility 4)** A live region for finished answers only; one main heading on a theme's page. Done
      31 October 2026: the AI manager's transcript is no longer `aria-live` (every streamed word was read out); a hidden polite region
      says the newest answer once it is finished, and the answers already there when a conversation opens count as said
      (`src/lib/answer-announce.ts`). A theme's own page counts its stage's heading as the page's main heading, so the hidden title
      heading is no longer added beside it (`mainHeadingIn()`, `page-article.tsx`).
- [x] **ACC-02 (accessibility 5, critical)** Focus after the buyer dialog; an e2e case for `KeepFocusEverywhere`. Done 31 October 2026:
      closing the first-visit *Private or business?* question (a choice or Escape) puts the focus on the page's main heading, or its
      main region, instead of the page's body, where the next Tab went to the chat button at the end (`buyer.tsx`; `e2e/b2b.spec.ts`,
      failing on the code before). The cart's discount-code button, which has no focus handling of its own, is shown to keep the focus
      after it sent (`e2e/discounts.spec.ts`).
- [x] **ACC-09, ACC-01 (accessibility 7)** A scheduled axe scan of the published site in both colour modes. Done 31 October 2026:
      `.github/workflows/live-a11y.yml` runs `e2e-live/a11y.spec.ts` (`playwright.live.config.ts`) each day at 05:17 UTC and by hand:
      ten public pages of Kaizena Flow and the demo store, light and dark, failing on serious and critical findings. Text sitting directly
      on a part's own picture, video or gradient is left to `pageIssues()` (axe measures it against the page behind); text on a solid card
      inside such a part is measured. Its first run found the pricing page's plan names at 1.05:1 in dark mode (the plans block gave them
      #171717 in both modes); migration `pricing_dark_names` takes that colour away so they follow the cards' text. Left from ACC-09: the
      dated screen-reader pass, the enforcement bodies and a named owner (the owner's).
- [x] **DATA-03 (data 2)** `Idempotency-Key` on Admin API POSTs, a Mollie 401 renewed once, Stripe's `apiVersion`. Done 30 October
      2026: a POST with the header is done once per token and key, the same request getting the first answer again
      (`Idempotent-Replayed: true`) and another request under the key refused, answers kept 24 hours (`commerce.api_idempotency_keys`,
      migration `api_idempotency`, pruned by the dispatcher, in the register); a Mollie call answered 401 renews the token and asks once
      more; Stripe clients and new webhook endpoints are pinned to `2026-08-26.dahlia` (`STRIPE_API_VERSION`). The "no events" alert was
      done earlier (REL-02).
- [x] **DATA-02 (data 5, critical)** `store-roles.ts`'s exception shown safe. Done 30 October 2026: `store-writers.scan.test.ts` now
      checks that every write it makes to `commerce.stores` sets only `role_templates_offered`, that it uses no cache, and that no other
      code names the column, so no cached read can hold a stale value of it.
- [x] **REG-12 (privacy 6)** The legal check's remaining lines, a no-show disclosure and a DSA note with a report button. Wording done
      30 October 2026 (`docs/legal/check-2026-10-29.md`): the Swedish dated-service exception in the law's own words (servering, catering,
      kultur- och idrottsevenemang); SV, DA and EN complaints as the statutes put them (reasonable time, two months always in time, with
      konsumentköplagen 5:2 and 4:14 and købeloven §§ 81 and 83), never "as soon as you notice"; return costs limited to withdrawals and
      voluntary returns in all four; "Angrer du?" and the last-parcel rule in the withdrawal line of the emails. No-show done 30 October
      2026: an appointment with a deposit and a no-show fee says so on its product page, with the share of the price, and the terms starter
      has the sentence while such an appointment is active (four languages). DSA done 31 October 2026 (D411, `docs/dsa.md`): *Report
      illegal content* in every store's footer and Kaizena Flow's own leads to `/report` (art. 16(2)'s contents, a sender may stay unnamed
      only for offences against children), a receipt and an alert to the platform admins, a person's decision with its reason at
      `/admin/platform/reports`, the decision and redress to the sender, the statement of reasons to the store when content is restricted
      (art. 17), the sender forgotten 12 months after. Left, the owner's: the lawyer on art. 19 (micro or small enterprise), points of
      contact (arts. 11, 12) and moderation in the terms (art. 14). Part 2 done the same day: an AI reads each notice first and drafts, and
      checks new and changed listings (art. 7), filing flags in the same queue; a person decides every one (`docs/dsa.md` Part 2).
- [x] **REG-08 (privacy 5)** Tone and summaries in the store's privacy starter, and `docs/ai-act.md`. Done 30 October 2026: the starter's
      automated-decisions section says an AI reads the tone of support messages or summarises them, each only while it does (the chat
      notice's `aiUse` through `legalFacts()`, four languages); `docs/ai-act.md` classifies each use (provider and deployer, Art. 50, no
      prohibited or high-risk use). Its one gap, machine-readable marking of AI pictures (Art. 50(2)), closed the same day for new pictures:
      IPTC `DigitalSourceType` in each file's XMP. Pictures made before then are listed as left in the note.
- [x] **REG-03 (privacy 7)** A shopper's erasure reaches the AI manager's conversations. Done 30 October 2026: in the erasure's
      transaction, before their orders are anonymised, their email addresses, full names (two words or more) and phone numbers (any
      spacing) as the account and their orders hold them are blanked in the store's `assistant_messages` (`src/lib/erasure-traces.ts`,
      `blankAssistantTraces()`; `privacy-erasure.int.test.ts`). A first name alone is left, being too common to blank everywhere.
- [x] **SEC-06 (3)** Secret-box key id, a rotation runbook, a gift-card hash key of its own. Done 30 October 2026 (D410): `v2.<kid>.…`,
      `SETTINGS_ENCRYPTION_KEY_PREVIOUS` read during a rotation, `reencryptSecrets()` in the dispatcher, `GIFT_CARD_HASH_KEY` and
      `RECOVERY_CODE_HASH_KEY` (`scripts/hash-keys.mjs`), `docs/runbooks/key-rotation.md`. The owner's part: set the two hash keys once.
- [ ] **SEC-05, SEC-07 (4)** Enforced nonce CSP on `/admin`, then the storefront; `frame-ancestors` on storefront and platform pages; HSTS
      `includeSubDomains` once every subdomain is confirmed HTTPS.
      `frame-ancestors` done 30 October 2026: every path sends `frame-ancestors 'self'` (and the theme store's host when it has one,
      `baseRouteHeaders()`); the pay routes keep `'none'`. Not done, and why: Next's guide (`content-security-policy.md`) says a nonce needs
      every page dynamically rendered and that partial prerendering, which `cacheComponents` gives the admin's shells, is incompatible
      with it; the alternative it names, SRI hashes, is experimental. Enforcing it means giving up the admin's prerendered shells or
      trying SRI on a preview first: a decision, not a quick fix. HSTS `includeSubDomains` waits for the owner to confirm every subdomain
      of `kaizenaflow.com` serves HTTPS.
- [ ] **AST-09, AST-01, AGT-14 (6)** An eval that measures the model: payloads the filter does not catch, several runs per model, a model
      save gated on a pass, the replay failing on a changed model or tool description.
      Tool descriptions done 30 October 2026: every recording carries `toolsVersion()` (a hash of each tool's name, description and
      parameters, `src/server/agent-eval.ts`), and CI's replay fails when the tools changed since it was recorded. The recording in the
      repository predates it and is not held to it; the next run on Platform → AI carries it. Left: new payloads, several runs per
      model and the gate on a model save, which need live runs.
- [ ] **REL-09, REL-02, DATA-03 (7)** Event-arrival checks, the `webhooks` drill on a schedule, an outside probe.
      Code's part done 30 October 2026: the status page's Payments probe, every five minutes, now also fails on a Stripe endpoint that
      sends somewhere other than this site (the `webhooks` drill's check, so it runs on the probe's schedule) and on silence: two or
      more payments taken in six hours with no Stripe event received in them (`stripeSilent()`, `src/lib/status.ts`). Two failed checks
      email the platform admins, as before. Left, the owner's: an outside probe (an EU uptime monitor on `/api/health` and `/status`),
      since the status page is checked from inside its own functions.
- [x] **CODE-03 (8)** The HUF money test that fails outside CI. Done 30 October 2026: it was the runtime, not the test. ICU 77 (Node
      22.22) shows HUF with two decimals where CI's showed none, so a price looked different by server; `formatMoney()` fixes whole forints
      (`DISPLAY_DIGITS`). The same data made DAC7's `decimalAmount()` print HUF's hundredths as forints on the older runtime, and the price
      rule screen show an ending in the wrong unit: both now use the stored digits (`minorUnitDigits()`). The deploy gate stays the owner's.
- [x] **REG-11 (10)** Sensitive-information mode and a minimum-age sentence.
      Done 30 October 2026. Support settings have *This store handles health or other sensitive information* (`support_settings.sensitive`,
      migration `support_sensitive`; the owner's alone to change). While it is on, no AI reads tone or writes summaries (both forced off,
      whatever was saved), every email goes to people (a new one and one the AI held before are handed over, never answered by the AI), and
      transcripts are kept 30 days at most (`TRANSCRIPT_DAYS_SENSITIVE`). The checkout questions' hint says to ask nothing about health or
      beliefs unless the sale needs it (GDPR art. 9). The terms starter says ordering takes 18 or older, in EN, NB, SV and DA. The live chat
      on the site still uses the AI when the desk puts it first: the setting's text says only what it does.
- [x] **UX-08 (11)** Homer and Lisa written into `docs/admin-style.md`, applied to the product editor and support settings.
      Done 30 October 2026 (the code's part): `docs/admin-style.md` 2.1 sets the rules (Homer's view the default, one *Advanced* fold
      per screen that only hides, opened by a failed save). The product editor folds the standard category, who buys it, price by
      quantity, subscriptions, safety, tax and returns; the support settings fold everything but who answers, when nobody is there and
      the opening hours. The five-person usability session is the owner's.
- [x] **AGT-03, AGT-04 (13)** Approval expiry, `cancel_page_build`, pending follow-ups with cancel.
      Approval expiry done 30 October 2026: `assistant_approvals.expires_at` (seven days after the ask; migration
      `assistant_approval_expiry`), the dispatcher's `assistantApprovals` job ends pending calls past it as `expired` (never run, an
      autopilot step waiting on them skipped as if declined), and a yes after the end is refused with the reason in the conversation.
      `cancel_page_build` done 30 October 2026: the AI manager stops a build by its id (`src/server/site-tools.ts`); one waiting is never
      built, one being built is ended and the runner, finding it so, deletes the unfinished draft (`keep()` writes only while the job waits).
      Pending follow-ups done 30 October 2026: the Autopilot page's Decisions (a store's and Kaizena Flow's) lists what the AI manager will
      come back to, when in the store's time and how often, each with Cancel (`waitingFollowUps()`, `cancelFollowUp()`); the chat's
      `list_follow_ups` and `cancel_follow_up` use the same. MCP resuming the admin conversation (AGT-12, AGT-13) is not part of this.
- [x] **DATA-06 (14)** `deletePage()` records a redirect and strips menu items. Done 30 October 2026: in one transaction the menus lose
      their links to the page (by address in a store's, by id in Kaizena Flow's; links under one move up), and a store's published page or
      article leaves a manual redirect from its address and every former one (`page_redirects`) to the front page or the blog; one already
      there is kept, one the database refuses is logged and skipped (a savepoint), and the owner retargets them in Website → Redirects.
- [ ] **CODE-05, CODE-02 (15)** README as onboarding; lint warnings ratcheted to 0.
      README done 30 October 2026: one page under the right name (where to start, running it locally, the checks, how a push
      reaches production, where things are, the rules a first change trips on, the runbooks); the platform's one-time setup moved
      to `docs/runbooks/platform-setup.md`. Lint warnings 98 → 0 the same day, and `pnpm lint` now fails on any warning
      (`--max-warnings 0`). Left: `docs/rules/admin.md` split by area.
