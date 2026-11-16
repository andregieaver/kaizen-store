# Heatmaps and recordings (decision D652, planned)

A built-in alternative to Microsoft Clarity and Hotjar for store owners and for Kaizena Flow's own site. It covers:

- **dead clicks** and **rage clicks**;
- **recordings** of visits (replays), on phones and computers;
- **heatmaps**: where people click, how far down the page they scroll (as a percentage), and where they look (attention);
- **all of it per version of a running A/B test** (D148, `docs/ab-testing.md`).

Asked for by the owner on 16 November 2026. Status: **planned, nothing built.** The research behind it was done the same day: five
readings of this codebase, plus the definitions vendors and open-source tools publish, the techniques they use, and the law in Norway
and the EU (sources in section 17).

This file has two parts:

- **Part A (sections 1 to 12)** is the design: what is built and why.
- **Part B (sections 13 to 16)** is the build: steps in order, each with its files, its tests and when it is done.

It is written for an implementer who has not seen the research. Read sections 0, 3 and 16 before writing any code.

---

## 0. How to use this plan

1. **Build the steps of section 13 in order.** One step is one push to `main`, or a few pushes. Run `pnpm lint`, `pnpm typecheck` and
   `pnpm test` before every push (CLAUDE.md, Workflow). A step that has a migration also needs `pnpm db:check`. Run
   `pnpm test:int` against a seeded local database whenever the step touches `src/server`.
2. **Each step lists its files, the tasks, the tests to add and "Done when".** Do not start a step before the one before it is
   done, unless the step says it can be built in parallel.
3. **When this file and the code disagree, the code wins.** Stop, correct this file in the same change and say so in the change log
   (section 18). Line numbers in this file were right on 16 November 2026. Find the place by the name given, not by the number.
4. **Names that are already taken.** Never name anything `insights` (`analytics-insights.ts` and `owner-insights.ts` exist) or
   `analytics-heatmap` (the weekday-by-hour sales heatmap, D152). The names to use are fixed in section 5.4.
5. **Decision number.** Use D652 if it is still free (`grep -o "D65[0-9]" docs/decisions.md | sort -u | tail -3`), otherwise the next
   free number, and replace D652 in this file. Each step adds its own sentence to that decision row, plus its migration versions under
   "Migration versions" (CLAUDE.md, Database).
6. **Send the owner screenshots** of each new or changed screen as you build it (CLAUDE.md, Workflow). Steps 7, 11 and 12 say when.
7. **Read section 16 (pitfalls) before step 1, and again before steps 4, 9 and 11.**

---

# Part A: the design

## 1. What the owner and the shopper get

### 1.1 The owner (Homer first, Lisa one step away)

| Where | Homer sees | Lisa finds (in one *Advanced* fold) |
|---|---|---|
| Analytics → The site → **Heatmaps** (`/admin/{store}/analytics/heatmaps`) | A sentence ("1,240 page views mapped in the last 7 days; 6 % had a dead or rage click."), then **Where visitors get stuck**: the pages with the most frustration, each with *See the map*. | Period, the page list by views, the numbers behind each page |
| A page's map (`…/heatmaps?page=/no/p/blue-shirt`) | The page as a picture, with three views: **Where people click**, **How far people scroll**, **Where people look**. Toggles for Phone, Tablet and Computer. Chips for the A/B versions when a test runs on the page. Below the picture, a table of the parts clicked most, with their dead and rage clicks. | Click filters (All, Dead, Rage), "not on this picture" counts, *Take a new picture*, dates |
| Analytics → The site → **Recordings** (`/admin/{store}/analytics/recordings`, **owner only**) | A sentence ("84 recordings this week; 9 with rage clicks."), chips with counts (All, Rage clicks, Dead clicks, Phone, Computer), then recordings grouped by day, each with *Watch*. | Filters by page, period and A/B version |
| A recording (`…/recordings/{id}`) | A player: play, speed, skip the quiet parts (on by default), a timeline marked with page changes and dead and rage clicks, and a list of those moments beside it. *Delete this recording*. | The device, screen size and versions seen |
| An A/B test's results (`/admin/{store}/experiments/{id}`) | A new **Behaviour** section per version: share who reached half the page, share with rage clicks, share with dead clicks, and links *Heatmap* and *Recordings* for that version. A warning line when one version is clearly more frustrating. | — |
| Analytics → **Analytics settings** | Two switches, both off: **Heatmaps** and **Recordings**. Recordings asks three confirmations before it turns on, and how many visits to record. | Recordings: "Hide all text" (strict masking) |

### 1.2 The shopper

- **Nothing runs, and nothing is sent, until they say yes.**
- Heatmaps run only for visitors who accepted **Statistics**. When a store turns heatmaps on, every visitor is **asked again**, and
  the Statistics text now names heatmaps.
- Recordings run only for visitors who accepted a new choice, **Recordings of your visit**. The banner's first screen carries a
  short sentence about recordings of its own.
- The Cookies page explains both. It has a *Delete my recordings* button for the recordings this browser can still name.
- Global Privacy Control and Do Not Track mean no, as for visit counting.
- Nothing is collected on the cart, the checkout, order pages, account pages, links with tokens, or the chat. Typed text is never
  recorded.

---

## 2. Decisions

Settled by this plan. Items marked **(owner)** need the owner's yes before the step named. Items marked **(lawyer)** go to the open
questions in section 12.

1. **Built in, with no outside service.** The data stays in Supabase (`eu-west-1`) and Vercel functions in `dub1`, which are
   already sub-processors (`docs/residency-register.md`). No new vendor, no residency row, no 30 days' notice to stores. rrweb
   (MIT) runs in the visitor's browser and sends to our own routes, so it is a library, not a processor.
2. **Two switches per store, both off by default, owner only:**
   - **Heatmaps**, which includes dead and rage clicks. The setting is `stores.heatmaps`.
   - **Recordings.** The settings are `stores.recordings`, plus `recording_share` and `recording_mask`.

   These are settings like `stores.visit_counting`, not store features (D178). Making them a feature costs a migration of
   `feature_needs()` and buys nothing.
3. **Consent:**
   - **Heatmaps** sit under **Statistics**. A version token `heat` makes visitors be asked again, and the Statistics text names
     heatmaps while they are on. **(lawyer Q2)**
   - **Recordings** are a **new consent category, `recordings`**. It has its own toggle and its own short notice on the banner's
     first screen. This follows the CNIL's final recommendation on session replay (8 Oct 2026) and Datatilsynet's "one purpose per
     choice" (3 Apr 2025).
   - Nothing is loaded or sent before consent.
4. **Heatmaps are stored only as daily totals.**
   - There is no visitor id, no row per click and no raw event.
   - The tables are therefore not personal data (`NOT_PERSONAL`).
   - This also follows the bloat review's bar for writes: one beacon is at most four statements.
5. **Recordings are personal data, held under pseudonyms:**
   - a random id per browser tab, never linked to a customer, cart, order, visit or the consent cookie's id (CNIL "I1");
   - **only the owner** can watch them, and each viewing is written to the audit log first;
   - kept **30 days**;
   - can be deleted one by one, by the owner or by the visitor's own browser.
6. **Which pages: a fixed allow-list.**
   - **Allowed:** the front page, product pages, categories and tags, the product lists and blog lists, blog posts, and the store's
     own pages.
   - **Never:** the cart, checkout, order pages, account pages, any page with a token, the country chooser, the admin, and the
     search page (recordings only; heatmaps may run there).
   - **Never for staff:** owners and staff browsing their own store are never recorded (`staffPath()`).
7. **Masking in recordings:**
   - every input, select and textarea is masked, always;
   - the chat, the cart drawer and every form are blocked (they replay as empty boxes);
   - text marked private is masked;
   - "Hide all text" masks all text;
   - no canvas, no cross-origin frames, no network or console capture.
8. **The picture under a heatmap is a screenshot** taken by our own Chromium job (the page-looks job, D310):
   - three widths: 390, 820 and 1440 CSS px;
   - the page's parts are measured in the same pass, so clicks can be placed on the right part;
   - kept in a private bucket.

   Why not a live frame: the admin cannot frame a store's own domain (`frame-ancestors 'self'`). Why not a recording's DOM: heatmaps
   must work with recordings off.
9. **A/B tests:**
   - every heat total and every recording carries the test versions the visitor was really shown, checked on the server against
     the visitor's A/B cookie;
   - results show behaviour per version;
   - more frustration only **flags** a version and never stops a test. An automatic stop would need a new decision
     (`docs/ab-testing.md` "Guardrails").
10. **Plans:**
    - a monthly limit, `recordings_month`, which is hard: over the limit the store stops recording, silently;
    - heat beacons have a daily ceiling per store against abuse;
    - one plan-comparison row, which describes and gates nothing (D132);
    - the limit's values per plan are **(owner)**, needed before step 8 (proposal in section 10).
11. **Platform parity:**
    - kaizenaflow.com is served from the house store `kaizenaflow` (D484), so it gets everything in the same change;
    - the platform's own routes (sign-up, theme store, docs, status) are **not** in v1, for the reasons in section 11, and are named
      as the next step;
    - platform admins see counts only and never watch a store's recordings.
12. **AI manager tools come last (step 14),** because every new tool and every new admin page changes the manager's prompt, and the
    owner must then record the agents' eval again (section 16, pitfall 17).

---

## 3. Definitions (the one place they are written)

The numbers live in code as named constants: `src/lib/page-heat.ts` for heatmaps, `src/lib/click-signals.ts` for clicks and
`src/lib/recording.ts` for recordings. This table and the constants must agree; a unit test reads both.

| Term | Definition | Constant(s) |
|---|---|---|
| **Page view** | From a page load, or a soft navigation, to an allowed page (section 2.6), until the next page change or until the tab is hidden for good. A page view with less than 1 s visible is never sent (this drops `AbMarker`'s reload and bounces). | `MIN_VIEW_MS = 1000` |
| **Page key** | `placeOfPath(path, …).landing` (`src/lib/visit-record.ts`): `/no`, `/no/p/{handle}`, `/no/category/{slug}`, `/no/{slug}` …, worked out **on the server** from `location.pathname`. The kind is `speedKind(landing)` (`src/lib/speed.ts`). A path whose kind is null is never kept. | — |
| **Device class** | From `document.documentElement.clientWidth` at the start of the page view, against the store's breakpoints: below `md` is `mobile`, below `lg` is `tablet`, otherwise `desktop`. The defaults are 768 and 1024 (`DEFAULT_BREAKPOINTS`, `src/lib/breakpoints.ts`). These are the same three words as `visits.device`. Homer reads Phone, Tablet and Computer. | `deviceClass()` |
| **Anchor** | What a click is stored against. In order:<br>1. the nearest element (itself or an ancestor) whose **first** class is a part class `kz-{id}` (`partClass()`, `src/lib/part-css.ts`) with an id matching `PART_ID`;<br>2. a product card `li.product-card`, as `@card:{n}`, where n is its 0-based place in its list (below 100);<br>3. `@header` (the closest `header`), `@footer`, `@main`;<br>4. otherwise `@body`. | `PART_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\|(?:header\|footer\|product)-[a-z]+)$/` |
| **Cell** | Where inside its anchor's box a click fell: `cx = floor(10 × (clientX − left) / width)`, and `cy` the same with height, each clamped to 0..9, from `getBoundingClientRect()` at click time. | `CELLS = 10` |
| **Dead click** | A candidate click (below) after which, within 2500 ms, **nothing happened**. "Something happened" means any of:<br>- a DOM mutation counted by the rules below;<br>- a scroll within 300 ms;<br>- a selection change within 100 ms;<br>- focus moving (`focusin`) within 1000 ms;<br>- the tab hidden, blurred or left (`visibilitychange`, `blur`, `pagehide`) within 1000 ms;<br>- the URL changing within 2500 ms.<br><br>The verdict comes 2500 ms after the click. A click still waiting when the page view ends is **not** dead. | `DEAD_AFTER_MS = 2500`, `SCROLL_ALIVE_MS = 300`, `SELECTION_ALIVE_MS = 100`, `FOCUS_ALIVE_MS = 1000` |
| **Candidate click** | A trusted `click` with button 0 and no Ctrl, Meta, Shift or Alt, whose target is none of these: `input`, `textarea`, `select`, `option`, `label`, `[contenteditable]`, `canvas`, `video`, `audio`, `embed`, `object`, `iframe`, `html`, `body`. Not inside `[data-kz-private]` or `[data-kz-no-deadclick]`. The same element again within 1000 ms is not a new candidate. | `REPEAT_MS = 1000` |
| **Counted mutation** | A `MutationObserver` record of type `childList` or `characterData`, or `attributes` with a name other than `style` and not starting with `data-fx` (the motion runtime writes those as the pointer moves, `src/lib/motion-runtime.ts`), whose target is not inside `[data-kz-ambient]` (things that move by themselves: carousels, countdowns, animated stats, the brands marquee, videos). | `AMBIENT_SELECTOR` |
| **Rage click** | A run of at least 3 clicks. Each click must be at most 1000 ms after the one before it, and within 30 CSS px (straight-line distance) of the run's first click **or** on the same element.<br>- The run breaks on a scroll or a selection change.<br>- Targets that are text-like (`input` of a text type, `textarea`, `[contenteditable]`, `select`) or inside `[data-kz-no-rage]` never start or join a run (quantity steppers, carousel arrows and size pickers carry that mark).<br>- One rage click is counted per run, at its third click, and stored against the anchor of the run's first click. If any click in the run was dead, it is also "rage and dead". | `RAGE_COUNT = 3`, `RAGE_GAP_MS = 1000`, `RAGE_RADIUS_PX = 30` |
| **Scroll reach** | Per page view: `reach = min(100, floor(100 × maxBottom / maxHeight))`, where `maxBottom` is the largest `scrollY + innerHeight` and `maxHeight` the largest `document.documentElement.scrollHeight`, both seen during the view. Sampled on scroll (every 200 ms at most), on resize and on every attention tick. If `maxHeight ≤ innerHeight`, reach is 100. It is stored in 5 % buckets, `floor(reach / 5)`, so 0..20. | `REACH_BUCKETS = 21` |
| **Reached b %** | Over a period: the page views whose bucket is at least `b/5`, divided by all page views. The view shows 25, 50, 75 and 100 %. | — |
| **Fold** | At the first measurement after load: `round(1000 × innerHeight / scrollHeight)`, capped at 1000 (per mille). **Average fold** = sum of folds ÷ page views, shown as a percentage of the page. | — |
| **Attention** | Per page view, time is collected in 50 px bins of the page (at most 400 bins, so 20,000 px). A tick runs every 250 ms while the tab is visible and the visitor gave input (pointer, key, wheel, touch or scroll) in the last 15 s. On a tick, each bin whose middle line is inside `[scrollY, scrollY + innerHeight]` **in this tick and in the one before it** gets 250 ms. That second condition drops fly-by scrolling.<br><br>When the summary is sent, bins are put into **20 bands of 5 %** of `maxHeight` by their middle line. A band holds at most 120,000 ms per page view.<br><br>Shown as **seconds per page view**: Σ ms(band) ÷ page views. Also shown as share of time: ms(band) ÷ Σ ms. | `BIN_PX = 50`, `MAX_BINS = 400`, `TICK_MS = 250`, `IDLE_MS = 15000`, `BANDS = 20`, `BAND_CAP_MS = 120000` |
| **Frustration (page)** | Page views with at least one dead or rage click, divided by page views (`dead_views + rage_views`, counted once per view by the browser's flags). | — |
| **Recording** | One browser tab's visit while the visitor is sampled:<br>- **starts** on the first allowed page;<br>- **continues** across soft navigations and full loads in that tab;<br>- **ends** after 30 min without input, after 60 min in all, after 4 MB uploaded, after 200 segments or after 50 pages.<br><br>Nothing is uploaded until it has lasted 5 s and had one interaction. | `REC_IDLE_MS = 1_800_000`, `REC_MAX_MS = 3_600_000`, `REC_MAX_BYTES = 4_194_304`, `REC_MAX_SEGMENTS = 200`, `REC_MAX_PAGES = 50`, `REC_MIN_MS = 5000` |
| **Sampling** | When a tab's recording session starts: recorded if `Math.random() × 100 < recording_share`. The choice is kept for the tab's session. | `RECORDING_SHARES = [10, 25, 50, 100]`, default 50 |
| **Minimum volume** | A map needs at least 30 page views in the period, otherwise "N of 30 page views so far". **Where visitors get stuck** lists pages with at least 30 page views. A/B behaviour figures need at least 100 enrolled visitors per version. The A/B flag needs at least 1,000 per version and z ≥ 3.29. | `MIN_MAP_VIEWS = 30`, `MIN_VERSION_VISITORS = 100` |
| **Retention** | Recordings 30 days. Page totals 396 days (13 months). Click cells 90 days. Pictures under heatmaps 400 days after they were taken. | `RECORDING_KEEP_DAYS = 30`, `HEAT_KEEP_DAYS = 396`, `CELL_KEEP_DAYS = 90`, `SHOT_KEEP_DAYS = 400` |

Why these numbers:

- **Dead click.** 2500 ms is PostHog's mutation threshold (`posthog-js dead-clicks-autocapture.ts`). It sits between OpenReplay
  (1234 ms) and Sentry (3000 ms). Clarity publishes no number.
- **Rage click.** 3 clicks within 1 s each is what most tools use (PostHog, Datadog, Contentsquare, OpenReplay). The 30 px radius is
  PostHog's.
- **Scroll reach.** This is PostHog's `max_content_percentage`, kept in Clarity's 5 % steps.
- **Attention.** Clarity's and Mouseflow's "time on screen". The fly-by gate is our 250 ms tick, close to Contentsquare's published
  150 ms.
- **Retention.** Clarity keeps recordings 30 days and heatmaps 13 months. The CNIL says "a few months" at most for recordings.

---

## 4. Privacy and the law

This is not legal advice. The research is summarised here; the questions for a lawyer are in section 12.

1. **Consent is required for both.**
   - EDPB Guidelines 2/2023 (paras 33, 44, 53): JavaScript that sends what it reads on the device is "access" under ePrivacy
     Art. 5(3), with or without cookies.
   - Norway's ekomloven § 3-15 (in force 1 Jan 2025) has only two exemptions, and analytics is neither.
   - The CNIL (Oct and Nov 2026) says replay is never strictly necessary.
2. **Recordings get their own purpose.** The CNIL's recommendation (§5.1 and §5.2) wants replay as a specific purpose, plus a short
   separate mention of replay on the banner's **first** layer. Datatilsynet: consent is normally invalid if a visitor cannot say yes or
   no to each purpose.
3. **Aggregate heatmaps under Statistics** need the Statistics wording to name them, and visitors asked again. Whether one Statistics
   choice may cover them is lawyer question Q2.
4. **The A/B link changes nothing legally.** A/B tests already enrol only visitors who accepted Statistics (D148).
5. **Roles.**
   - The store is the controller and Kaizena Flow its processor.
   - Kaizena Flow never uses store recordings for its own purposes: no benchmarks across stores, no model training, no product
     analytics. If it did, it would become a joint controller (CNIL §3.2, citing Fashion ID).
   - For kaizenaflow.com, Kaizena Flow is the controller.
6. **Measures** (from the CNIL's annex for the UX purpose):
   - random sampling (L1);
   - masking by default (M0), and the input values are never collected (M3);
   - a random id per tab (I1);
   - passwords and bank data never collected (S1);
   - access by role (S2, here owner only);
   - individual recordings can be deleted;
   - kept a few months at most (here 30 days).
7. **Withdrawal stops recording at once,** in the open page, and deletes the recordings the browser can name (CNIL §6.2). Older
   recordings cannot be tied to the person by design (GDPR Art. 11) and expire after 30 days.
8. **Sensitive stores and children.**
   - Stores selling health, sexual-wellness, religious or political goods could record special-category data (CJEU C-252/21 and
     C-21/23).
   - Datatilsynet advises strongly against tracking on services aimed at children.
   - So switching recordings on asks the owner to confirm the store is neither, and that its privacy policy says recordings are made.
9. **The platform's legal texts are hand-written by the owner, never by a model** (`src/lib/platform-legal/en.ts:3-7`).
   - The DPA's types of personal data (`en.ts:288`) need "interaction and recording data".
   - Kaizena Flow's own privacy notice needs a sentence.
   - **This plan does not edit `src/lib/platform-legal/*`.** Step 13 lists the points for the owner.
10. **A DPIA.** Replay meets the "systematic monitoring" criterion of WP248. Step 13 drafts `docs/dpia-recordings.md`, marked as a
    draft for the owner and a lawyer, in the shape of `docs/dpia-ai.md`. It covers kaizenaflow.com (where Kaizena Flow is controller)
    and serves as a template a store can use.

### 4.1 Words shoppers read (drafts; step 1 writes them in en, nb, sv and da, flagged for legal review)

| Where | English draft |
|---|---|
| Banner, first layer, shown while recordings are on | "This shop can record how you use its pages (clicks, taps, scrolling and pointer movement) to find what is hard to use. What you type is never recorded." |
| Category `recordings`: name and text | "Recordings of your visit": "Records clicks, taps, scrolling and pointer movement on the shop's pages so the shop can see what is hard to use. Not on the cart, checkout, account or order pages; never what you type. Kept 30 days." |
| Category `statistics` while heatmaps are on | "Count visits and show how the site is used, including totals of where visitors click and how far they scroll (heatmaps), also per test version, so we can improve it." |
| Cookies page paragraph (heatmaps) | "Heatmaps: while you allow statistics, your browser sends which parts of a page you click, how far you scroll and how long parts of the page are on your screen. Only totals per page and day are kept, with no number that identifies you." |
| Cookies page paragraph (recordings) | "Recordings: while you allow recordings, the shop records what happens on its pages in this tab (the page, your clicks, taps, scrolling and pointer movement, your screen size). Everything you type, the chat, the cart, the checkout and your account are left out. A random number for this tab ties the recording together; it is never joined to who you are. Recordings are kept 30 days. You can withdraw at any time under Cookie settings, and delete the recordings this browser made: [Delete my recordings]" |

---

## 5. How it works

### 5.1 The picture

```
 Visitor's browser (a store page, after consent)                     Kaizena Flow (dub1)                 Supabase (eu-west-1)
 ┌────────────────────────────────────────────────┐
 │ <SiteSignals>  (lazy, idle, off the pay routes)│
 │  ├─ click watch ── dead / rage verdicts ───┐   │
 │  ├─ heat collector (scroll reach, attention,│  │ 1. one summary per page view
 │  │   clicks by anchor and cell, A/B tags)   ├──┼──── sendBeacon ────▶ /api/signals/heat ──▶ page_heat_days (daily totals)
 │  │                                          │  │                      checks: same site,     click_cells   (daily totals)
 │  └─ recorder (rrweb, sampled tabs only) ◀───┘  │                      consent, store, tags   experiment_events (rage/dead goals)
 │      gzip segments every 30 s                  │ 2. segments
 │      ──────────── fetch POST ──────────────────┼────────────────────▶ /api/signals/rec ───▶ recordings (one row per recording)
 │  ab-shown registry ◀── AbMarker (D148)         │                                          ──▶ bucket `recordings` (gzip files)
 │  on withdrawal: ids ── sendBeacon ─────────────┼────────────────────▶ /api/signals/forget ─▶ deletes rows and files
 └────────────────────────────────────────────────┘

 Admin (owner)                                                                                  
 ┌────────────────────────────────────────────────┐                     page-looks cron (every minute, Chromium)
 │ Heatmaps: picture + canvas overlay ◀───────────┼── signed URL ──────── bucket `page-maps` ◀── runMapShots(): shoots the page at
 │   + table of parts                             │                      page_map_shots (layout) ◀─ 390/820/1440 px, measures its parts
 │ Recordings: list ─▶ player (@rrweb/replay) ◀───┼── events route: audit first, then gunzip and sanitise the events, owner only
 │ A/B results: Behaviour per version             │
 └────────────────────────────────────────────────┘
```

A drawn version of this diagram is `docs/heatmaps-and-recordings.svg`.

### 5.2 Two streams, on purpose

| | Heat summary | Recording segments |
|---|---|---|
| Who | Every consenting visitor on allowed pages (never sampled: sampling would bias the A/B rates) | Sampled tabs of visitors who accepted recordings |
| Code in the browser | About 6 KB of our own, loaded idle | Plus rrweb's recorder, about 23 KB gzip, loaded only for a sampled tab |
| Sent | One small JSON summary (at most 8 KB) per page view, by `sendBeacon` | gzip segments every 30 s by `fetch`, and the tail by `sendBeacon` |
| Kept | Added to daily totals, with no visitor id | Files in a private bucket, plus one row per recording |
| Personal data | No | Yes (pseudonymous) |

### 5.3 What the server trusts

Nothing from the browser is trusted as it arrives.

- **Every route:**
  - same site (`sameSite()`);
  - the request comes from one of the store's own pages (`fromStoresOwnPage()`);
  - no robots (`isBot()`) and no GPC or DNT (`wantsPrivacy()`);
  - the store is open, its switch is on, and it is not a private store with the visitor locked out (`lockedOut()`).
- **Consent** is read again from the consent cookie on the server.
- **A/B tags** are checked against the visitor's own `kaizen_ab_{storeId}` cookie and the store's running tests.
- **Page keys** are worked out on the server from the raw path by `placeOfPath()`.
- **Recorded DOM** is treated as hostile HTML. It is sanitised on the way to the player, and the player draws it in rrweb's sandboxed
  frame, which never runs scripts.

### 5.4 Names (use exactly these)

| What | Name |
|---|---|
| Storefront component that runs everything | `SiteSignals` in `src/components/signals/site-signals.tsx`; lazy wrapper `src/components/lazy/site-signals.tsx` |
| Browser modules (DOM bindings) | `src/components/signals/click-watch.ts`, `heat-collector.ts`, `session-recorder.ts` |
| Pure modules (no DOM, no zod, browser-safe) | `src/lib/page-heat.ts`, `src/lib/click-signals.ts`, `src/lib/heat-collect.ts`, `src/lib/heat-anchor.ts`, `src/lib/signal-paths.ts`, `src/lib/ab-shown.ts`, `src/lib/recording.ts` |
| Pure modules for the server and admin | `src/lib/heat-read.ts`, `src/lib/replay-sanitize.ts` |
| Server modules | `src/server/page-heat.ts` (ingest), `src/server/page-heat-read.ts` (reads), `src/server/signal-tags.ts` (A/B tag check), `src/server/recordings.ts` (ingest, delete, prune, seal), `src/server/recordings-read.ts`, `src/server/recording-files.ts` (bucket), `src/server/map-shots.ts` |
| Routes | `/api/signals/heat`, `/api/signals/rec`, `/api/signals/forget` (new folder `src/app/api/signals/`) |
| Buckets | `recordings` (private, gzip), `page-maps` (private, JPEG) |
| Tables | `commerce.page_heat_days`, `commerce.click_cells`, `commerce.page_map_shots`, `commerce.recordings` |
| Store columns | `heatmaps`, `recordings`, `recording_share`, `recording_mask`, `recordings_confirmed_at` |
| Consent | category `recordings`; version token `heat` |
| DOM marks | `data-kz-private` (block in recordings, no clicks collected), `data-kz-mask` (mask text), `data-kz-ambient` (moves by itself), `data-kz-no-rage`, `data-kz-no-deadclick`. All are unused today (checked 16 Nov 2026). `data-kz-block` is **taken** (inline editing). |
| Admin message areas | `heatmaps` (`src/lib/admin-messages/heatmaps.{en,nb}.ts`), `recordings` (`…/recordings.{en,nb}.ts`) |
| Limit and metric | limit `recordings_month`, metric `recordings` |
| Retention kind | `recordings` |
| Audit actions | `analytics.heatmaps`, `analytics.recordings`, `analytics.recording_viewed`, `analytics.recording_deleted` |

---

## 6. Data

### 6.1 Store columns (migration in step 1)

```sql
alter table commerce.stores
  add column heatmaps boolean not null default false,
  add column recordings boolean not null default false,
  add column recording_share smallint not null default 50,
  add column recording_mask text not null default 'balanced',
  add column recordings_confirmed_at timestamptz;
alter table commerce.stores add constraint stores_recording_share check (recording_share in (10, 25, 50, 100));
alter table commerce.stores add constraint stores_recording_mask check (recording_mask in ('balanced', 'strict'));
```

- Write the columns in `src/db/schema.ts` beside `visitCounting` (`visit_counting`), then run `pnpm db:generate`.
- `stores` is not a hot table, so plain checks are fine.
- Read the columns into `Store` (`src/server/stores.ts`, as `visitCounting` is read): `heatmaps`, `recordings`, `recordingShare` and
  `recordingMask`.
- Every writer refreshes the store's tag (`store-writers.scan.test.ts`).

### 6.2 Heat totals (migration in step 3)

```sql
create table commerce.page_heat_days (
  store_id uuid not null references commerce.stores(id) on delete cascade,
  day date not null,                       -- the store's day (storeDayKey)
  page text not null check (char_length(page) between 1 and 300),
  device text not null check (device in ('mobile','tablet','desktop')),
  tag text not null default '' check (tag = '' or tag ~ '^[0-9a-f-]{36}:[a-d]$'),
  views integer not null default 0 check (views >= 0),
  reach integer[] not null check (cardinality(reach) = 21),
  fold_sum bigint not null default 0,
  attention_ms bigint[] not null check (cardinality(attention_ms) = 20),
  clicks integer not null default 0,
  dead_clicks integer not null default 0,
  rage_clicks integer not null default 0,
  dead_views integer not null default 0,
  rage_views integer not null default 0,
  primary key (store_id, day, page, device, tag)
);

create table commerce.click_cells (
  store_id uuid not null references commerce.stores(id) on delete cascade,
  day date not null,
  page text not null check (char_length(page) between 1 and 300),
  device text not null check (device in ('mobile','tablet','desktop')),
  tag text not null default '' check (tag = '' or tag ~ '^[0-9a-f-]{36}:[a-d]$'),
  anchor text not null check (char_length(anchor) between 1 and 60),
  cx smallint not null check (cx between 0 and 9),
  cy smallint not null check (cy between 0 and 9),
  clicks integer not null default 0,
  dead integer not null default 0,
  rage integer not null default 0,
  primary key (store_id, day, page, device, tag, anchor, cx, cy)
);
```

- **Tags.** `tag = ''` holds every visitor. A tag `{experiment id}:{version}` holds that version's visitors **as well**, so a tagged
  page view is written twice: once with `''` and once per tag. At most 5 tests run per store.
- **Adding arrays.** Two SQL functions add the arrays element by element. They go in the same custom migration and are used in the
  upsert (`set reach = commerce.add_int_arrays(page_heat_days.reach, excluded.reach)`):

  ```sql
  create function commerce.add_int_arrays(a integer[], b integer[]) returns integer[]
    language sql immutable parallel safe set search_path = ''
    as $$ select array_agg(x + y order by i) from unnest(a, b) with ordinality as t(x, y, i) $$;
  create function commerce.add_bigint_arrays(a bigint[], b bigint[]) returns bigint[]
    language sql immutable parallel safe set search_path = ''
    as $$ select array_agg(x + y order by i) from unnest(a, b) with ordinality as t(x, y, i) $$;
  ```
- **Row-level security.** Append `alter table … enable row level security;` for both tables. Drizzle does not write it, and
  `commerce.test.ts` fails without it.
- **Lists.**
  - `COPY_RULES`: `never("a copy counts its own")`.
  - `NOT_PERSONAL` in `src/lib/personal-data.ts`, with a reason: totals per page and day, no visitor.
  - `STORE_EXPORT_LEFT_OUT` with reason `record` (`src/lib/store-export-scope.ts`).
- **Retention.** Code constants (`HEAT_KEEP_DAYS`, `CELL_KEEP_DAYS`), like `SPEED_KEEP_DAYS`, pruned daily. The tables are not
  personal data, so they get no retention kind.
- **Writes per beacon.** One upsert into `page_heat_days` and one into `click_cells`, each a single statement for all of its rows
  (`insert … select from unnest(…)`). One `chat_usage` slot. At most one `experiment_events` insert. That makes at most four
  statements.

### 6.3 Pictures under heatmaps (migration in step 6)

```sql
create table commerce.page_map_shots (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references commerce.stores(id) on delete cascade,
  page text not null check (char_length(page) between 1 and 300),
  device text not null check (device in ('mobile','tablet','desktop')),
  tag text not null default '' check (tag = '' or tag ~ '^[0-9a-f-]{36}:[a-d]$'),
  status text not null default 'waiting' check (status in ('waiting','done','failed')),
  requested_at timestamptz not null default now(),
  shot_at timestamptz,
  width integer, height integer,           -- the picture, in CSS px
  layout jsonb,                            -- MapLayout (section 9.2), at most 3000 anchors
  problem text check (char_length(problem) <= 200),
  unique (store_id, page, device, tag)
);
create index page_map_shots_waiting_idx on commerce.page_map_shots (requested_at) where status = 'waiting';
```

- **Files.** One picture per row: bucket `page-maps`, path `{storeId}/{id}.jpg`. A new picture overwrites the old one (`upsert: true`).
- **Lists.** RLS on. `COPY_RULES` `never`. `NOT_PERSONAL`: a picture of a public page, taken by a robot.
  `STORE_EXPORT_LEFT_OUT` `record`. Also a `storage:page-maps` entry in `NOT_PERSONAL`.

### 6.4 Recordings (migration in step 8)

```sql
create table commerce.recordings (
  id uuid primary key,                     -- made by the browser (crypto.randomUUID)
  store_id uuid not null references commerce.stores(id) on delete cascade,
  day date not null,                       -- the store's day when it started
  started_at timestamptz not null,
  last_at timestamptz not null,
  duration_ms integer not null default 0 check (duration_ms between 0 and 3600000),
  device text not null check (device in ('mobile','tablet','desktop')),
  width smallint, height smallint,         -- viewport at the start, CSS px
  market text check (char_length(market) <= 24),
  entry_page text not null check (char_length(entry_page) between 1 and 300),
  pages text[] not null default '{}' check (cardinality(pages) <= 50),
  clicks integer not null default 0,
  dead_clicks integer not null default 0,
  rage_clicks integer not null default 0,
  tags text[] not null default '{}' check (cardinality(tags) <= 5),
  mask text not null check (mask in ('balanced','strict')),
  segments smallint not null default 0 check (segments between 0 and 200),
  bytes integer not null default 0 check (bytes between 0 and 4194304),
  sealed boolean not null default false,   -- segments merged into one file
  viewed_at timestamptz                    -- first watched by the owner
);
create index recordings_store_started_idx on commerce.recordings (store_id, started_at desc);
create index recordings_started_idx on commerce.recordings (started_at);
```

- **Files.**
  - Each segment: bucket `recordings`, path `{storeId}/{recordingId}/{seq}.gz`, with `seq` written as three digits (`000`…`199`).
  - After sealing (step 10), one file `{storeId}/{recordingId}/all.gz`, and the segments are removed.
  - The row says which files exist (`segments`, `sealed`), so deleting never needs `list()`.
- **Lists:**
  - RLS on; `COPY_RULES` `never`.
  - `PERSONAL_DATA`: an entry `recordings`, subject `pseudonymous`, no link to a person, personal columns `[]`, export section
    `null`, erasure `none` (it cannot be found from a person: GDPR Art. 11; deletion is by id, section 8.3), `until: "recordings"`.
    Copy the shape of the `visits` entry (`src/lib/personal-data.ts`), and add the Norwegian reason
    (`src/lib/personal-data.nb.ts`).
  - A `storage:recordings` entry the same way.
  - `PURPOSE_OF.recordings`: a new purpose `recordings` with basis "a" (consent) in `src/lib/personal-purposes.ts`. Follow the shape
    of the `analytics` purpose.
  - `STORE_EXPORT_LEFT_OUT` with reason `record`.
- **Retention.** Kind `recordings` in `RETENTION_KINDS`, with `RETENTION_SEED` 30 days and
  `enforcedBy: "pruneRecordings() (RECORDING_KEEP_DAYS)"`. A custom migration widens the `retention_rules_kind` check and inserts the
  seed row (pattern: `supabase/archive/20261111172838/20261105150943_sandbox_purge_rules.sql:252-258`). `src/db/privacy.test.ts`
  holds them equal.
- **Metering.**
  - `USAGE_METRICS.recordings = { kind: "counter", unit: "count", source: "database" }` (`src/lib/usage-metrics.ts`).
  - A line in `counters()` (`src/server/usage-meter.ts`) counting the day's new recordings per store.
  - `LIMITS.recordings_month = { metric: "recordings", period: "month", enforce: "hard", scope: "store" }`.
  - A `liveValue()` case using `measuredPlusLive` (`src/server/limits.ts`).
  - Words in `m.plans.limitNames` (en, nb, sv, da) and in the `capacity` admin catalogue (en, nb).
  - Plan values seeded by name in the same custom migration.
  - Recordings do **not** count toward `storage_bytes`. Leave `storage_bytes_by_store()` unchanged: the owner does not choose these
    bytes.

### 6.5 A/B goals (migration in step 12)

- Add `rage` and `dead` to the `experiment_events_goal` check: the list in `src/db/schema.ts` beside `experiment_events`, then
  `pnpm db:generate`. The precedent is migration `ab_form_goal`.
- An event of these goals has `ref = ''`, so a visitor counts once per test and goal (`experiment_events_once_key`).

### 6.6 Buckets (custom migrations in steps 6 and 8)

Copy the guarded insert of `supabase/migrations/20261111172842_baseline_4_roles_and_supabase.sql:44-62`: inside `DO $$ … IF EXISTS
(select 1 from pg_namespace where nspname = 'storage')`, then `insert into storage.buckets … on conflict do nothing`, so plain
Postgres and PGlite skip it.

| Bucket | public | file_size_limit | allowed_mime_types |
|---|---|---|---|
| `page-maps` | false | 8 MB | `{image/jpeg}` |
| `recordings` | false | 2 MB | `{application/gzip}` |

- Add both to `docs/security.md` §2.1 (the bucket list).
- Note in the decision that they must be folded into `baseline_4` at the next quarterly squash (`docs/ci-migrations.md`).

---

## 7. The browser side

### 7.1 Mounting

In the market layout (`src/app/s/[store]/[market]/layout.tsx`), beside `<StoreVisits>`, in a Suspense of its own (the 12.8 kB rule in
that file's comment):

```tsx
{store.heatmaps || store.recordings ? (
  <Suspense fallback={null}>
    <OffPayRoutes>
      <SiteSignals
        store={{ id: store.id, slug: store.slug, heatmaps: store.heatmaps, recordings: store.recordings,
                 share: store.recordingShare, mask: store.recordingMask }}
        breakpoints={{ md: …, lg: … }}
      />
    </OffPayRoutes>
  </Suspense>
) : null}
```

- **Breakpoints.** Take `md` and `lg` from the store's theme the same way `BreakpointSheet` gets them (`breakpointsOf()`,
  `src/lib/breakpoints.ts`). Fall back to `DEFAULT_BREAKPOINTS`.
- **No request-time reads.** The flags come from the cached `Store`. Never read `cookies()` or `headers()` in the layout.
- **The chooser layout** is not an allowed page, so it gets nothing. Neither does the private landing page.
- **Kaizena Flow's site** is the house store under this same layout (D484), so nothing more is needed.
- **`OffPayRoutes` unmounts its children** while the cart drawer is open (the pathname becomes `/cart`) and on pay routes.
  `SiteSignals` must therefore end its page view and stop the recorder **in its cleanup**, and pick up the same tab session when it
  mounts again (section 7.4).
- **The lazy wrapper** (`src/components/lazy/site-signals.tsx`) copies `src/components/lazy/touch-keeper.tsx`:
  `whenIdle(lazyView(dynamic(() => import("../signals/site-signals").then((m) => m.SiteSignals))))`.
- **Pay routes.** Add `components/signals/site-signals`, `components/signals/session-recorder`, `components/signals/heat-collector`
  and `components/signals/click-watch` to `FORBIDDEN_ON_PAY_ROUTES` (`src/lib/pay-routes.ts`). `pay-routes.graph.test.ts` then proves
  they are never reached statically from a pay route.

### 7.2 `SiteSignals` (`"use client"`, draws `null`)

1. **Opted out.** If `optedOut()` (`src/lib/visit-beacon.ts`: GPC or DNT), do nothing at all.
2. **Staff.** If `staffPath(store.slug) !== null` (`src/components/back-to-admin.tsx`), do nothing (owners and staff browsing their
   store).
3. **Consent.** Read the consent cookie with `decodeConsent()` (`src/lib/cookie-consent.ts`), as `src/components/ab/ab-assign.tsx`
   does, and listen for `CONSENT_CHANGED_EVENT`.
   - `heatOn = store.heatmaps && choices.statistics && versionHas(version, "heat")`
   - `recOn = store.recordings && choices.recordings`
4. **The page.** `signalPlace(window.location.pathname, store.slug)` from `src/lib/signal-paths.ts` (section 7.6) gives
   `{ heat: boolean, rec: boolean }`, or null. Use `usePathname()` only as the trigger that the page changed; always read the path
   from `window.location.pathname`, because the router's path can be the internal one behind a host rewrite.
5. **When a page view starts** (mount, or pathname change to an allowed page):
   - start the click watch (`click-watch.ts`), once per mount;
   - if `heatOn && place.heat`, start a heat page view (`heat-collector.ts`);
   - if `recOn && place.rec`, resume or start the recorder: `const rec = await import("./session-recorder")`, a dynamic import, so
     rrweb is never in the first scripts.
6. **When the pathname changes:**
   - end the heat page view, which sends its summary;
   - tell the recorder about the new page (a `kz-page` custom event and `takeFullSnapshot()`), or **stop** it if the new page is not
     allowed for recordings.
7. **When the tab is hidden** (`visibilitychange` to hidden): send the heat summary (later sends of the same page view are
   continuations, section 7.3) and flush the recorder's tail.
8. **Consent withdrawn:**
   - stop everything at once;
   - if `recordings` was withdrawn, call `forgetRecordings(storeId)` (section 8.3) **before** the consent manager reloads the page.
     `ConsentManager.decide()` dispatches `CONSENT_CHANGED_EVENT` before `location.reload()`, and `sendBeacon` survives the reload;
   - then remove `kaizen_rec_{storeId}` and `kaizen_rec_ids_{storeId}` from storage.
9. **Errors.** Catch and swallow every error. Measuring is never worth an error in a visitor's browser.

### 7.3 The heat collector

**The pure parts live in `src/lib/heat-collect.ts`** and take no DOM, so they can be unit tested in Node (the Vitest environment has
no jsdom):

```ts
export type ReachState = { maxBottom: number; maxHeight: number; fold: number | null };
export function reachStep(s: ReachState, m: { scrollY: number; innerHeight: number; scrollHeight: number }): ReachState;
export function reachBucket(s: ReachState, innerHeight: number): number; // 0..20

export type AttentionState = { bins: number[]; lastVisible: Set<number> | null };
export function attentionTick(s: AttentionState, m: { scrollY: number; innerHeight: number; active: boolean; visible: boolean }): AttentionState;
export function attentionBands(s: AttentionState, maxHeight: number): number[]; // 20 ints, each ≤ BAND_CAP_MS
```

**The summary sent** (`HeatBody`, built by `heatBody()` in `src/lib/page-heat.ts`; at most 8,000 bytes, otherwise clicks are dropped
from the end):

```ts
type HeatBody = {
  v: 1;
  store: string;                 // slug
  path: string;                  // location.pathname, never the query
  seq: number;                   // 0 = the page view's first summary; 1.. = continuations
  device: "mobile" | "tablet" | "desktop";
  reach?: number;                // 0..20 bucket: seq 0 only
  fold?: number;                 // 0..1000 per mille: seq 0 only
  att: number[];                 // 20 ints, ms added since the last summary of this view
  clicks: [anchor: string, cx: number, cy: number, dead: 0 | 1, rage: 0 | 1][]; // new since the last summary, at most 60
  dv: 0 | 1;                     // this view had its first dead click since the last summary
  rv: 0 | 1;                     // the same for rage
  ab: [experiment: string, version: string][]; // from shownVersions(), at most 5
};
```

**How it runs:**

- **Sending.** `navigator.sendBeacon("/api/signals/heat", new Blob([JSON.stringify(body)], { type: "text/plain" }))`. A same-origin
  beacon carries the cookies, which the server needs for consent and A/B tags.
- **When.** When the page view ends, and on each `visibilitychange` to hidden. A view whose visible time is below `MIN_VIEW_MS` is
  never sent.
- **Continuations.** After a tab comes back, only new attention, new clicks and new `dv`/`rv` flags are sent, with `seq + 1`. `views`
  and `reach` count only at `seq = 0`. Reach gained after the first summary is lost. That is accepted and documented in the
  decision.
- **Clicks** come from the click watch's verdicts (section 7.5). A click still waiting when the view ends is sent as not dead.

### 7.4 The recorder (`src/components/signals/session-recorder.ts`)

**Tab session.** Kept in `sessionStorage` under `kaizen_rec_{storeId}`, as JSON
`{ v: 1, id, seq, sampled, started, lastInput, pages }`:

- A new session (a new `crypto.randomUUID()`, sampling decided once) starts when there is none, when `lastInput` is older than
  `REC_IDLE_MS`, or when `started` is older than `REC_MAX_MS`.
- `sampled: false` means nothing is ever recorded in this tab session.
- A server answer of 410 sets `sampled: false` too.

**rrweb.**

- Dependencies: `@rrweb/record`, `@rrweb/replay` and `@rrweb/types`, **pinned exactly** to the same version (`pnpm add -E`).
- Use `2.2.0` (released 24 Oct 2026) unless a newer 2.2.x has been out for two weeks. `2.2.2` came out on 9 Nov 2026.
- Record with `recorderOptions(mask, isTouch)` from `src/lib/recording.ts` (pure, unit tested):

```ts
{
  maskAllInputs: true,
  maskInputOptions: { password: true },
  maskTextSelector: mask === "strict" ? "*" : "[data-kz-mask]",
  blockSelector: "[data-kz-private]",
  slimDOMOptions: "all",
  inlineStylesheet: true,
  inlineImages: false,
  collectFonts: false,
  recordCanvas: false,
  recordCrossOriginIframes: false,
  sampling: { mousemove: isTouch ? 150 : 50, scroll: 150, media: 800, input: "last" },
  errorHandler: () => true, // swallow; count in a module variable
}
```

**Start once.** Guard `record()` with a module-level flag, so React's double effects cannot start two recorders. Keep the `stop`
function rrweb returns.

**Custom events** (`record.addCustomEvent`):

- `kz-page` `{ path, at }` on each page;
- `kz-click` `{ dead, rage, x, y }` for the timeline;
- `kz-ab` `{ tags }` when `shownVersions()` changes.

**Segments:**

- Events are buffered in memory.
- The first upload happens once the session is `REC_MIN_MS` old **and** has had one interaction. After that, every 30 s.
- Each segment is `JSON.stringify({ v: 1, meta, events })`, gzipped by `new Blob([json]).stream().pipeThrough(new
  CompressionStream("gzip"))`, then POSTed:

  ```
  fetch(`/api/signals/rec?store={slug}&id={id}&seq={seq}&z=1`,
        { method: "POST", body: gzipBlob, headers: { "Content-Type": "application/gzip" } })
  ```
- `meta` is `{ device, w, h, startedAt, pages: [{ at, path }] (new since the last segment), clicks, dead, rage, ab }`.
- How each answer is handled:

  | Answer | What the recorder does |
  |---|---|
  | 204 | Continue |
  | 410 | Stop for this tab session (`sampled: false`) |
  | 429 or 503 | Drop this segment and continue |
  | 400 | Stop (our bug; log nothing to the visitor) |

**The tail.** When the tab is hidden, and in the component's cleanup:

- if the raw JSON is at most 60,000 bytes, `sendBeacon` it with `&z=0` as `text/plain`;
- otherwise drop it and count it. The 64 KiB keepalive budget is shared by every beacon of the page.

**Caps.** Stop and flush at `REC_MAX_SEGMENTS`, at `REC_MAX_BYTES` uploaded, at `REC_MAX_PAGES`, or when more than 20,000 events
wait in the buffer (a runaway page).

**Ids for deleting.**

- After the first 204 of a recording, add `{ id, until: started + 31 days }` to `localStorage` `kaizen_rec_ids_{storeId}` (at most 50
  entries; expired ones dropped on each write).
- This is the only way a visitor can later delete their recordings.
- It is a storage item, so it is registered in step 1.

### 7.5 The click watch

**The pure part** is `src/lib/click-signals.ts`: a judge with an injected clock, which knows nothing about the DOM.

```ts
export type ClickInput = { at: number; x: number; y: number; targetId: number; candidate: boolean; rageable: boolean; anchor: string; cx: number; cy: number };
export type Verdict = { anchor: string; cx: number; cy: number; dead: boolean; rage: boolean; rageAndDead: boolean; at: number };
export class ClickJudge {
  click(c: ClickInput): void;
  mutation(at: number): void;       // a counted mutation (the DOM layer filters)
  scroll(at: number): void;
  selection(at: number): void;
  focus(at: number): void;
  leave(at: number): void;          // visibilitychange, blur, pagehide
  urlChange(at: number): void;
  tick(now: number): Verdict[];     // verdicts that are due
  flush(now: number): Verdict[];    // end of view: everything pending, none dead
}
```

**The DOM part** is `src/components/signals/click-watch.ts`:

- It adds capture-phase, passive listeners for `click`, `scroll` (on `document`, capture, so element scrolls count too),
  `selectionchange`, `focusin`, `visibilitychange`, `blur` and `pagehide`.
- It turns each event into the judge's input. `targetId` is a number kept in a `WeakMap` per element.
- The anchor and cell come from `anchorOf()` in `src/lib/heat-anchor.ts`. That function takes a plain chain of
  `{ firstClass, tag, isProductCard, cardIndex }`, so it is testable. The DOM layer builds the chain from the target upward and takes
  the anchor element's `getBoundingClientRect()`.
- It arms **one** `MutationObserver` on `document.documentElement` (`subtree, childList, attributes, characterData`) only while a click
  is pending. It filters records by the counted-mutation rule (section 3) and disconnects when nothing is pending.
- It calls `tick()` every 250 ms while something is pending.
- Clicks inside `[data-kz-private]` are ignored entirely: no verdict, no cell.

### 7.6 Allowed pages in the browser (`src/lib/signal-paths.ts`)

- **Why a copy.** `placeOfPath()` cannot be imported into the browser: `visit-record.ts` imports zod and page-content, which
  `storefront-bundle.scan.test.ts` forbids. So this file is a zod-free twin that only answers "may this path be collected?".
- **The server stays the authority.** It re-checks with `placeOfPath()` and `speedKind()`.
- **Signature:** `signalPlace(pathname: string, storeSlug: string): { heat: boolean; rec: boolean } | null`.
  - Drop `/s/{slug}` in front when present.
  - Then refuse any path whose segments include one of the private or working routes. Copy the list from `PRIVATE_ROUTES`,
    `RESERVED_STORE_PAGE_SLUGS` and `PLAIN_PAGES` as `visit-record.ts` uses them.
  - The search page is `heat: true, rec: false`.
- **A test keeps the copy honest.** `src/lib/signal-paths.test.ts` imports the real lists from `visit-record.ts` and
  `page-content.ts` (allowed in a test) and fails when the twin's copy differs.

### 7.7 DOM marks to add to storefront components (step 4)

| Mark | Add it to | Why |
|---|---|---|
| `data-kz-private` | The chat panel and launcher roots (`src/components/chat-widget.tsx`, `[data-chat-panel]`, `[data-chat-launcher]`)<br>The cart drawer's `dialog` (`cart-drawer.tsx`)<br>`site-form.tsx`, `back-in-stock.tsx`, `quote-request.tsx`, `product-question.tsx`, `gift-card-buy.tsx`, `custom-fields-view.tsx`, `appointment-picker.tsx`, `blog-comment-form.tsx`<br>Newsletter forms, `discount-code-form.tsx`, `gift-card-form.tsx`, `vat-number-field.tsx`, `affiliate-field.tsx`, `delivery-choice.tsx`<br>The consent banner and choices (`consent-manager.tsx`) | Personal data, or what a visitor types |
| `data-kz-mask` | Review author names and review texts<br>Blog comment authors and texts<br>The search page's echo of the query ("Results for …") | Text written by people, or echoed from them |
| `data-kz-ambient` | `countdown-view`, `stats-view` (animated numbers), `brands-carousel` (marquee), `carousel` when it autoplays, `video-view`, `animation-view` | They change the DOM by themselves, which would make every click look alive |
| `data-kz-no-rage` | Quantity steppers, carousel arrows, the product gallery's arrows, size and colour pickers (`Dropdown` options) | People press them quickly on purpose |

Find each component by `grep -rn "<name>" src/components` before adding the mark. Add a unit test
(`src/components/signals/marks.test.ts`) that renders a few of them with `renderToString` and checks the attribute is there.

---

## 8. The server side

### 8.1 `/api/signals/heat` → `recordHeat()` (`src/server/page-heat.ts`)

The route copies `src/app/api/visit/speed/route.ts` exactly, but with `MAX_BYTES = 8000`: `connection()`, `sameSite()` or 403, the
declared and real byte caps or 413, `JSON.parse` or 400, then `recordHeat({ headers, body })` inside a try with
`log("warn", "heat.record_failed", {}, error)`. It always answers an empty 204 with `no-store`.

`recordHeat()` runs these steps in this order (the order of `recordSpeed()`):

1. `heatInput` (zod, in the server module, never in the browser) `safeParse`, otherwise `invalid`. Check that the arrays have their
   lengths, the numbers their ranges, anchors match `^(@body|@header|@footer|@main|@card:\d{1,2}|<PART_ID>)$`, and there are at most
   60 clicks and at most 5 `ab` pairs.
2. `isBot(user-agent)` gives `bot`; `wantsPrivacy(h)` gives `privacy`.
3. `getOpenStore(slug)` gives `unknown_store`. `!store.heatmaps` gives `off`. `await lockedOut(store)` gives `locked`.
4. `fromStoresOwnPage(…)`, exactly as in `recordSpeed()`, gives `wrong_site`.
5. Consent: decode the consent cookie from the request's `Cookie` header (`decodeConsent`). It needs `choices.statistics` and
   `versionHas(version, "heat")`, otherwise `no_consent`.
6. `placeOfPath(path, …)`, then `speedKind(landing)`. Null gives `not_measured`.
7. `takeBudget(store.id, "heat", budgetVisitor(h))`, plus a daily slot (bucket `heat`, `HEAT_BEACONS_PER_STORE_DAY = 50_000`, the
   shape of `takeSpeedSlot()`), otherwise `store_full`.
8. `verifiedTags(store.id, body.ab, h)` from `src/server/signal-tags.ts` (section 8.4).
9. One upsert of `page_heat_days` for the rows `['', ...tags]`. One upsert of `click_cells`, summing equal cells first in code, for
   the same tags.
10. If `dv` or `rv` and there are tags, insert `experiment_events` goals `dead`/`rage` from the visitor's exposure (step 12; until
    then, skip it).

### 8.2 `/api/signals/rec` → `recordSegment()` (`src/server/recordings.ts`)

**The route.**

- `MAX_BYTES = 1_048_576`, `export const maxDuration = 30`.
- The query is parsed with zod: `store`, `id` (a uuid), `seq` (an integer 0..199), `z` (0 or 1).
- The body is read as bytes (`arrayBuffer()`).

**Answers.**

| Answer | Meaning |
|---|---|
| 204 | Kept |
| 410 | Stop recording this tab |
| 400 | Invalid |
| 413 | Too big |
| 429 | Over the budget |
| 503 | Our failure, so the client drops the segment |

Every answer is empty and `no-store`.

**Steps:**

1. `sameSite()`, otherwise 403. `isBot` or `wantsPrivacy`, otherwise 410.
2. Store checks: `getOpenStore`, then `store.recordings`, then `lockedOut`, then `fromStoresOwnPage`. Any failure gives 410.
3. Consent: the cookie's `choices.recordings === true`, otherwise 410.
4. `takeBudget(store.id, "rec", …)`. This bucket is listed in `FAIL_CLOSED`. Over budget gives 429.
5. Decompress. If `z=1`: `gunzipSync(bytes, { maxOutputLength: 16 * 1024 * 1024 })` from `node:zlib`; on error, 400. If `z=0`, the
   body is the JSON, and it is gzipped server-side before storing.
6. Parse and check with zod `segmentBody`:
   - `v: 1`;
   - `meta` as in section 7.4;
   - `events`: 1 to 50,000 items, each `{ type: int 0..6, timestamp: number, data?: unknown }`;
   - timestamps within `[startedAt − 60 s, now + 60 s]`.

   Failure gives 400.
7. Pages: each `meta.pages[].path` goes through `placeOfPath`, then `speedKind`, and must not be the search page. Otherwise 410: the
   recorder should have stopped, so nothing is kept.
8. If `seq = 0`:
   - `checkLimit(store.id, "recordings_month", 1)`, memoised per store for 60 s in the module, like `aiMemo` in `src/server/limits.ts`;
   - plus a daily slot (bucket `recordings`, `RECORDINGS_PER_STORE_DAY = 2_000`).

   Over either gives 410. Then `insert … on conflict (id) do nothing`. A conflicting id that belongs to another store gives 410.
9. If `seq > 0`: the row must exist for this store, `sealed = false`, `segments < REC_MAX_SEGMENTS`, and `bytes + size ≤
   REC_MAX_BYTES`. Otherwise 410.
10. `verifiedTags(...)`.
11. Upload to `recordings/{storeId}/{id}/{seq3}.gz` with `upsert: false` and `cacheControl: "0"`. An "already exists" error means a
    duplicate, so answer 204 and do not count it twice.
12. Update the row. The `where` clause names `store_id` (the ratchet).
    - Set `last_at` and `duration_ms`.
    - Append the new page keys to `pages`, without repeating the last one, up to 50.
    - Add to `clicks`, `dead_clicks` and `rage_clicks`; increment `segments`; add to `bytes`.
    - `tags` becomes the union of the old and new tags.

### 8.3 `/api/signals/forget` → `forgetRecordings()`

- The body is `text/plain` JSON `{ store, ids: uuid[] (≤ 50) }`, at most 4,000 bytes. The route checks `sameSite()` and
  `takeBudget(…, "forget", …)`.
- **No consent check:** withdrawal must work after withdrawal.
- It deletes the rows `where store_id = $1 and id = any($2)`, collects their file paths, and removes the files with
  `recordingFiles().remove(paths)`.
- It always answers 204.
- The browser side is `forgetRecordings(storeId)` in `src/components/signals/forget.ts`. It reads `kaizen_rec_ids_{storeId}`, sends
  the beacon, then clears both storage keys. It is used on withdrawal (section 7.2) and by the *Delete my recordings* button on the
  Cookies page (step 9).

### 8.4 A/B tags (`src/server/signal-tags.ts`)

```ts
export async function verifiedTags(storeId: string, claimed: readonly [string, string][], cookieHeader: string | null): Promise<string[]>
```

- Read `kaizen_ab_{storeId}` from the cookie header with `decodeAssignments()` (`src/lib/experiments.ts`).
- Keep a claimed pair only if all of these hold:
  - the cookie's version for that test equals the claimed version;
  - the version is not `0` (outside the test);
  - the test is in `runningExperiments(storeId)` (`src/server/experiments.ts`, kept in memory for 20 s).
- Return `"{experimentId}:{version}"` strings.
- **Never** store the A/B visitor id with a recording: it leads to `experiment_carts`, then to orders, then to the customer.
- If `beacon-imports.scan.test.ts` refuses the import of `src/server/experiments.ts`, move `runningExperiments()` into a light
  module (`src/server/running-experiments.ts`) and import it from both places.

### 8.5 Reads for the admin

**`src/server/page-heat-read.ts`** (each read filters with `owned(storeId)`, is typed with `typedRows()` and `col`, and adds arrays in
code with helpers from `src/lib/heat-read.ts`):

- `heatPages(storeId, { from, to, device? })` returns, per page key: views, `dead_views`, `rage_views`, clicks, and average reach
  (from the histogram). Used by **Where visitors get stuck** and the list by views.
- `pageHeat(storeId, { page, device, tag, from, to })` returns the summed reach histogram, the fold average, the attention sums,
  views and frustration counts, plus the click cells summed over days, `group by anchor, cx, cy`. Click cells are limited to the last
  `CELL_KEEP_DAYS`.
- `versionBehaviour(storeId, experimentId)` returns, per version key, the sum over **every page** with that tag: views, the share
  reaching 50 %, attention seconds per view, and the dead and rage view shares. A test of the header spans every page, so do not
  filter by page.

**`src/lib/heat-read.ts`** (pure):

- `reachedShares(hist)` gives 21 shares;
- `foldPercent(foldSum, views)`;
- `attentionSeconds(bands, views)`;
- `frustrationRank(rows, MIN_MAP_VIEWS)`;
- `projectCells(cells, layout)` gives the points `{ x, y, weight }` plus `missing` (the clicks whose anchor is not on the picture);
- `reachLines(shares)` gives the deepest band reached by 75 %, 50 % and 25 % of page views.

**`src/server/recordings-read.ts`:**

- `listRecordings(storeId, filters, page)` returns 50 at a time, newest first or "most frustrated first"
  (`order by rage_clicks + dead_clicks desc, started_at desc`). Filters: device, page key (`= any(pages)`), has rage, has dead, tag
  (`tags @> array[$tag]`), and the period.
- `recordingEvents(store, id)` downloads `all.gz` or the segments in order, gunzips them (each with `maxOutputLength`), and
  concatenates the `events` arrays. It then returns `sanitizeEvents(events, allowedOrigins(store))`.

### 8.6 Sanitising recorded events (`src/lib/replay-sanitize.ts`, pure)

Recorded events are whatever someone posted to an open endpoint. rrweb's player keeps scripts off only because of its iframe
sandbox: it rebuilds `onerror` and other `on*` attributes as they were. So the server sanitises the events as well, before the
player gets them.

```ts
export function sanitizeEvents(events: unknown[], allowed: ReadonlySet<string> /* origins */): unknown[]
```

It works as a deep walk over every object in the events (full snapshots, mutations, style rules, everything):

1. **An object with an `attributes` key** whose value is a plain object:
   - delete every key matching `/^on/i`, and `srcdoc`;
   - for the URL keys `src`, `href`, `srcset`, `poster`, `action`, `formaction`, `xlink:href`, `background` and `data`: keep the
     value only if every URL in it (split `srcset` on commas) is `http(s)` with an origin in `allowed`, or `data:image/…`, or starts
     with `#`. Otherwise set it to `""`. A `javascript:` URL is always `""`;
   - if `http-equiv` is present, delete `http-equiv` and `content`.
2. **Every string** (including `_cssText`, style rules and text nodes of `<style>`): replace `url(...)` with `url()` and remove
   `@import` when the URL's origin is not in `allowed`.

The allowed origins are:

- every origin of the store (`storeOrigins(slug)`, `src/server/stores.ts` or wherever `recordSpeed()` imports it from);
- the platform's (`siteUrl()`);
- Supabase's (`publicEnv().NEXT_PUBLIC_SUPABASE_URL`).

The unit tests feed it events with `<img src="https://evil.example/x" onerror=…>`, `meta http-equiv=refresh`,
`style="background:url(https://evil.example)"`, and allowed URLs that must survive.

### 8.7 Jobs

**Daily prunes.** In `src/app/api/cron/subscription-reminders/route.ts`, add these to `dailyPrunes` with
`tracked("daily.<name>", 86400, …)`, and add the names to `src/server/cron-prunes.scan.test.ts`:

- `daily.heat`: `pruneHeat()`, which deletes `page_heat_days` older than `HEAT_KEEP_DAYS` and `click_cells` older than
  `CELL_KEEP_DAYS`. Use set-based deletes with `with d as (delete … returning 1) select count(*)`.
- `daily.recordings`: `pruneRecordings({ deadline })`, which picks expired rows (`started_at < now() − 30 days`) in batches of 200,
  removes their files (`remove()` takes at most 1000 paths per call), then deletes the rows, stopping at the deadline.
- `daily.map-shots`: `pruneMapShots()`, which deletes rows and files older than `SHOT_KEEP_DAYS`.

**Sealing (step 10).** A job in the five-minute dispatcher (`src/app/api/cron/cart-reminders/route.ts`, `runJobs`): `sealRecordings({
deadline: 60 s })`.

- It picks recordings with `sealed = false and segments > 1 and last_at < now() − interval '35 minutes'`, at most 50.
- For each one, oldest first: download the segments, gunzip, concatenate the events, gzip, upload `all.gz`, set `sealed = true`
  (naming `store_id`), then remove the segments.
- An idle run is one select, whatever the number of stores.
- Raise `DISPATCHER_JOBS` from 75 to 76 (`src/server/cron-prunes.scan.test.ts`).
- Why: every Storage object is a row in our own Postgres (about 2.8 KB each, measured 16 Nov 2026), so one file per recording
  instead of ten matters.

**Pictures (step 6).** `runMapShots(deadline, deps)` runs inside the page-looks route's `after()`, **after** `runPageLooks()`. Looks
are for a person waiting, so they go first.

**Store closure.** Find where closing a store removes its files (`docs/store-closure.md`, D171) and remove the store's folders in
`recordings` and `page-maps` there too. The rows go by cascade.

---

## 9. Pictures under heatmaps (map shots)

### 9.1 Asking for a picture

`requestMapShot(storeId, page, device, tag)` upserts a `waiting` row when:

- there is none;
- the one there was taken more than 14 days ago;
- the owner pressed *Take a new picture*;
- or it `failed` more than an hour ago.

The heatmap page calls it when it opens. It shows "Taking a picture of this page… it takes a minute or two" and refreshes itself
every 20 s while the row is `waiting` (a small client component calling `router.refresh()`).

### 9.2 Taking it (`runMapShots()`, `src/server/map-shots.ts`)

**Order and budget.** Take the oldest waiting rows first, at most 6 per run. Use one Chromium for the run (`launchBrowser()`,
`src/server/browser.ts`) and stop before the deadline.

**The address:**

- Build the store page's URL the way store looks do (`src/server/page-looks.ts`, the `marketUrl(…)` calls near line 259).
- For a tag, the address is the version's own route, the same one the proxy rewrites to. Use `variantPath()`
  (`src/lib/ab-routing.ts:78`) with a made-up `kaizen_ab_{storeId}` value holding only that test and version
  (`encodeAssignments()`, `src/lib/experiments.ts`).
- A version's route is served only while its test runs, so a tag whose test has stopped keeps its last picture and is never shot
  again.

**The browser context:**

- Viewport 390×844 (mobile, `isMobile: true, hasTouch: true`), 820×1180 (tablet) or 1440×900 (desktop), from `TYPICAL_SCREENS` in
  `src/lib/breakpoints.ts`.
- `reducedMotion: "reduce"`.
- Before opening the page, add the cookie `consent_{storeId}` = `encodeConsent({ visitor: "00000000-0000-4000-8000-000000000000",
  version: <the site's current version from siteCookies()>, choices: NO_CONSENT })`. The banner then stays closed and no tool loads.
- Headless Chromium is a robot to `isBot()`, so no visit or heat is counted.
- Add CSS `[data-chat-launcher], [data-kz-private] { visibility: hidden !important }`.

**Settle and measure:**

- Use `settle()` from `src/lib/page-look-shoot.ts` (it makes lazy pictures eager, scrolls through the page, and waits for fonts and
  pictures).
- Then evaluate `measureAnchors()`, a function in the new `src/lib/map-measure.ts` that runs in the page. For every element whose
  first class matches the part rule, every `li.product-card` (as `@card:{n}`), and `header`, `footer`, `main` and `body`, it keeps
  the first match's box in page coordinates: `rect` plus `scrollX`/`scrollY`, and `[x, y, w, h]` rounded to whole pixels.
- It skips boxes of zero size, and keeps at most 3,000 anchors.
- It returns `MapLayout = { v: 1, w, h, fold, anchors: Record<string, [number, number, number, number]> }`.

**The picture:**

- `page.screenshot({ type: "jpeg", quality: 70, fullPage: true, clip })`, with height clipped to `MAP_LENGTH_MAX = 10000` px.
- Upload it to `page-maps/{storeId}/{id}.jpg` with `upsert: true` and `cacheControl: "0"`.
- Set `status = 'done'`, `shot_at`, `width`, `height` and `layout`.
- On any error, set `status = 'failed'` and a `problem` of at most 200 characters (never a stack), and log it with `log()`.

**Showing it.** The admin page gets a signed URL (`createSignedUrl(path, 600)`) on the server and passes it to the view.

### 9.3 Drawing (`src/components/admin/analytics/page-map.tsx`, client)

**The overlay.**

- An `<img>` at the picture's width, scaled to fit the column.
- Over it, `<canvas>` strips at most 4,096 px tall each (the iOS canvas limit).

**What the canvas draws, per view:**

- **Clicks:**
  - points from `projectCells()`, kernel radius 24 px at the picture's scale;
  - intensity normalised to the 99th percentile of the points' weights;
  - colours from the `--chart-seq-0…6` roles, read with `getComputedStyle`;
  - a chip filter: All, Dead or Rage.
- **How far people scroll:**
  - 20 horizontal bands coloured by `reachedShares`;
  - dashed lines labelled "75 % got here", "50 %" and "25 %" (`reachLines`), and "Average fold".
- **Where people look:** 20 bands coloured by attention seconds against the busiest band, with labels such as "4.2 s".

**Behind it** (the analytics rule: every chart has a table, `docs/rules/admin/marketing.md`):

- **Clicks:** "Parts clicked most" (label, clicks, dead, rage, share).
- **Scroll:** "Reached 25 / 50 / 75 / 100 %" and the average fold.
- **Attention:** the five bands with the most time.

**Labels for anchors** come from `describePart()` (`src/lib/experiment-parts.ts`). Look the part up with `findPart()` in the page's
own published content, the store's header and footer, or the product layout. Find the loaders the storefront uses in
`src/server/pages.ts`, `src/server/site-layouts.ts` and `src/server/product-layouts.ts`. Landmarks get fixed words (Header, Footer,
"Product card 3", "Elsewhere on the page"). A part not found is "A part of the page".

---

## 10. Limits and plans

| Limit or ceiling | Value | Where |
|---|---|---|
| `recordings_month` (hard; over it, the store stops recording silently) | **Proposal (owner):** Basic 1,000 · Grow 5,000 · Advanced 20,000 · Plus 50,000. The platform default is unset; the house store, templates and starters are exempt (`src/server/limits.ts`). | `plan_limits` rows, migration in step 8 |
| New recordings per store and day (abuse backstop) | `RECORDINGS_PER_STORE_DAY = 2_000` | `chat_usage` bucket `recordings` |
| Heat beacons per store and day | `HEAT_BEACONS_PER_STORE_DAY = 50_000` | `chat_usage` bucket `heat` |
| Request budgets | `heat: { window: "minute", visitor: 30, store: 3000 }`<br>`rec: { window: "minute", visitor: 20, store: 2000 }` (in `FAIL_CLOSED`)<br>`forget: { window: "minute", visitor: 10, store: 600 }` | `BUDGETS`, `src/server/request-budget.ts` |
| Per recording | 200 segments, 4 MB gzip, 60 min, 50 pages | `src/lib/recording.ts` |

What it costs, at 100,000 recordings a month, about 400 KB each:

- **Vercel:** about 1 million segment invocations, roughly $6.
- **Supabase Storage:** about 40 GB a month, inside Pro's 100 GB at 30 days' retention.
- **Postgres:** with sealing, one Storage object row (about 2.8 KB) plus one `recordings` row (about 0.5 KB) per recording. That is
  about 330 MB at 100,000 recordings kept for 30 days. The database was 179 MB on 16 Nov 2026, so the plan values above are the
  real brake. Add the figure to `docs/capacity.md`.
- **Heat totals** are about 250 bytes a row. A store with 200 pages viewed every day on three devices adds about 60 MB a year.

One plan-comparison row, "Recordings and heatmaps", in no plan: a custom migration in step 8, with a test copied from
`src/db/redirects-plan-features.test.ts`.

---

## 11. Platform parity

- **kaizenaflow.com** is the house store `kaizenaflow` (D484), so heatmaps and recordings work there with no extra code. Its pages are
  under `/admin/kaizenaflow/analytics/…`, reached by the platform team through the house role (`HOUSE_ROLE_TEMPLATE`).
- **Platform routes outside the house store** are not in v1: sign-up, the theme store, docs, status and the admin.
  - Sign-up holds personal data in forms.
  - The admin is staff monitoring (Datatilsynet's DPIA list, item 5) and is never recorded.
  - The theme store and docs are of low value now.
  - **Next step (named in the decision):** heatmaps for the theme store and docs. They would need `store_id` to be nullable in
    `page_heat_days`, `click_cells` and `page_map_shots`, plus a mount in `PlatformRoot` (`src/components/platform-root.tsx`).
- **Platform admins see counts only.** Recordings per store and month appear through the usage metric on Usage and limits. They never
  open a store's recordings: the pages are owner-only, and the DPA says so for support conversations (`en.ts:300`). The DPA gets the
  same sentence for recordings (step 13, owner).
- **Add a row** to `docs/platform-parity.md` "Built for both": *Heatmaps and recordings | the house store (D484); platform routes are
  the next step*.

---

## 12. Open questions

### For the owner (needed before the step named)

| # | Question | Before |
|---|---|---|
| O1 | Plan values for `recordings_month` (proposal in section 10) | Step 8 |
| O2 | Default sampling share: 50 % proposed (10, 25, 50, 100 offered) | Step 11 |
| O3 | The points for the DPA, the sub-processor note and Kaizena Flow's privacy notice (section 4, item 9). Written by the owner. | Step 9 goes live |
| O4 | Who may watch recordings: owner only (proposed), or also a role? A role means a new permission key and a migration. | Step 11 |

### For a lawyer (none blocks building; all block switching recordings on for real stores)

| # | Question |
|---|---|
| Q1 | Is the existing cookieless visit beacon (it reads the path and referrer and sends UTM tags) compatible with ekomloven § 3-15 as the EDPB reads Art. 5(3)? This was raised by this research, not by this feature. |
| Q2 | May aggregate heatmaps share the Statistics choice with GA4 and A/B tests, or do they need their own choice? |
| Q3 | Is a DPIA needed for every store that switches recordings on, or only for large or sensitive stores? Can our template stand in? |
| Q4 | Is deleting what the browser can name, plus Art. 11, enough for erasure and withdrawal with random ids? |
| Q5 | Is a 365-day consent lifetime right for recordings? (Clarity treats consent as valid for 9 months.) |
| Q6 | Are the owner's confirmations (no children, no sensitive goods) enough, or is a check needed? |
| Q7 | Does showing the store's own text and catalogue pictures unmasked need to be documented as an "alternative measure" to the CNIL's M0? |

---

# Part B: the build

## 13. Steps

Every step also follows the general rules in section 14. "Docs" lists the files the step must update in the same push.

### Step 1: Consent groundwork and store switches (no visible feature yet)

**Goal.** Visitors can be asked about recordings, Statistics can carry heatmaps, and the switches exist. Nothing collects anything
yet.

**Files:**

- `src/lib/cookie-consent.ts`:
  - Add `"recordings"` to `CONSENT_CATEGORIES` and `OPTIONAL_CATEGORIES`, after `marketing`. `NO_CONSENT` gets `recordings: false`
    and `FULL_CONSENT` gets `recordings: true`.
  - `encodeConsent()` writes a **fourth bit only when the version names `recordings`**. That keeps today's cookies byte-for-byte
    unchanged for stores without recordings.
  - `decodeConsent()` accepts `[01]{3,4}`. Three bits mean `recordings: false`.
  - Add `CONSENT_EXTRAS = ["heat"] as const` and change the signature to
    `consentVersion(categories, extras: readonly ConsentExtra[] = [])`. The result is the categories joined with `+`, then the extras
    (`statistics+marketing+heat`).
  - Add `versionHas(version, token)`, which splits on `+`.
  - Keep the regex `[a-z+]{1,60}`. Check the longest version fits: `preferences+statistics+marketing+recordings+heat` is 48
    characters.
- **Every user of the categories.** Go through each and decide:
  - `src/components/consent/consent-manager.tsx`: it draws the fourth toggle from `categories`. When `recordings` is among them, it
    shows the first-layer notice (section 4.1) above the buttons. Refusing stays one press.
  - `src/server/site-cookies.ts`: see the next item.
  - `src/server/cookie-scans.ts`: it builds the scan's consent cookie with the same `consentVersion(categories, extras)`.
  - `src/server/consents.ts`: `recordConsent()` stores the `recordings` key in `choices`. Check the version regex
    `^[a-z+]{0,60}$` still passes.
  - `src/lib/custom-code.ts`: **an owner's code may not choose `recordings`**. Keep its list to the three old categories (a
    `CODE_CATEGORIES` constant).
  - `src/lib/data-admin.ts`: read it and keep it working.
  - Run `grep -rn "OPTIONAL_CATEGORIES\|ConsentChoices\|FULL_CONSENT\|NO_CONSENT\|consentVersion(" src e2e` and fix every hit.
    `pnpm typecheck` finds the rest.
- `src/server/site-cookies.ts`:
  - The store facts it reads (`storeFeatures()` gives `facts`) also give `heatmaps` and `recordings`.
  - When `heatmaps` is on, add `statistics` to the categories and `heat` to the extras.
  - When `recordings` is on, `declaredCookies` gets `recordings: true`, which declares the two storage items below, category
    `recordings`. That brings the category in by itself.
  - Return `{ cookies, categories, extras }`, and pass `extras` on to wherever `consentVersion()` is built for the banner.
  - The setters refresh `cookiesTag(store.id)` (next item).
- `src/lib/known-cookies.ts` and `src/lib/cookie-patterns.ts`:
  - Two entries with a new flag `recordings?: boolean` on `KnownCookie`, filtered in `declaredCookies()`:
    - `kaizen_rec_…`: session storage, days `null`, category `recordings`, purpose "a random number for this tab that ties a
      recording of your visit together";
    - `kaizen_rec_ids_…`: local storage, 31 days, category `recordings`, purpose "the numbers of the recordings this browser made,
      so you can delete them".
  - Purposes in en, nb, sv and da.
  - Patterns `/^kaizen_rec_[0-9a-f-]{36}$/` and `/^kaizen_rec_ids_[0-9a-f-]{36}$/`.
- `src/db/schema.ts`: the store columns of section 6.1, then `pnpm db:generate`. Read them into `Store` in `src/server/stores.ts`.
- `src/server/analytics-settings.ts`: `setHeatmaps(member, on)` and `setRecordings(member, { on, share, mask, confirmed })`.
  - Both are owner only, called through `storeAction()`.
  - Both `audit("analytics.heatmaps" | "analytics.recordings", { enabled, share, mask })`, then
    `refreshTag(storeTag(slug))` and `refreshTag(cookiesTag(store.id))`. Copy `setVisitCounting()`.
  - `setRecordings` refuses `on: true` unless all three confirmations are ticked, and sets `recordings_confirmed_at`.
  - No admin screen yet (that is steps 5 and 11).
- **Shopper words** in `src/lib/messages/{en,nb,sv,da}.ts`, and the browser twins in `*-browser.ts` where the consent manager reads
  them:
  - `consentCategories.recordings`, `consentRecordingNotice` and `consentCategories.statistics.textHeat`;
  - `consentTexts()` in `src/components/consent/site-consent.tsx` picks `textHeat` while heatmaps are on.
- **The Cookies page** (`src/components/consent/cookie-policy.tsx`): `heatmaps` and `recordings` paragraphs, shown while each is on,
  passed from `CookiesSection` like `visitCounting`. The *Delete my recordings* button is added in step 9.
- **The privacy starter** (`src/lib/legal-starters.ts` and `legal-starters/{en,nb,sv,da}.ts`): items `privacy.purpose.heatmaps` and
  `privacy.purpose.recordings`, added while the facts are on. Add facts `heatmaps` and `sessionRecordings` in `src/lib/legal-facts.ts`
  and `src/server/legal-facts.ts`, plus the legal writer's facts (`src/lib/legal-writer.ts`). Flag every text "for legal review"
  in a comment, as the rule says (`docs/wave-7-storefront.md`).

**Tests:**

- `src/lib/cookie-consent.test.ts`: a three-bit cookie decodes with `recordings: false`; a four-bit cookie round-trips; a version
  without `recordings` encodes three bits; `consentVersion([...], ["heat"])`; `versionHas`.
- `src/server/site-cookies` unit or integration test: heatmaps on adds statistics and `heat`; recordings on adds the category and the
  two items; both off changes nothing (the version string is byte-identical to before).
- `e2e/cookies.spec.ts`: a store with recordings on shows the fourth choice and the first-layer notice. Refusing all sets a cookie
  whose fourth bit is 0.
- `src/db/commerce.test.ts`: the new store checks (share and mask).

**Docs:**

- the decision row (D652, step 1);
- `docs/rules/storefront.md` "Cookie consent": the fourth category, the `heat` token, the rule that owner code cannot choose
  recordings;
- `docs/analytics.md`: a "Heatmaps and recordings" section, short at first, pointing to this file.

**Done when:**

- `pnpm typecheck`, `lint`, `test` and `db:check` pass;
- the cookie scan's e2e passes;
- a store with both switches off sends exactly the same banner and cookie as before. Check by comparing the consent cookie on the
  demo store before and after.

### Step 2: Pure definitions and detectors

**Goal.** All the logic of section 3, in pure modules with tests. Nothing is wired yet. This step can be built in parallel with step 3.

**Files** (all pure, browser-safe, no zod, no `server-only`):

- `src/lib/page-heat.ts`:
  - the constants of section 3;
  - `deviceClass(width, bp)`;
  - `HeatBody`, `heatBody()` (builds the body and keeps it at most 8,000 bytes);
  - `HEAT_ENDPOINT = "/api/signals/heat"`, `REC_ENDPOINT`, `FORGET_ENDPOINT`;
  - `tagOf(experiment, version)`.
- `src/lib/click-signals.ts`: `ClickJudge` (section 7.5).
- `src/lib/heat-collect.ts`: `reachStep`, `reachBucket`, `attentionTick`, `attentionBands`.
- `src/lib/heat-anchor.ts`:
  - `PART_ID`;
  - `anchorOf(chain)`;
  - `cellOf(clientX, clientY, rect)`;
  - `isCandidateTarget(tag, attrs)` and `isRageable(tag, type)`.
- `src/lib/signal-paths.ts`: `signalPlace()` (section 7.6).
- `src/lib/ab-shown.ts`:
  - `showVersion(experiment, version): () => void`;
  - `shownVersions(): [string, string][]`;
  - the event name `AB_SHOWN_EVENT = "kaizen:ab-shown"`, dispatched on `window` when the set changes. Guard `typeof window` so it
    imports safely on the server.
- `src/lib/recording.ts`:
  - the recording constants;
  - `recorderOptions(mask, isTouch)`;
  - `RecordingSession` and its pure rules: `sessionFor(stored, now, share, random)`, which says whether a new session is needed and
    whether it is sampled.
- `src/lib/replay-sanitize.ts`: `sanitizeEvents()` (section 8.6). It is pure, but used only by the server.
- `src/lib/heat-read.ts`: the functions of section 8.5.

**Tests** (one `*.test.ts` per module). At least:

- **ClickJudge:**
  - a click followed by a mutation at 2000 ms is alive; at 2600 ms it is dead;
  - a scroll at 250 ms means alive; at 400 ms it does not count;
  - `flush()` never gives dead;
  - three clicks 900 ms apart within 20 px give one rage; 1100 ms apart give none;
  - a non-rageable target gives no rage;
  - a scroll in the middle breaks the run;
  - rage plus a dead click gives `rageAndDead`.
- **Attention:**
  - a band visible for two ticks gets 250 ms; for one tick, 0;
  - `active: false` adds nothing;
  - the band cap holds;
  - bins put into bands by their middle line.
- **Reach:** a page shorter than the window gives bucket 20; maxima are kept across steps.
- **`anchorOf`:**
  - part classes win;
  - `kz-page` is not a part;
  - every fixed id in `src/lib/site-layout.ts` and `src/lib/product-layout.ts` matches `PART_ID`: import their default layouts in the
    test and walk them.
- **`signalPlace`:**
  - `/no/cart`, `/no/account/orders`, `/no/unsubscribe/x` and `/s/demo/no/checkout` give null;
  - `/no/search` gives `{ heat: true, rec: false }`;
  - the twin's lists equal the real ones.
- **`sanitizeEvents`:** the cases in section 8.6.
- **`heatBody`:** it caps at 8,000 bytes by dropping clicks.
- **The definitions table:** `src/lib/page-heat.test.ts` reads this file's section 3 table (`docs/heatmaps-and-recordings.md`) and
  checks each constant named there has the value written, for the numeric ones.

**Also:** a unit test that the part class is the **first** class of `rowBox`, `columnBox` and `blockBox` (`src/components/page-parts.tsx`).
`anchorOf` depends on it.

**Done when:** all the tests pass and nothing outside these files changed.

### Step 3: Heat tables and the heat route

**Goal.** The server accepts heat summaries and adds them to daily totals.

**Files:**

- `src/db/schema.ts`: the tables of section 6.2 (Drizzle), then `pnpm db:generate`.
- A custom migration (`pnpm exec drizzle-kit generate --custom --name page_heat_functions`) holding the two array functions and the
  `enable row level security` lines, then `node scripts/prune-snapshots.mjs`.
- `src/server/page-heat.ts`:
  - `recordHeat()` (section 8.1), `pruneHeat()`;
  - `HeatOutcome` (`{ recorded: true } | { recorded: false; reason }`).
- `src/server/signal-tags.ts` (section 8.4).
- `src/app/api/signals/heat/route.ts` (section 8.1).
- `src/server/request-budget.ts`: `BUDGETS.heat`.
- `src/server/beacon-imports.scan.test.ts`: add the route to `BEACONS`.
- `docs/security.md` §2.11: a row for `/api/signals`:
  - "heat: totals per page and day, no person";
  - "rec: recordings of consenting visitors, owner-only";
  - "forget: deletes by id".

  `security-routes.scan.test.ts` requires the row.
- `src/lib/store-copy-rules.ts`, `src/lib/personal-data.ts` (`NOT_PERSONAL`), `src/lib/store-export-scope.ts`: the entries of section
  6.2.
- The daily route: `daily.heat`, plus its name in `cron-prunes.scan.test.ts`.

**Tests:**

- `src/db/commerce.test.ts`:
  - the checks (21 and 20 array lengths, the tag form, the cell range);
  - the add functions (`add_int_arrays('{1,2}', '{3,4}') = '{4,6}'`);
  - RLS on.
- `src/server/page-heat.int.test.ts`. Model it on the speed tests: find them with `grep -rln recordSpeed src/server/*.int.test.ts`.
  - recorded with consent and `heat`;
  - refused for no consent, consent without `heat`, GPC, a robot, switch off, wrong site, `/no/cart`, a private store, and over the
    daily slot;
  - `seq` 1 adds attention and clicks but not views or reach;
  - two beacons add up;
  - a tag the cookie does not hold is dropped, and a held one writes both rows.
- `src/server/page-heat-prune.int.test.ts`: old rows go, recent ones stay.

**Done when:** the tests pass, the migration applies in CI (the release job), and the security and performance advisors show nothing
new (CLAUDE.md, Database). Record the migration versions in the decision.

### Step 4: The collector in the storefront (heatmaps only)

**Goal.** Consenting visitors on stores with heatmaps on send summaries. No store has the switch on yet, so production is unchanged.

**Files:**

- `src/components/signals/click-watch.ts`, `heat-collector.ts` and `site-signals.tsx` (sections 7.2, 7.3 and 7.5). The recorder part
  of `SiteSignals` is behind `recOn` and does nothing until step 9: leave a `// step 9` branch that returns.
- `src/components/lazy/site-signals.tsx`.
- `src/app/s/[store]/[market]/layout.tsx`: the mount of section 7.1.
- `src/components/ab/ab-marker.tsx`:
  - call `showVersion(experiment, mine)` exactly where it posts the exposure (the branch where the cookie matches the page);
  - call the returned function in the effect's cleanup.
  - Do not change anything else in the marker.
- The DOM marks of section 7.7, plus `src/components/signals/marks.test.ts`.
- `src/lib/pay-routes.ts`: the four modules in `FORBIDDEN_ON_PAY_ROUTES`.

**Tests:**

- `e2e/heatmaps.spec.ts`. Set up the demo store with `heatmaps = true` through SQL in the test's setup, the way
  `e2e/ab-tests.spec.ts` prepares a running test. Then check:
  - with no consent, **no request** to `/api/signals/` (listen with `page.on("request")`);
  - with GPC (`extraHTTPHeaders: { "Sec-GPC": "1" }` plus `navigator.globalPrivacyControl` through `addInitScript`), none;
  - after accepting Statistics, leaving the page sends one heat beacon whose JSON has `reach`, `att` and `clicks`;
  - on `/cart`, `/checkout` and `/account`, none;
  - a click on a non-interactive picture is reported dead;
  - a click on the menu button is not.
- `e2e/performance.spec.ts` still passes unchanged: the collector must not be a `script[src]` in the HTML.
- Unit tests of the DOM-free parts already exist from step 2.

**Done when:** the e2e passes in CI and the first-script budgets are unchanged.

### Step 5: The heatmaps switch for the owner

**Files:**

- `src/app/admin/(gated)/[store]/analytics/settings/page.tsx` and `actions.ts`, plus `src/components/admin/analytics/settings-forms.tsx`:
  - a section `#signals` after visit counting, as `FoldRow`s (`src/components/admin/fold-row.tsx`);
  - **Heatmaps**: a sentence of what it does, a switch, and "Visitors will be asked again about statistics";
  - an action `setHeatmapsAction` through `storeAction()`.
- Admin words in `src/lib/admin-messages/heatmaps.{en,nb}.ts`, registered in `src/lib/admin-text.ts` (`AdminAreaMessages`,
  `CATALOGUES`).

**Tests:** a view test (`renderToString`) of the off and on rows; `admin-strings.scan.test.ts` passes (no English in markup).

**Done when:** an owner can switch heatmaps on and off, and the store's banner asks Statistics again. Send the owner a screenshot of
the settings row.

### Step 6: Pictures under heatmaps

**Files:**

- `src/db/schema.ts`: `page_map_shots` (section 6.3), `pnpm db:generate`, then a custom migration for the `page-maps` bucket and RLS.
- `src/lib/map-measure.ts`: `measureAnchors`, written as a plain function that Playwright's `page.evaluate` can serialise. Inside it,
  use only DOM APIs and constants defined inside the function.
- `src/server/map-shots.ts`: `requestMapShot()`, `runMapShots(deadline, deps)` with an injected `photograph` like
  `browserLookPhotographer`, `mapShotUrl()`, `pruneMapShots()`.
- `src/app/api/cron/page-looks/route.ts`: inside `after()`, `await runMapShots(deadline, { … })` after `runPageLooks()`.
- The daily route: `daily.map-shots`.
- Lists: `COPY_RULES`, `NOT_PERSONAL` (the table and `storage:page-maps`), `STORE_EXPORT_LEFT_OUT`.
- `docs/security.md` §2.1: the bucket.

**Tests:**

- `src/server/map-shots.int.test.ts`, with a fake photographer: a waiting row becomes done with its layout; a failure becomes failed
  with a short problem; a fresh done row is not asked for again; a 15-day-old one is.
- A unit test of `mapShotUrl()`: a market store, a marketless store (D181), and a page test's version (`/ab/b`).
- A unit test of `measureAnchors` run in Playwright against a static HTML fixture (an e2e spec, `e2e/map-measure.spec.ts`, since it
  needs a browser).

**Done when:** on a local production build, a requested shot of the demo front page at all three widths is taken by one page-looks
run, and the stored layout holds the page's parts.

### Step 7: The heatmaps screens

**Files:**

- `src/app/admin/(gated)/[store]/analytics/heatmaps/page.tsx`:
  - a thin page in the shape of `traffic/page.tsx`, using `analyticsContext(slug, query)` (key `analytics:read`);
  - without `page`, the hub (**Where visitors get stuck**, most viewed pages);
  - with `page`, the map. It calls `requestMapShot()` when needed and passes the signed URL.
- `src/server/page-heat-read.ts` (section 8.5).
- `src/components/admin/analytics/heatmaps-view.tsx` (server-rendered), `page-map.tsx` (client canvas, section 9.3) and
  `map-refresh.tsx` (refreshes while a picture is being taken).
- `src/lib/store-nav.ts`: `item("/analytics/heatmaps", "Heatmaps", …, { icon: … })` in the group "The site", after Speed. Pick an
  icon from `NAV_ICON_NAMES` (`src/components/admin/nav-icons.tsx`), or add a lucide one to `PAGE_ICONS`.
- `src/lib/admin-map.ts`:
  - `store("analytics.heatmaps", "/analytics/heatmaps", "Heatmaps", …, { keywords: ["heatmap", "click map", "scroll map", "attention", "rage clicks", "dead clicks"] })`;
  - **move the keyword `"heatmap"` away from `analytics.traffic`** (replace it with "busiest hours"), so the page finder sends
    "heatmap" here;
  - add `"store:analytics.heatmaps"` to `NOT_YET_IN_PROMPT` (pitfall 17).
- `src/lib/admin-messages/nav.nb.ts`, `pages.nb.ts`, and `heatmaps.{en,nb}.ts`.
- `src/components/admin/analytics/traffic-view.tsx`: in the landing pages table, a link *Heatmap* on each row whose path is a page
  key.

**The Homer view:**

- `AnalyticsHeader` with a `lead` sentence;
- one Card **Where visitors get stuck**: up to 5 rows. Each row has the page (its title where known, otherwise its path), views and
  frustration %. The first row's *See the map* is the page's one green button;
- one Card **Most viewed pages**;
- when off, the sentence "Heatmaps are off." and, for owners, a link to `/analytics/settings#signals`;
- when on with nothing yet: "Collecting. A page's map appears after 30 page views."

**The map view:**

- `PageHeader` with *back*;
- view chips (Where people click / How far people scroll / Where people look);
- device chips, defaulting to the device with the most views;
- period chips (7, 30, 90 days; scroll and attention also 365);
- version chips when a running or stopped test has tagged rows for this page;
- then the overlay and its table. Lisa's fold holds *Take a new picture*, the "not on this picture" count and the dates.

**Tests:**

- `heatmaps-view.test.ts` (off, collecting, too few views, a ranked list);
- `heat-read` unit tests exist already;
- `e2e/signed-in/heatmaps.spec.ts`, modelled on `live.spec.ts`: the OWNER opens the page and sees the heading; the READER (Read-only
  role) can open it, since `analytics:read` is enough for totals;
- `store-nav.test.ts`, `admin-map.test.ts`, `permissions.scan.test.ts` and `admin-pages-nb.test.ts` pass.

**Done when:** on a local build with seeded heat rows and a picture, the map draws in all three views. **Send the owner screenshots**
of the hub and each view (phone and computer), plus the diagram `docs/heatmaps-and-recordings.svg`.

### Step 8: Recordings: tables, limits and the ingest route

**Goal.** The server can take recordings. No browser sends any yet.

**Files:**

- `src/db/schema.ts`: `recordings` (section 6.4), then `pnpm db:generate`.
- A custom migration:
  - the `recordings` bucket;
  - RLS;
  - the retention kind (widen `retention_rules_kind`, insert the seed);
  - `plan_limits` rows for `recordings_month` with the owner's values (O1);
  - the limit key and metric checks that `LIMIT_KEYS` and `USAGE_METRIC_IDS` build;
  - the plan-comparison row.
- `src/lib/retention.ts`, `src/lib/usage-metrics.ts`, `src/lib/limits.ts`, `src/server/usage-meter.ts` and `src/server/limits.ts`
  (section 6.4).
- Words: `m.plans.limitNames.recordings_month` (en, nb, sv, da), and the `capacity` admin catalogue (en, nb).
- `src/server/recording-files.ts`: `recordingFiles()` with `upload`, `download`, `remove` and `pathsOf(row)`. Copy
  `reviewPictureStorage()` (`src/server/review-picture-store.ts`): the secret key from `secretKey()` in `src/server/media.ts`,
  `cacheControl: "0"`, and `upsert: false`.
- `src/server/recordings.ts`: `recordSegment()` (section 8.2), `forgetRecordings()` (section 8.3), `pruneRecordings()`, and
  `deleteRecording(member, id)` (owner, audited `analytics.recording_deleted`).
- `src/app/api/signals/rec/route.ts` and `src/app/api/signals/forget/route.ts`. Both go in `BEACONS`.
- `src/server/request-budget.ts`: `BUDGETS.rec` and `BUDGETS.forget`, and `rec` in `FAIL_CLOSED`.
- Lists: `COPY_RULES`; `PERSONAL_DATA` with the Norwegian reason; `PURPOSE_OF`; `STORE_EXPORT_LEFT_OUT`.
- The daily route: `daily.recordings`.
- The store closure hook (section 8.7).

**Tests:**

- `src/db/privacy.test.ts` passes: the register and the retention seed.
- `src/db/commerce.test.ts`: the checks on `recordings`.
- `src/server/recordings.int.test.ts`, with a fake storage (inject `recordingFiles` the way `review-picture-store` tests do; find them
  with `grep -rln reviewPictureStorage src`):
  - `seq` 0 creates the row; `seq` 1 adds to it;
  - no consent, GPC, a robot, the switch off, a private store, a refused page, over the monthly limit, and over the day's slot each
    give 410;
  - a zip bomb (a 20 MB string gzipped) gives 400;
  - an id of another store gives 410;
  - a duplicate segment is counted once;
  - forget deletes the rows and asks storage to remove exactly their paths;
  - the prune deletes expired rows and their files, and stops at its deadline.
- `src/db/<name>-plan-features.test.ts`, copied from the redirects one.
- `src/server/limits.int.test.ts`: `recordings_month` is counted and refuses past the limit.

**Done when:** the tests pass, the migration is applied by CI, the advisors are clean, and the versions are recorded.

### Step 9: The recorder in the storefront

**Files:**

- `pnpm add -E @rrweb/record@2.2.0 @rrweb/replay@2.2.0 @rrweb/types@2.2.0`, or the newest 2.2.x that has been out two weeks. Update
  the version note in this file.
- `src/components/signals/session-recorder.ts` (section 7.4) and `src/components/signals/forget.ts` (section 8.3).
- `src/components/signals/site-signals.tsx`: the `recOn` branch, page changes, the tail on hidden and in cleanup, and withdrawal.
- The Cookies page: the *Delete my recordings* button, a small client component in `src/components/consent/` that calls
  `forgetRecordings()` and then says "Deleted".

**Tests** in `e2e/recordings.spec.ts`, on the demo store with `recordings = true` and share 100 set in setup:

- with Statistics accepted but not Recordings, no request to `/api/signals/rec`, and the rrweb chunk is never fetched. Listen for
  requests whose URL holds the recorder chunk's name, or assert no `rec` request;
- after accepting Recordings, a segment is POSTed within 40 s of activity, and the server stores it (the row exists);
- **masking:** type `secret-123` into a builder form field on the page, then decompress every rec request body in the test
  (`zlib.gunzipSync`) and assert `secret-123` is in none;
- navigating to `/no/account` sends nothing while there, and the recording continues (same id) after coming back;
- opening the cart drawer stops recording; closing it resumes with the same id;
- withdrawing Recordings in the consent choices sends one request to `/api/signals/forget` with the id, and the rows are gone;
- staff (with the admin return cookie set) record nothing;
- `e2e/performance.spec.ts` is unchanged.

**Done when:** the e2e passes in CI. Recordings still cannot be switched on by owners, because the switch comes in step 11.

### Step 10: Sealing recordings

**Files:**

- `src/server/recordings.ts`: `sealRecordings({ deadline })` (section 8.7). `recordingEvents()` (step 11) reads `all.gz` when sealed.
- `src/app/api/cron/cart-reminders/route.ts`: one `runJobs` line, with a comment saying who waits.
- `src/server/cron-prunes.scan.test.ts`: `DISPATCHER_JOBS = 76`.

**Tests** in `src/server/recordings.int.test.ts`:

- a finished recording with three segments becomes one file with the events in order, and the segments are removed;
- a recording still active (last segment 10 minutes ago) is left alone;
- an idle run makes one query.

**Done when:** the tests pass.

### Step 11: The recordings screens, and the recordings switch

**Files:**

- `src/app/admin/(gated)/[store]/analytics/recordings/page.tsx`: `analyticsContext(slug, query, "owner")`, with the list, chips
  and filters.
- `src/app/admin/(gated)/[store]/analytics/recordings/[id]/page.tsx`: owner only; the player page. It adds the path to the
  `FULL_WIDTH` regex in `src/app/admin/(gated)/[store]/layout.tsx`.
- `src/app/admin/(gated)/[store]/analytics/recordings/[id]/events/route.ts`:
  - GET;
  - owner guard (pitfall 15);
  - **audit first** with `audit(member.account.id, store.id, "analytics.recording_viewed", { recording: id, device, durationS }, { target: { type: "recording", id } })`.
    If the audit fails, answer 503 and send nothing (the precedent is `exportAnalyticsTable()`);
  - set `viewed_at` if it is null;
  - then `recordingEvents()`, returned as gzip JSON (`Content-Encoding: gzip`, `Cache-Control: private, no-store`).
- `src/server/recordings-read.ts` (section 8.5).
- `src/components/admin/analytics/recordings-view.tsx` (server) and `recording-player.tsx` (client):
  - `const { Replayer } = await import("@rrweb/replay")`, plus the package's stylesheet (find its path in
    `node_modules/@rrweb/replay/package.json` `exports`);
  - `new Replayer(events, { root, skipInactive: true, mouseTail: false, showWarning: false })`;
  - **never** `UNSAFE_replayCanvas`; never add `allow-scripts`;
  - scale the replay iframe to fit the column, like `ScaledFrame` in `src/components/theme-preview-stage.tsx`;
  - controls: play and pause, speed 1, 2, 4 and 8, skip the quiet parts (on), and a timeline with markers from the `kz-page` and
    `kz-click` custom events;
  - an event list beside the player (pages with their times; rage and dead moments). Pressing one seeks there (`replayer.play(ms)`
    or `pause(ms)`);
  - *Delete this recording* with a confirmation.
- The recordings switch on Analytics settings (`#signals`):
  - a `FoldRow` **Recordings**;
  - three confirmation checkboxes ("My store is not aimed at children", "My store does not sell health, religious, political or
    other sensitive goods", "My privacy policy says visits may be recorded"; the third links to the store's privacy page);
  - share chips (10, 25, 50 or 100 %, default per O2);
  - in its own fold, "Hide all text in recordings";
  - the sentence "Recordings are kept 30 days. Only you can watch them.";
  - the action `setRecordingsAction`.
- `store-nav.ts` `item("/analytics/recordings", "Recordings", …, { icon: "video" })`.
- `admin-map.ts`: `analytics.recordings` and `analytics.recording`, both with `needs: "owner"`, both in `NOT_YET_IN_PROMPT`.
- Words: `recordings.{en,nb}.ts`, `nav.nb.ts`, `pages.nb.ts`.

**The Homer view of the list:**

- the lead sentence;
- chips with counts that show only when not zero: All, Rage clicks, Dead clicks, Phone, Tablet, Computer;
- rows grouped by day (Today, Yesterday, then the date), each with its time, device, length, number of pages, entry page, rage and
  dead counts as chips, and versions;
- watched rows are dimmed;
- *Watch* on each row;
- the sort "Most frustrated first", with Newest as the alternative;
- Lisa's fold: page, period and version filters.

**Tests:**

- view tests of the list (off, empty, grouped by day, dimmed when watched);
- a unit test of the player's marker building (a pure helper `timelineMarks(events)` in `src/lib/recording.ts`);
- `e2e/signed-in/recordings.spec.ts`: the OWNER sees the list and opens the player, which draws an iframe with
  `sandbox="allow-same-origin"` and no `allow-scripts`. The READER gets the page refused, and the nav link is absent. The events
  route answers 403 to the READER. An audit row exists after the OWNER's view;
- a unit test that the events route refuses when audit fails (mock `audit`).

**Done when:** an owner can switch recordings on (with confirmations), visit their store in another browser, and watch the recording.
**Send the owner screenshots** of the list, the player (phone and computer recordings) and the settings row.

### Step 12: Tying it to A/B tests

**Files:**

- `src/db/schema.ts`: goals `rage` and `dead` (section 6.5), then `pnpm db:generate`.
- `src/server/page-heat.ts`: step 10 of section 8.1. Insert from the exposure:

  ```sql
  insert into commerce.experiment_events (store_id, experiment_id, visitor, variant, goal, ref)
  select x.store_id, x.experiment_id, x.visitor, x.variant, $goal, ''
  from commerce.experiment_exposures x
  where x.store_id = $store and x.experiment_id = $exp and x.visitor = $visitor and x.variant = $version
  on conflict do nothing
  ```

  The visitor is `decodeAssignments(cookie).visitor`. Use the column names in `src/db/schema.ts`, which win over this sketch.
- `src/server/experiment-results.ts` and `src/lib/experiment-results.ts`:
  - `funnel` gains `rage` and `dead` (distinct visitors per version and goal);
  - a pure `frustratedVersion(results)` next to `harmedVersion()`. For each version other than `a`, with at least 1,000 visitors in
    both it and `a`, compute a two-proportion z on rage visitors and on dead visitors. It flags when z ≥ 3.29 against the version.
  - It never stops a test.
- `src/components/admin/experiment-results-view.tsx`:
  - a section `#ab-behaviour` after the funnel, one row per version. Columns: reached half the page (from `versionBehaviour()`),
    rage-click visitors %, dead-click visitors %;
  - links *Heatmap* (`/analytics/heatmaps?page=…&tag=…`) and *Recordings* (`/analytics/recordings?tag=…`), each shown only where
    `canOpenPath()` allows (`src/lib/permissions.ts`);
  - below 100 visitors, "Too few visitors yet";
  - a warning line when `frustratedVersion()` flags.
  - Words in `experiments.{en,nb}.ts` `results`.
- `src/lib/platform-experiments.ts`: a `Flag` kind `frustrated` and its `adviceFor()` line.
- The heatmap page reads a `tag` parameter. The version chips appear for any test that has tagged rows for the page. Map shots for a
  tag use the version route (section 9.2).
- The recordings list reads a `tag` filter and shows version chips.

**Tests:**

- `src/lib/experiment-results.test.ts`: `frustratedVersion()` with 1,000 versus 999 visitors, z just above and below 3.29, and the
  direction (fewer rage clicks is never a flag);
- `src/server/experiments.int.test.ts`: a heat beacon with `rv: 1` from an enrolled visitor writes one `rage` event, and a second
  beacon does not write another;
- `experiment-ui.test.ts`: the behaviour section renders, with links hidden for a member who cannot open them;
- `e2e/ab-tests.spec.ts`: an enrolled visitor's heat beacon carries the test's tag, and the server writes the tagged row.

**Done when:** a running test on the demo store shows behaviour per version, and a version's heatmap draws on that version's own
picture. **Send the owner a screenshot** of the behaviour section.

### Step 13: Words for the law, and the docs

**Files:**

- `docs/dpia-recordings.md`: a **draft** DPIA in the shape of `docs/dpia-ai.md`. It covers systematic monitoring, the measures of
  section 4 and the risks of section 15. The heading says "Draft for the owner and a lawyer".
- **Owner tasks**, written in the decision row and **not** made in code:
  - the DPA's types of data and nature (`src/lib/platform-legal/en.ts:288`, `nb.ts:287`) gain "interaction and recording data",
    with the sentence "we never use recordings for our own purposes; platform staff do not watch a store's recordings";
  - Kaizena Flow's own privacy notice gains a sentence about its site's heatmaps and recordings;
  - the Cookies pages' wording is reviewed.
- `docs/analytics.md`: the full "Heatmaps and recordings" section (definitions pointing to section 3 here, what is not measured).
- `docs/rules/storefront.md` and `docs/rules/admin/marketing.md`, or the right admin rules file per `docs/rules/admin/README.md`: the
  rules of section 14.
- CLAUDE.md: one line under Storefront and one under Admin. The pattern is the short lines already there: "Heatmaps and recordings
  (D652, `docs/heatmaps-and-recordings.md`, …)".
- `docs/capacity.md`: the limit and the size figures.
- `docs/platform-parity.md`: the row (section 11).
- `docs/ab-testing.md`: a short "What the behaviour section adds" under phase 11.
- `docs/security.md`: check §2.1 and §2.11 are true, and add the replay sanitising to §2.3 ("recorded DOM is never drawn as live
  HTML").

**Done when:** the docs say what was built. `brand.scan.test.ts` passes (the name Kaizena Flow everywhere).

### Step 14: The AI manager's tools (last)

**Files:**

- `src/lib/owner-tools.ts`, two read-only tools with no gate:
  - `page_behaviour({ page?, days, device? })`: the figures of **Where visitors get stuck**, or one page's reach at 25, 50, 75 and
    100 %, attention per band, and the parts clicked most with dead and rage counts;
  - `version_behaviour({ experiment })`: the A/B behaviour figures per version, and the flag.

  Copy the description style of `speed_report`: "Read-only; repeat its figures, never make one", and the minimum volume.
- `src/server/heat-tools.ts`: the handlers, calling the same reads as the pages. They return figures already formatted, plus
  `page: adminLink(...)`.
- `TOOL_PERMISSIONS` (`analytics:read` for both), `src/server/owner-tools.ts` handler map, `src/lib/tool-words.ts`, and
  `assistant.nb.ts`.
- The MCP catalogue and contract (`src/lib/mcp-catalogue.ts`, `src/data/api-contract.json`, `api-contract-surface.json`,
  `content/docs/developers/changelog.md`).
- `src/lib/agent-eval.ts`: one case in which a part's label (from `describePart`) hides an instruction and a canary. Expect
  `forbiddenText: [CANARY]` and no gated tool.
- Remove the new pages from `NOT_YET_IN_PROMPT`.
- **No tool reads recordings.** Recordings never go to a model in v1: that would be a new purpose and a new recipient (section 4).

**Tests:**

- `src/lib/heat-tools.test.ts` (pure parts) and `src/server/heat-tools.int.test.ts`;
- `agent-eval.test.ts`;
- `api-contract.test.ts`;
- `owner-tool-permissions.test.ts`.

**Then the owner records the eval again** on Platform → AI and commits `src/data/agent-eval-recording.json`. Until then,
`agent-eval-replay.int.test.ts` fails in CI. Say this in the push's message and to the owner **before** pushing.

---

## 14. Rules every step follows

**Server code:**

- Server-only modules import `server-only`.
- Reads go through `typedRows()` with `col`, filter with `owned(storeId)`, and use `coalesce()` on sums.
- Writes that pick a row by id also name `store_id` (`src/server/ratchet.scan.test.ts`).
- Log with `log(level, event, fields, error)`: ids and counts only, never a path with a token, never a person's data. No
  `console.error`.

**Beacon routes:**

- They copy the speed route: `sameSite()`, byte caps, and an empty `no-store` answer.
- They import nothing from chat, auth, AI or admin text. They are listed in `BEACONS`.

**Browser code:**

- No zod, no `lib/page-content`, no `lib/i18n`, no `lib/known-cookies` (`storefront-bundle.scan.test.ts`).
- rrweb only by `import()`.
- Words a client component shows come from `src/lib/messages/*-browser.ts`.

**Admin code:**

- No English literal in admin markup (`admin-strings.scan.test.ts`); words go in the areas `heatmaps` and `recordings`.
- One green button per page.
- Lisa's depth in one *Advanced* fold.
- Every chart has a table behind it.
- Figures go through the analytics formatters, never a local number format (`layout-contain.test.ts`).

**Every page checks its own guard:**

- heatmaps use `analytics:read`;
- recordings, the player and the events route are owner only;
- settings actions are owner only.

**Migrations:**

- Add, never rename or drop.
- Indexes on the hot tables are built `concurrently` (none of the new tables is hot).
- Run `node scripts/prune-snapshots.mjs` after a custom migration.
- Never apply a migration by hand. Record versions in the decision.

**Every new table** goes in `COPY_RULES`, in `PERSONAL_DATA` or `NOT_PERSONAL`, and in `STORE_EXPORT_TABLES` or
`STORE_EXPORT_LEFT_OUT`, with RLS on.

**Every cookie or storage item** goes in `KNOWN_COOKIES` and `COOKIE_PATTERNS`, with purposes in en, nb, sv and da.

**Shopper words** are hand-written in en, nb, sv and da, and those a law asks for are flagged for legal review.

---

## 15. Risks and how we hold them

| Risk | Hold |
|---|---|
| A recorder leaks typed or personal data | `maskAllInputs`; blocked forms, chat and drawer; the allow-list of pages; server re-checks of the pages; the e2e masking test (step 9); "Hide all text" |
| Forged recordings carry hostile HTML into the owner's browser | `sanitizeEvents()` on the server; rrweb's sandbox without scripts; owner-only access; budgets; same-site and own-page checks |
| A heavy page makes the full snapshot slow on cheap phones (up to 0.7 s at 6× CPU slowdown, measured on a 2,300-element page) | Sampling; started idle after load; `slimDOMOptions: "all"`; mouse moves throttled; stops on runaway pages |
| Many Storage objects grow Postgres | Segments every 30 s; sealing into one file; the monthly limit; 30-day prune |
| Hot daily rows lock under heavy traffic | One short upsert per beacon. If `heat.record_failed` logs show lock timeouts, add a staging table folded every five minutes (the technique Sentry and PostHog use) |
| Dead clicks that are not dead (ambient motion, slow fetches) | `data-kz-ambient`; ignore `style` and `data-fx-*`; 2.5 s window; the verdict shown as a share with a minimum volume |
| Pictures that do not match what visitors saw (old content, consent banner, lazy parts) | Re-shot after 14 days or on demand; consent cookie set; `settle()`; "not on this picture" count; anchors by part, not by pixel |
| The consent change breaks today's banners | A fourth bit only when recordings are asked about; `heat` only when heatmaps are on; a byte-identical check in step 1 |
| Rolling deploys: an old instance reads a four-bit cookie | Only stores that turned recordings on write four bits, and the switch arrives in step 11, long after step 1 is everywhere |

---

## 16. Pitfalls (read before steps 1, 4, 9 and 11)

1. **The A/B version is not in the URL.** The proxy rewrites on the server. Never key anything by URL to tell versions apart; use
   `shownVersions()` and the server's check.
2. **There is no `data-ab` attribute.** The version reaches the browser only as `AbMarker`'s props. Register it there.
3. **A first A/B page view is always the original,** and a stale page reloads once. `MIN_VIEW_MS` drops the reload. Tags come only
   from a confirmed marker.
4. **`OffPayRoutes` unmounts on `/cart`, the drawer included.** Clean up in the effect's cleanup and resume from `sessionStorage`.
5. **`usePathname()` can be the internal path** behind a host rewrite. Read `window.location.pathname`.
6. **`kz-page`, `kz-menu` and `kz-brands-track` are not parts.** Only the **first** class of the wrapper, matching `PART_ID`, is an
   anchor.
7. **`data-kz-block` is taken** by inline editing. Use `data-kz-private` for blocking.
8. **The motion runtime writes `style` and `data-fx-*` on pointer moves.** Those mutations must not make a click alive.
9. **`sendBeacon` and keepalive share one 64 KiB budget** per page. The tail must stay under 60,000 bytes, and heat summaries under
   8,000.
10. **The Vitest environment has no DOM.** Keep the logic in pure modules and test the DOM layer in Playwright.
11. **The storefront bundle scan follows only static imports.** rrweb must come in by `import()`, or the first-script budget breaks.
    It has about 5 KB of room (`e2e/performance.spec.ts`).
12. **Never reuse the consent cookie's visitor id or the A/B visitor id** for a recording. Both link sessions over time, and the A/B
    id links to orders.
13. **A store with recordings off must produce exactly today's consent cookie.** Check it byte for byte (step 1).
14. **`chat_usage` is pruned after two days.** Never keep a monthly count there; the monthly limit uses the usage meter.
15. **Owner-only routes:** `permissions.scan.test.ts` wants a literal key that matches the page's section, or `owner` where the map
    says `needs: "owner"`. If it refuses the events route, read its message and follow it. **Never** loosen recordings to
    `analytics:read`.
16. **Every Storage object is a Postgres row.** Never write one file per event or per page view.
17. **New admin pages and new owner tools change the AI manager's prompt.** CI's eval replay then fails until the owner records the
    eval again. List new pages in `NOT_YET_IN_PROMPT` (steps 7 and 11) and take them out only in step 14, so the owner records once.
18. **`siteCookies()` is cached under `cookiesTag`.** Every setter of the switches must refresh it, or the banner will not ask.
19. **The heat route must not import `src/server/experiments.ts` if the beacon scan refuses it.** Move `runningExperiments()` into a
    light module.
20. **Do not run `playwright install`.** Use `PLAYWRIGHT_CHROMIUM_PATH` (CLAUDE.md, Commands).
21. **rrweb 2.2.2 is a week old (16 Nov 2026).** Pin the exact version of all three packages to the same number.
22. **The admin cannot frame a store's own domain.** Do not try a live iframe for heatmaps; the picture is a screenshot.
23. **`src/lib/analytics-heatmap.ts` and the `Heatmap` chart are the weekday-by-hour sales map.** Do not touch or reuse them.
24. **Never `UNSAFE_replayCanvas`.** It adds `allow-scripts` to the replay frame.
25. **Legal texts of the platform are the owner's,** hand-written (`src/lib/platform-legal/*`). Do not edit them; list the points.

---

## 17. Sources

**The research of 16 November 2026.**

- **This codebase:** the A/B engine, privacy and the beacons, the storefront's DOM, data and jobs, the admin and AI.
- **The web:** tool definitions, techniques and the law.

**Vendor and open-source definitions:**

- Microsoft Clarity, semantic metrics, scroll and attention maps, masking, consent API v2 (enforced in the EEA from 31 Oct 2025):
  learn.microsoft.com/clarity.
- PostHog:
  - `posthog-js` `dead-clicks-autocapture.ts` (2500 ms; 100 ms scroll and selection), `rageclick.ts` (3 clicks, 1 s, 30 px),
    `scroll-manager.ts` (max content percentage);
  - `heatmaps.ts` (absolute coordinates).
- Sentry, `replay-internal` `handleClick.ts` and `constants.ts` (3000 ms, 300 ms scroll, 7000 ms timeout).
- Datadog RUM `computeFrustration.ts`.
- OpenReplay `deadClick.ts` (1234 ms) and `clickRage.ts`.
- Contentsquare's exposure (150 ms).
- Clarity `click.ts` (element-relative coordinates).

**Techniques:**

- rrweb 2.x (stable since 2.0.0 on 1 Jun 2026; 2.2.2 on 9 Nov 2026; MIT). Recorder 23 KB gzip, replayer 85.5 KB gzip, measured.
- Measured bytes: a full snapshot is 38 to 360 KB gzip; after that, 6 to 24 KB a minute.
- `CompressionStream` is Baseline since May 2023.
- Keepalive's 64 KiB budget (Fetch Standard).
- Supabase Storage pricing, and its rows in `storage.objects`.
- Vercel `dub1` pricing.

**Law (dated in the research):**

- EDPB Guidelines 2/2023 v2.0 (7 Oct 2024).
- Norway: ekomloven § 3-15 (LOV-2024-12-13-76, from 1 Jan 2025); Nkom (16 May 2025); Datatilsynet's consent advice (3 Apr 2025),
  analytics advice (23 Apr 2025) and DPIA list.
- CNIL, recommendation on session replay tools (adopted 8 Oct 2026, published 5 Nov 2026) and its synthesis (Oct 2026); CNIL's
  self-assessment for audience measurement (Jul 2025).
- WP248 rev.01.
- CJEU C-252/21, C-21/23, C-413/23 P, C-40/17 and C-673/17.
- Princeton CITP "No boundaries" (2017).

---

## 18. Change log

| Date | Change |
|---|---|
| 16 Nov 2026 | Written: research, design and the build in 14 steps. Nothing built. |
