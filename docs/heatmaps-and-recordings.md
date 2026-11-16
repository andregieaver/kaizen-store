# Heatmaps and recordings (decision D656, planned)

A built-in alternative to Microsoft Clarity and Hotjar, for store owners and for Kaizena Flow's own site. It covers:

- **dead clicks** and **rage clicks**;
- **recordings** of visits (replays), on phones and computers;
- **heatmaps**: where people click, how far down the page they scroll (a percentage), and where they look (attention);
- **all of it per version of a running A/B test** (D148, `docs/ab-testing.md`).

Asked for by the owner on 16 November 2026. Status: **planned, nothing built.**

The research behind it was done the same day: five readings of this codebase, and what vendors and open-source tools publish about
their definitions and techniques, plus the law in Norway and the EU (sources in section 17). The plan was then reviewed adversarially
from five angles (claims about the code, the build steps, design bugs, how followable it is, and privacy). The 112 findings are folded
in (section 18).

The plan has two parts:

- **Part A (sections 1 to 12)** is the design: what is built and why.
- **Part B (sections 13 to 16)** is the build: steps in order, each with its files, its tests and when it is done.

It is written for an implementer who has not seen the research. Read sections 0, 3 and 16 before writing any code.

---

## 0. How to use this plan

1. **Build the steps of section 13 in order.** One step is one push to `main`, or a few. Before every push, run `pnpm lint`,
   `pnpm typecheck` and `pnpm test` (CLAUDE.md, Workflow).
   - A step with a migration also needs `pnpm db:check`.
   - Run `pnpm test:int` against a seeded local database whenever the step touches `src/server`.
   - **A push without a migration deploys after the quick gate**, before CI's integration and e2e results arrive
     (`docs/ci-migrations.md`). So before pushing a step that adds or changes an e2e spec, run it locally:
     `pnpm build && pnpm test:e2e e2e/<spec>`, and the signed-in specs with `E2E_SIGNED_IN=1` as CLAUDE.md says.
2. **Each step lists its files, the tasks, the tests to add and "Done when".** Do not start a step before the one before it is done.
3. **When this file and the code disagree, the code wins.** Stop, correct this file in the same change, and add a line to the change
   log (section 18). Line numbers here were right on 16 November 2026. Find each place by the name given, not by the number.
4. **Names that are taken:**
   - `insights` (`analytics-insights.ts` and `owner-insights.ts` exist);
   - `analytics-heatmap` (the weekday-by-hour sales heatmap, D152);
   - the storage key `kaizen_rec` (recommendations, D139);
   - the attribute `data-kz-block` (inline editing).

   The names to use are fixed in section 5.4.
5. **Decision number.** Use D656 if it is still free (`grep -o "D6[0-9][0-9]" docs/decisions.md | sort -u | tail -3`), otherwise the next
   free number, and replace D656 in this file. Each step adds its own sentence to that decision row, and its migration versions under
   "Migration versions" (CLAUDE.md, Database).
6. **Send the owner screenshots** of each new or changed screen as you build it (CLAUDE.md, Workflow). Steps 5, 7, 11 and 12 say when.
7. **Read section 16 (pitfalls) before step 1, and again before steps 4, 9 and 11.**

---

# Part A: the design

## 1. What the owner and the shopper get

### 1.1 The owner (Homer first, Lisa one step away)

| Where | Homer sees | Lisa finds (in one *Advanced* fold) |
|---|---|---|
| Analytics → The site → **Heatmaps** (`/admin/{store}/analytics/heatmaps`) | A sentence ("1,240 page views mapped in the last 7 days; 6 % had a dead or rage click."), then **Where visitors get stuck**: the pages with the most frustration, each with *See the map* and, for the owner, *Watch recordings*. | Period, the page list by views, the numbers behind each page |
| A page's map (`…/heatmaps?page=/no/p/blue-shirt`) | The page as a picture, with three views: **Where people click**, **How far people scroll**, **Where people look**. Toggles for Phone, Tablet and Computer. Below the picture, a table of the parts clicked most, with their dead and rage clicks. | Click filters (All, Dead, Rage), "not on this picture" count, *Take a new picture*, dates |
| The same map during an A/B test (step 12) | Chips for the test's versions (A, B…), each drawn on its own picture | — |
| Analytics → The site → **Recordings** (`/admin/{store}/analytics/recordings`, **owner only**) | A sentence ("84 recordings this week; 9 with rage clicks."), chips with counts (All, Rage clicks, Dead clicks, Phone, Tablet, Computer), then recordings grouped by day, each with *Watch*. | Filters by page, period and A/B version |
| A recording (`…/recordings/{id}`) | A player. It can play, change speed and skip the quiet parts (on by default). A timeline is marked with page changes and dead and rage clicks, with a list of those moments beside it. *Delete this recording*. | The device, screen size and versions seen |
| An A/B test's results (`/admin/{store}/experiments/{id}`) | A new **Behaviour** section per version: the share of page views that reached half the page, and the shares with rage clicks and with dead clicks. Links *Heatmap* and *Recordings* for that version. A warning line when one version is clearly more frustrating. | — |
| Analytics → **Analytics settings** | Two switches, both off: **Heatmaps** and **Recordings**. Recordings asks for three confirmations before it turns on, and how many visits to record. | Recordings: "Hide all text" (strict masking) |

### 1.2 The shopper

- **Nothing runs, and nothing is sent, until they say yes.**
- **Heatmaps** run only for visitors who accepted **Statistics**. When a store turns heatmaps on, every visitor is **asked again**, and
  the Statistics text now names heatmaps.
- **Recordings** run only for visitors who accepted a new choice, **Recordings of your visit**. The banner's first screen carries a
  short sentence about recordings of its own.
- **The Cookies page** explains both. It has a *Delete my recordings* button for the recordings this browser can still name.
- **Global Privacy Control and Do Not Track mean no,** as for visit counting.
- **Never collected:** the cart, the checkout, order pages, account pages, links with tokens, or the chat. Typed text is never
  recorded.

---

## 2. Decisions

These are settled by this plan. Items marked **(owner)** need the owner's yes before the step named. Items marked **(lawyer)** are open
questions in section 12.

1. **Built in, with no outside service.**
   - The data stays in Supabase (`eu-west-1`) and in Vercel functions in `dub1`. Both are already sub-processors
     (`docs/residency-register.md`), so there is no new vendor, no residency row and no 30 days' notice to stores.
   - rrweb (MIT) runs in the visitor's browser and sends to our own routes, so it is a library, not a processor.
2. **Two switches per store, both off by default, owner only:**
   - **Heatmaps**, which includes dead and rage clicks (`stores.heatmaps`);
   - **Recordings** (`stores.recordings`, plus `recording_share` and `recording_mask`).

   They are settings like `stores.visit_counting`, not store features (D178). Making them a feature would cost a migration of
   `feature_needs()` and buy nothing.
3. **Recordings stay closed platform-wide until the law questions are answered.** `platform_settings.recordings_open` is off by
   default. While it is off, only the house store (`stores.house`) can switch recordings on. A platform owner opens it on Usage and
   limits once O3, Q3, Q6 and Q7 are answered (section 12). Heatmaps have no such hold.
4. **Consent:**
   - **Heatmaps** sit under **Statistics**. A version token `heat` makes visitors be asked again, and the Statistics text names
     heatmaps while they are on. **(lawyer Q2)**
   - **Recordings** are a **new consent category, `recordings`**, with its own toggle and its own short notice on the banner's first
     screen. This follows the CNIL's final recommendation on session replay (8 Oct 2026) and Datatilsynet's "one purpose per choice"
     (3 Apr 2025).
   - Nothing is loaded or sent before consent. The click watch starts only once heatmaps or a recording may run.
5. **Heatmaps are stored only as daily totals, with no visitor id, no row per click and no raw event.**
   - So the tables are not personal data (`NOT_PERSONAL`).
   - **A/B behaviour is computed from those totals** (tagged per version), not from per-visitor rows. The promise "only totals are
     kept" therefore holds for visitors in a test too.
   - One beacon writes three statements: the daily slot and two upserts (the bloat review's bar). The store is a cached read. A
     private store's `lockedOut()` and a miss of the `runningExperiments()` memo add one read each.
6. **Recordings are personal data, held under pseudonyms:**
   - a random id per browser tab, never joined to a customer, cart, order, visit, the consent cookie's id or the A/B id (CNIL "I1");
   - times are kept coarse (to 10 minutes), and the events carry times relative to the recording's start, so a recording cannot be
     joined to other tables by its exact time;
   - **only the owner** can watch them, and each viewing is written to the audit log first;
   - kept **30 days**, and deletable one by one, by the owner or by the visitor's own browser.
7. **Which pages: an allow-list that mirrors the server's rule** (`placeOfPath()` then `speedKind()`).
   - **Allowed:** the front page, product pages, categories and tags, the product list, the blog list, blog posts, and the store's own
     one-segment pages.
   - **Never:** the cart, checkout, order, account and every page with a token, the country chooser, the admin, nested or unknown
     pages.
   - **For recordings also never:** the search page, and any page whose address has `q=` (search results can show typed words).
   - **Never for staff:** owners and staff browsing their own store are never recorded (`staffPath()`).
8. **Masking in recordings:**
   - every input, select and textarea is masked to nothing (not even its length);
   - the chat, the cart drawer, every form, search suggestions, review pictures and the express-checkout area are blocked (they replay
     as empty boxes);
   - text people wrote (reviews, comments, names) is masked;
   - "Hide all text" masks all text;
   - no canvas, no cross-origin frames, no network or console capture, and no query string in any recorded address.
9. **The picture under a heatmap is a screenshot** taken by our own Chromium job (page looks, D310):
   - one width per device class, from the store's own breakpoints (`typicalWidth()`);
   - the page's parts are measured in the same pass, so clicks land on the right part;
   - kept in a private bucket.

   It is not a live frame, because the admin cannot frame a store's own domain (`frame-ancestors 'self'`). It is not a recording's DOM,
   because heatmaps must work with recordings off.
10. **A/B tests:**
    - every heat total and every recording carries the test versions the visitor was really shown, checked on the server against the
      visitor's A/B cookie;
    - results show behaviour per version;
    - more frustration only **flags** a version and never stops a test. An automatic stop would need a new decision
      (`docs/ab-testing.md` "Guardrails").
11. **Plans:**
    - a monthly limit `recordings_month` (hard: over it, the store stops recording, silently);
    - a daily ceiling of heat beacons per store, against abuse;
    - one plan-comparison row, which describes and gates nothing (D132);
    - limit values are seeded from the proposal in section 10, and the platform admin can change them.
12. **Platform parity:**
    - kaizenaflow.com is served from the house store `kaizenaflow` (D484) **while `platform_settings.site_from_store` is on**, and then
      gets everything in the same change. While that switch is off, it does not, and the parity row says so (section 11).
    - The platform's own routes (sign-up, theme store, docs, status) are **not** in v1, and are named as the next step.
    - Platform admins see counts only, and never watch a store's recordings.
13. **AI manager tools come last (step 14).** Every new tool and every new admin page changes the manager's prompt, and the owner must
    then record the agents' eval again (pitfall 17).

---

## 3. Definitions (the one place they are written)

The numbers live in code as named constants:

- `src/lib/page-heat.ts` for heatmaps;
- `src/lib/click-signals.ts` for clicks;
- `src/lib/recording.ts` for recordings.

A unit test holds each constant to the value in this table.

| Term | Definition | Constant(s) |
|---|---|---|
| **Page view** | From a page load, a soft navigation or a back/forward restore (`pageshow` with `persisted`) to an allowed page, until the next page change or `pagehide`. A page view with less than 1 s visible is never sent; this drops `AbMarker`'s reload and bounces. Opening and closing the cart drawer does **not** start a new view (section 7.3). | `MIN_VIEW_MS = 1000` |
| **Page key** | `placeOfPath(path, …).landing` (`src/lib/visit-record.ts`), worked out **on the server** from the path the view started on: `/no`, `/no/p/{handle}`, `/no/category/{slug}`, `/no/{slug}` …. Its kind is `speedKind(landing)` (`src/lib/speed.ts`). A path whose kind is null is never kept. | — |
| **Device class** | From `window.innerWidth` (the width CSS media queries use) at the start of the view, against the store's breakpoints: below `md` is `mobile`, below `lg` is `tablet`, otherwise `desktop`. The defaults are 768 and 1024 (`DEFAULT_BREAKPOINTS`, `src/lib/breakpoints.ts`). These are the same words as `visits.device`. Homer reads Phone, Tablet and Computer. | `deviceClass()` |
| **Part id** | The id in a part's class `kz-{id}` (`partClass()`, `src/lib/part-css.ts`), which is always the **first** class of a row, column or block wrapper. Ids are uuids, or the fixed ids of the default header, footer and product layout (`header-row`, `header-menu-button`, `product-media`, …). | `PART_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\|(?:header\|footer\|product)(?:-[a-z]+)+)$/` |
| **Anchor** | What a click is stored against. In order:<br>1. A product card (`li.product-card`) **inside** a part: `{partId}/c{n}`, n = its 0-based place among that part's cards (below 100).<br>2. The nearest element (itself or an ancestor) whose first class is `kz-{id}` with an id matching `PART_ID`: `{partId}`.<br>3. A product card in no part: `@card:{L}:{n}`, L = its list's 0-based place among the page's card lists (below 10).<br>4. `@header` (the closest `header`), `@footer`, `@main`.<br>5. Otherwise `@body`.<br><br>The server accepts only `^(@body\|@header\|@footer\|@main\|@card:\d:\d{1,2}\|<PART_ID>(/c\d{1,2})?)$`, at most 60 characters. | `ANCHOR` |
| **Cell** | Where inside its anchor's box a click fell. `cx = floor(10 × (clientX − left) / width)` and `cy = floor(10 × (clientY − top) / height)`, each clamped to 0..9, from `getBoundingClientRect()` at click time. | `CELLS = 10` |
| **Click** | Every trusted primary-button `click` outside `[data-kz-private]` gives exactly one verdict, and so one cell. | — |
| **Candidate click** | A click with no Ctrl, Meta, Shift or Alt whose target is none of `input`, `textarea`, `select`, `option`, `label`, `[contenteditable]`, `canvas`, `video`, `audio`, `embed`, `object`, `iframe`, `html`, `body`, and not inside `[data-kz-no-deadclick]`. The same element again within 1000 ms is not a new candidate. Only a candidate can be dead. | `REPEAT_MS = 1000` |
| **Dead click** | A candidate after which **nothing happened** within 2500 ms. "Something happened" is any of:<br>- a counted mutation at or after the click's `pointerdown`;<br>- a scroll within 300 ms;<br>- a selection change within 100 ms;<br>- focus moving (`focusin`) within 1000 ms;<br>- the tab hidden, blurred or left (`visibilitychange`, `blur`, `pagehide`) within 1000 ms;<br>- the URL changing within 2500 ms.<br><br>The verdict comes 2500 ms after the click. A click still waiting when its view is summarised is **not** dead. | `DEAD_AFTER_MS = 2500`, `SCROLL_ALIVE_MS = 300`, `SELECTION_ALIVE_MS = 100`, `FOCUS_ALIVE_MS = 1000` |
| **Counted mutation** | A `MutationObserver` record of type `childList` or `characterData`, or of type `attributes` with a name other than `style` and not starting with `data-fx` (the motion runtime writes those as the pointer moves, `src/lib/motion-runtime.ts`), whose target is not inside `[data-kz-ambient]` (things that move by themselves). | `AMBIENT_SELECTOR` |
| **Rage click** | A run of at least 3 clicks, each at most 1000 ms after the one before it, and each within 30 CSS px (straight line) of the run's first click **or** on the same element.<br>- The run breaks on a scroll or a selection change.<br>- Text-like targets (an `input` of a text type, `textarea`, `[contenteditable]`, `select`) and anything inside `[data-kz-no-rage]` never start or join a run.<br>- The click that completes a run of 3 carries `rage: true` with the anchor and cell of the run's **first** click.<br>- It is "rage and dead" when any click of the run was judged dead. | `RAGE_COUNT = 3`, `RAGE_GAP_MS = 1000`, `RAGE_RADIUS_PX = 30` |
| **Scroll reach** | Per view: `reach = min(100, floor(100 × maxBottom / maxHeight))`. `maxBottom` is the largest `scrollY + innerHeight` seen during the view, and `maxHeight` the largest `document.documentElement.scrollHeight`. Sampled on scroll (at most every 200 ms), on resize and on each attention tick. If `maxHeight ≤ innerHeight`, reach is 100. It is stored in 5 % buckets, `floor(reach / 5)`, 0..20. | `REACH_BUCKETS = 21` |
| **Reached b %** | Over a period: page views whose bucket is at least `b/5`, divided by all page views. The view shows 25, 50, 75 and 100 %. | — |
| **Fold** | At the first measurement after load: `round(1000 × innerHeight / scrollHeight)`, capped at 1000 (per mille). **Average fold** = sum of folds ÷ page views, shown as a percentage of the page. | — |
| **Attention** | Per view, time is kept in 50 px bins of the page, at most 400 bins, so the first 20,000 px. A tick runs every 250 ms while the tab is visible and the visitor gave input (pointer, key, wheel, touch or scroll) in the last 15 s. On a tick, each bin whose middle line is inside `[scrollY, scrollY + innerHeight]` **in this tick and in the one before** gets 250 ms. That drops fly-by scrolling.<br><br>When the view's first (seq-0) summary is built, `H = min(maxHeight, 20000)` is **fixed** and kept in the view's state (`attH`). Every later summary of the view uses the same H, even if the page has grown since. H is split into **20 bands** of `H/20`. A band's value is the **mean** of the bins whose middle line falls in it; if none does, it is the bin under the band's middle line. So it is the time a strip of that band was on screen, whatever the page's height. Each band is capped at 120,000 ms per view. A continuation sends `max(0, band − sent)` per band. The seq-0 summary sends `attH = H`.<br><br>Shown **per band** as seconds per page view: the band's ms, summed over days and devices, ÷ page views. Also shown as share of time: ms(band) ÷ Σ ms of all bands. | `BIN_PX = 50`, `MAX_BINS = 400`, `TICK_MS = 250`, `IDLE_MS = 15000`, `BANDS = 20`, `BAND_CAP_MS = 120000` |
| **Frustration (page)** | Page views with at least one dead or rage click (`frustrated_views`, counted once per view), divided by page views. | — |
| **Recording** | One browser tab's visit while the visitor is sampled. It starts on the first allowed page, and continues across soft navigations and full loads in that tab; it pauses on pages that are not allowed. It ends after any of:<br>- 30 min without input;<br>- 60 min in all;<br>- 4 MB uploaded;<br>- 200 segments;<br>- 50 pages.<br><br>Nothing is uploaded until it has lasted 5 s and had one interaction. | `REC_IDLE_MS = 1_800_000`, `REC_MAX_MS = 3_600_000`, `REC_MAX_BYTES = 4_194_304`, `REC_MAX_SEGMENTS = 200`, `REC_MAX_PAGES = 50`, `REC_MIN_MS = 5000` |
| **Sampling** | When a tab's recording session starts: recorded if `Math.random() × 100 < recording_share`, kept for the tab's session. | `RECORDING_SHARES = [10, 25, 50, 100]`, default 50 |
| **Minimum volume** | A map needs at least 30 page views in the period; otherwise it shows "N of 30 page views so far". **Where visitors get stuck** lists pages with at least 30 page views. A/B behaviour figures need at least 100 page views per version. The A/B flag needs at least 2,000 page views per version and z ≥ 3.29. | `MIN_MAP_VIEWS = 30`, `MIN_VERSION_VIEWS = 100`, `FLAG_VERSION_VIEWS = 2000` |
| **Retention** | Recordings 30 days. Page totals 396 days (13 months). Click cells 90 days. Pictures 400 days after they were taken. | `RECORDING_KEEP_DAYS = 30`, `HEAT_KEEP_DAYS = 396`, `CELL_KEEP_DAYS = 90`, `SHOT_KEEP_DAYS = 400` |

**Why these numbers.**

- **Dead click.** 2500 ms is PostHog's mutation threshold (`posthog-js` `dead-clicks-autocapture.ts`). It sits between OpenReplay
  (1234 ms) and Sentry (3000 ms). Clarity publishes no number.
- **Rage click.** 3 clicks within 1 s each is what most tools use (PostHog, Datadog, Contentsquare, OpenReplay). The 30 px radius is
  PostHog's.
- **Scroll reach.** This is PostHog's `max_content_percentage`, kept in Clarity's 5 % steps.
- **Attention.** This is Clarity's and Mouseflow's "time on screen". The fly-by gate is our 250 ms tick, close to Contentsquare's
  published 150 ms.
- **Retention.** Clarity keeps recordings 30 days and heatmaps 13 months. The CNIL says "a few months" at most for recordings.
- **The A/B flag.** It counts page views, not visitors, and page views from one visitor are not independent, so its z test is
  overconfident. That is why it only flags, and why it asks for 2,000 page views per version and z ≥ 3.29 (the orders guardrail's
  level).

---

## 4. Privacy and the law

This is not legal advice. The research is summarised here; the questions for a lawyer are in section 12.

1. **Consent is required for both.**
   - EDPB Guidelines 2/2023 (paras 33, 44, 53): JavaScript that sends what it reads on the device is "access" under ePrivacy
     Art. 5(3), with or without cookies.
   - Norway's ekomloven § 3-15 (in force 1 Jan 2025) has only two exemptions, and analytics is neither.
   - The CNIL (October and November 2026) says replay is never strictly necessary.
2. **Recordings get their own purpose.** The CNIL's recommendation (§5.1 and §5.2) wants replay as a specific purpose, plus a short
   mention of replay of its own on the banner's **first** layer. Datatilsynet: consent is normally invalid if a visitor cannot say yes
   or no to each purpose.
3. **Aggregate heatmaps under Statistics** need the Statistics wording to name them, and visitors asked again. Whether one Statistics
   choice may cover them is lawyer question Q2.
4. **The A/B link changes nothing legally.** A/B tests already enrol only visitors who accepted Statistics (D148), and behaviour per
   version is kept as totals.
5. **Roles.**
   - The store is the controller and Kaizena Flow its processor.
   - Kaizena Flow never uses store recordings for its own purposes: no benchmarks across stores, no model training, no product
     analytics. If it did, it would become a joint controller (CNIL §3.2, citing Fashion ID).
   - For kaizenaflow.com, Kaizena Flow is the controller.
6. **Measures** (from the CNIL's annex for the UX purpose):
   - random sampling (L1);
   - masking by default (M0); input values are never collected, not even their length (M3);
   - a random id per tab (I1), with coarse times;
   - passwords and bank data never collected (S1);
   - access by role (S2, here owner only);
   - individual recordings can be deleted;
   - kept a few months at most (here 30 days).
7. **Withdrawal stops recording at once,** in the open page, without sending anything more. It deletes the recordings the browser can
   name (CNIL §6.2). Older recordings cannot be tied to the person by design (GDPR Art. 11), and they expire after 30 days.
8. **Sensitive stores and children.**
   - Stores selling health, sexual-wellness, religious or political goods could record special-category data (CJEU C-252/21 and
     C-21/23).
   - Datatilsynet advises strongly against tracking on services aimed at children.
   - So switching recordings on asks the owner to confirm the store is neither, and that its privacy policy says recordings are made.
9. **The platform's legal texts are hand-written by the owner, never by a model** (`src/lib/platform-legal/en.ts:3-7`).
   - The DPA's types of personal data (`en.ts:288`) need "interaction and recording data".
   - Kaizena Flow's own privacy notice needs a sentence.
   - **This plan does not edit `src/lib/platform-legal/*`.** Step 13 lists the points for the owner.
10. **A DPIA.** Replay meets WP248's "systematic monitoring". `docs/dpia-recordings.md` is drafted **in step 10, before the recordings
    switch exists**, as a draft for the owner and a lawyer in the shape of `docs/dpia-ai.md`. It covers kaizenaflow.com (where Kaizena
    Flow is controller) and serves as a template for stores. It records the "balanced" masking default as the documented alternative
    measure to M0 (Q7).

### 4.1 Words shoppers read (drafts)

Step 1 writes these in en, nb, sv and da, each flagged for legal review.

| Where | English draft |
|---|---|
| Banner, first layer, shown while recordings are on | "This shop can record your visits to its pages (what the page shows, your clicks, taps, scrolling and pointer movement) to find what is hard to use. What you type is never recorded." |
| Category `recordings`: name and text | **"Recordings of your visit"**: "Records the shop's pages as you saw them, your clicks, taps, scrolling and pointer movement, which test version you saw and roughly when, so the shop can see what is hard to use. Not on the cart, checkout, account or order pages; never what you type. Kept 30 days." |
| Category `statistics` while heatmaps are on | "Count visits and show how the site is used, including totals of where visitors click, how far they scroll and how long parts of a page are on screen (heatmaps), also per test version, so we can improve it." |
| Cookies page paragraph (heatmaps) | "Heatmaps: while you allow statistics, your browser sends which parts of a page you click, how far you scroll and how long parts of the page are on your screen, and which test version you saw. Only totals per page and day are kept, with no number that identifies you." |
| Cookies page paragraph (recordings) | "Recordings: while you allow recordings, the shop records what happens on its pages in this tab: the page as it was shown, your clicks, taps, scrolling and pointer movement, your screen size and the test version you saw. Everything you type, the chat, the cart, the checkout and your account are left out. A random number for this tab ties the recording together; it is never joined to who you are. The shop is responsible for the recordings; Kaizena Flow keeps them for it, in Ireland, for 30 days. You can withdraw at any time under Cookie settings, and delete the recordings this browser made: [Delete my recordings]" |

---

## 5. How it works

### 5.1 The picture

```
 Visitor's browser (a store page, after consent)                     Kaizena Flow (dub1)                 Supabase (eu-west-1)
 ┌────────────────────────────────────────────────┐
 │ MarketExtras → <SiteSignals> (lazy, idle; the  │
 │   market layout draws extras off the pay routes)│
 │  ├─ click watch ── dead / rage verdicts ───┐   │
 │  ├─ heat collector (scroll reach, attention,│  │ 1. one summary per page view
 │  │   clicks by anchor and cell, A/B tags)   ├──┼──── sendBeacon ────▶ /api/signals/heat ──▶ page_heat_days (daily totals)
 │  │                                          │  │                      checks: same site,     click_cells   (daily totals)
 │  └─ recorder (rrweb, sampled tabs only) ◀───┘  │                      consent, store, tags
 │      gzip segments, timestamps from 0          │ 2. segments
 │      ──────────── fetch POST ──────────────────┼────────────────────▶ /api/signals/rec ───▶ recordings (one row per recording)
 │  ab-shown registry ◀── AbMarker (D148)         │                                          ──▶ bucket `recordings` (gzip files)
 │  on withdrawal: ids ── sendBeacon ─────────────┼────────────────────▶ /api/signals/forget ─▶ deletes rows and files
 └────────────────────────────────────────────────┘

 Admin (owner)
 ┌────────────────────────────────────────────────┐                     page-looks cron (every minute, Chromium)
 │ Heatmaps: picture + canvas overlay ◀───────────┼── signed URL ──────── bucket `page-maps` ◀── runMapShots(): one browser per shot,
 │   + table of parts                             │                      page_map_shots (layout) ◀─ the store's widths, measures parts
 │ Recordings: list ─▶ player (@rrweb/replay) ◀───┼── events route: audit first, then gunzip and sanitise the events, owner only
 │ A/B results: Behaviour per version (totals)    │
 └────────────────────────────────────────────────┘
```

A drawn version is `docs/heatmaps-and-recordings.svg`.

### 5.2 Two streams, on purpose

| | Heat summary | Recording segments |
|---|---|---|
| **Who** | Every consenting visitor on allowed pages. Never sampled: sampling would bias the A/B rates. | Sampled tabs of visitors who accepted recordings |
| **Code in the browser** | About 6 KB of our own, loaded when idle | Plus rrweb's recorder, about 23 KB gzip, loaded only for a sampled tab |
| **Sent** | One small JSON summary per view (at most 8 KB), by `sendBeacon` | Gzip segments by `fetch`; the tail by `sendBeacon` |
| **Kept** | Added to daily totals, with no visitor id | Files in a private bucket, plus one row per recording |
| **Personal data** | No | Yes (pseudonymous) |

### 5.3 What the server trusts

Nothing from the browser is trusted as it arrives.

- **The forget route checks only `sameSite()` and its budget** (section 8.3): withdrawal and deletion must work whatever the store's
  state.
- **The heat and rec routes check:**
  - same site (`sameSite()`);
  - the request comes from the store's own page (`fromStoresOwnPage()`);
  - no robots (`isBot()`) and no GPC or DNT (`wantsPrivacy()`);
  - the store is open (`getOpenStore()`) and its switch is on;
  - a private store's visitor is not locked out (`lockedOut()`).
- **Consent** is read again from the consent cookie on the server.
- **A/B tags** are checked against the visitor's own `kaizen_ab_{storeId}` cookie and the store's running tests.
- **Page keys** are worked out on the server from the raw path by `placeOfPath()`.
- **Recorded DOM is treated as hostile HTML.** It is sanitised on the way to the player, which draws it in rrweb's sandboxed frame,
  which never runs scripts. That page also sends an enforced CSP for pictures, fonts and media.

### 5.4 Names (use exactly these)

| What | Name |
|---|---|
| Storefront component that runs everything | `SiteSignals` in `src/components/signals/site-signals.tsx`; lazy wrapper `src/components/lazy/site-signals.tsx` |
| Browser modules (DOM bindings) | `src/components/signals/click-watch.ts`, `heat-collector.ts`, `session-recorder.ts`, `forget.ts` |
| Pure modules (no DOM, no zod, browser-safe) | `src/lib/page-heat.ts`, `src/lib/click-signals.ts`, `src/lib/heat-collect.ts`, `src/lib/heat-anchor.ts`, `src/lib/signal-paths.ts`, `src/lib/ab-shown.ts`, `src/lib/recording.ts` |
| Pure modules for the server and admin | `src/lib/heat-read.ts`, `src/lib/replay-sanitize.ts`, `src/lib/map-measure.ts` (runs inside the shot's page), `src/lib/map-shoot.ts` (the Playwright steps) |
| Server modules | `src/server/page-heat.ts` (ingest and prune), `src/server/page-heat-read.ts` (reads), `src/server/signal-tags.ts` (cookies and A/B tags), `src/server/recordings.ts` (ingest, forget, delete, prune, seal), `src/server/recordings-read.ts`, `src/server/recording-files.ts` (bucket), `src/server/map-shots.ts` |
| Routes | `/api/signals/heat`, `/api/signals/rec`, `/api/signals/forget` (new folder `src/app/api/signals/`) |
| Buckets | `recordings` (private, gzip), `page-maps` (private, JPEG) |
| Tables | `commerce.page_heat_days`, `commerce.click_cells`, `commerce.page_map_shots`, `commerce.recordings` |
| Store columns | `heatmaps`, `recordings`, `recording_share`, `recording_mask`, `recordings_confirmed_at` |
| Platform column | `platform_settings.recordings_open` |
| Consent | category `recordings`; version token `heat` |
| Storage items (browser) | `kaizen_replay_{storeId}` (session storage, the tab's recording session), `kaizen_replay_ids_{storeId}` (local storage, ids for deleting) |
| DOM marks | `data-kz-private` (blocked in recordings; no clicks collected), `data-kz-mask` (text masked), `data-kz-ambient` (moves by itself), `data-kz-no-rage`, `data-kz-no-deadclick`. All are unused today (checked 16 Nov 2026). |
| Admin message areas | `heatmaps` (`src/lib/admin-messages/heatmaps.{en,nb}.ts`), `recordings` (`…/recordings.{en,nb}.ts`) |
| Limit and metric | limit `recordings_month`, metric `recordings` |
| Retention kind | `recordings` |
| Audit actions | `analytics.heatmaps`, `analytics.recordings`, `analytics.recording_viewed`, `analytics.recording_deleted`, `analytics.map_shot_requested`, `platform.recordings_open_set` |

---

## 6. Data

### 6.1 Store columns (step 1)

Write them in `src/db/schema.ts` beside `visitCounting` (`visit_counting`), then run `pnpm db:generate`:

```sql
alter table commerce.stores
  add column heatmaps boolean not null default false,
  add column recordings boolean not null default false,
  add column recording_share smallint not null default 50,
  add column recording_mask text not null default 'balanced',
  add column recordings_confirmed_at timestamptz;
-- checks (in the Drizzle table): recording_share in (10, 25, 50, 100); recording_mask in ('balanced', 'strict')
```

- `stores` is not a hot table, so plain checks are fine.
- Read the columns into `Store` (`src/server/stores.ts`, where `visitCounting` is read at three places): `heatmaps`, `recordings`,
  `recordingShare` and `recordingMask`.
- Every writer refreshes the store's tag (`store-writers.scan.test.ts`).

### 6.2 Heat totals (step 3)

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
  att_height_sum bigint not null default 0, -- Σ attH of seq-0 views (pages taller than 20,000 px)
  clicks integer not null default 0,
  dead_clicks integer not null default 0,
  rage_clicks integer not null default 0,
  dead_views integer not null default 0,
  rage_views integer not null default 0,
  frustrated_views integer not null default 0,
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

**Tags.**

- `tag = ''` holds **every** visitor. A tag `{experiment id}:{version}` holds that version's visitors **as well**.
- So a tagged view is written once with `''` and once per tag. At most 5 tests run per store.
- **Every read of totals filters `tag = ''`**, except the version reads (section 8.5).

**Adding arrays.** Two SQL functions add arrays element by element. They go in a custom migration (step 3) and are used in the upsert,
as `set reach = commerce.add_int_arrays(page_heat_days.reach, excluded.reach)`:

```sql
create function commerce.add_int_arrays(a integer[], b integer[]) returns integer[]
  language sql immutable parallel safe set search_path = ''
  as $$ select array_agg(x + y order by i) from unnest(a, b) with ordinality as t(x, y, i) $$;
create function commerce.add_bigint_arrays(a bigint[], b bigint[]) returns bigint[]
  language sql immutable parallel safe set search_path = ''
  as $$ select array_agg(x + y order by i) from unnest(a, b) with ordinality as t(x, y, i) $$;
```

**Row-level security.** Append `alter table … enable row level security;` for both tables. Drizzle does not write it, and
`commerce.test.ts` fails without it.

**Lists.**

- `COPY_RULES`: `never("a copy counts its own")`.
- `NOT_PERSONAL` (`src/lib/personal-data.ts`), with a reason: totals per page and day, no visitor.
- `STORE_EXPORT_LEFT_OUT` with reason `record` (`src/lib/store-export-scope.ts`).

**Retention.** Code constants (`HEAT_KEEP_DAYS`, `CELL_KEEP_DAYS`), like `SPEED_KEEP_DAYS`, pruned daily. Not personal data, so no
retention kind.

**Writes per beacon.** Three statements (plus the reads named in section 2, item 5):

- one daily `chat_usage` slot;
- one upsert of `page_heat_days`;
- one upsert of `click_cells`.

Each upsert is a single statement for all its rows (`insert … select … from unnest(…) order by <primary key> on conflict … do
update`). Ordering the rows avoids deadlocks between beacons.

### 6.3 Pictures under heatmaps (step 6)

```sql
create table commerce.page_map_shots (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references commerce.stores(id) on delete cascade,
  page text not null check (char_length(page) between 1 and 300),
  device text not null check (device in ('mobile','tablet','desktop')),
  tag text not null default '' check (tag = '' or tag ~ '^[0-9a-f-]{36}:[a-d]$'),
  status text not null default 'waiting' check (status in ('waiting','taking','done','failed')),
  requested_at timestamptz not null default now(),
  claimed_until timestamptz,
  shot_at timestamptz,
  width integer, height integer,           -- the picture, in CSS px
  layout jsonb,                            -- MapLayout (section 9.2), at most 3000 anchors
  problem text check (char_length(problem) <= 200),
  unique (store_id, page, device, tag)
);
create index page_map_shots_queue_idx on commerce.page_map_shots (requested_at) where status in ('waiting', 'taking');
```

- **Files.** One picture per row: bucket `page-maps`, path `{storeId}/{id}.jpg`. A new picture overwrites the old (`upsert: true`).
- **Lists.**
  - RLS on.
  - `COPY_RULES` `never`.
  - `NOT_PERSONAL` (a picture of a public page, taken by a robot). This is **the table only**: a bucket that holds no personal data gets
    no register entry. `registerProblems()` refuses `storage:` keys in `NOT_PERSONAL`.
  - `STORE_EXPORT_LEFT_OUT` `record`.

### 6.4 Recordings (step 8)

```sql
create table commerce.recordings (
  id uuid primary key,                     -- made by the browser (crypto.randomUUID)
  store_id uuid not null references commerce.stores(id) on delete cascade,
  day date not null,                       -- the store's day when it started
  started_at timestamptz not null,         -- floored to 10 minutes, never exact
  last_at timestamptz not null,            -- floored to 10 minutes
  duration_ms integer not null default 0 check (duration_ms between 0 and 3600000),
  device text not null check (device in ('mobile','tablet','desktop')),
  width smallint, height smallint,         -- viewport at the start, rounded to 10 CSS px
  entry_page text not null check (char_length(entry_page) between 1 and 300),
  pages text[] not null default '{}' check (cardinality(pages) <= 50),
  clicks integer not null default 0,
  dead_clicks integer not null default 0,
  rage_clicks integer not null default 0,
  tags text[] not null default '{}' check (cardinality(tags) <= 5),
  mask text not null check (mask in ('balanced','strict')),
  seqs smallint[] not null default '{}' check (cardinality(seqs) <= 200), -- the segment files that exist
  segments smallint not null default 0 check (segments between 0 and 200),
  bytes integer not null default 0 check (bytes between 0 and 4194304),
  sealed boolean not null default false,   -- segments merged into one file
  seal_tries smallint not null default 0,
  viewed_at timestamptz                    -- first watched by the owner
);
create index recordings_store_started_idx on commerce.recordings (store_id, started_at desc);
create index recordings_started_idx on commerce.recordings (started_at);
create index recordings_unsealed_idx on commerce.recordings (last_at) where not sealed;
```

**Files.**

- Each segment: bucket `recordings`, path `{storeId}/{recordingId}/{seq}.gz`, with `seq` written as three digits (`000`…`199`).
- After sealing (step 10), one file `{storeId}/{recordingId}/all.gz`; the segments are removed.
- `pathsOf(row)` = the `all.gz` path when sealed, otherwise one path per entry of `seqs`.
- As a belt, forget, delete and prune also `list("{storeId}/{id}/")` (at most 201 objects) and remove everything found, so a file left
  by a race never outlives its row.

**Platform hold.** Add `recordings_open boolean not null default false` to `platform_settings` (in `src/db/schema.ts`, beside
`domainsOpen`).

**Lists.**

- RLS on; `COPY_RULES` `never`.
- `PERSONAL_DATA`:

  ```ts
  entry("recordings", "pseudonymous", none, ["entry_page", "pages", "width", "height", "tags"], null, "none", REASON, { until: "recordings" })
  entry("storage:recordings", "pseudonymous", none, ["files"], null, "none", REASON, { until: "recordings" })
  ```

  - `REASON`: "A recording of one browser tab's visit, under a random id with coarse times. It holds no name or contact detail, but
    could be linked to a person by its context, so it is personal data; it cannot be found from a person (GDPR Art. 11) and is deleted
    after 30 days, or at once by the visitor's browser."
  - Add the Norwegian reasons in `src/lib/personal-data.nb.ts`.
  - **Never** add these to the exceptions in `personal-data.test.ts`.
- `PURPOSE_OF.recordings` and `PURPOSE_OF["storage:recordings"]`: a new purpose `recordings` with basis "a" (consent), in
  `src/lib/personal-purposes.ts`, shaped like `analytics`.
- `STORE_EXPORT_LEFT_OUT` with reason `record`.
- **The retention kind.** `recordings` in `RETENTION_KINDS`, with `RETENTION_SEED` 30 days and
  `enforcedBy: "pruneRecordings() (RECORDING_KEEP_DAYS)"`. Add a label in `src/lib/admin-messages/privacy.{en,nb}.ts`
  `retention.kinds.recordings`: "Recordings of visits" / "Opptak av besøk". `KIND_LABELS` is a `Record` over all kinds, so the build
  fails without it.
- **Metering:**
  - `USAGE_METRICS.recordings = { kind: "counter", unit: "count", source: "database" }`;
  - a line in `counters()` (`src/server/usage-meter.ts`) counting the day's new recordings per store;
  - `LIMITS.recordings_month = { metric: "recordings", period: "month", enforce: "hard", scope: "store" }`;
  - a `case "recordings":` in `liveValue()` (`src/server/limits.ts`) that returns
    ``first(sql`select count(*)::int as value from commerce.recordings where store_id = ${storeId}::uuid and started_at >= ${month}`)``,
    served by `recordings_store_started_idx`;
  - **leave `measuredPlusLive()` and its `ran` CTE untouched**. Wiring recordings through it while also counting from the month's start
    would count days twice;
  - `{ metric: "recordings", key: "recordings_month" }` in `OWNER_LINES` (`src/server/usage.ts`);
  - words in `m.plans.limitNames` (en, nb, sv, da) and in the `capacity` admin catalogue (en, nb).
- **Not in `storage_bytes`.** Recordings do not count toward it; leave `storage_bytes_by_store()` alone, because the owner does not
  choose these bytes.
- **Generated checks.** The checks built from `RETENTION_KINDS`, `USAGE_METRIC_IDS` and `LIMIT_KEYS` are **generated by Drizzle**
  (`src/db/schema.ts`). Never widen them by hand. Step 8 says the order.

### 6.5 Buckets (custom migrations in steps 6 and 8)

Copy the guarded insert of `supabase/migrations/20261111172842_baseline_4_roles_and_supabase.sql:44-62`: `DO $$ … IF EXISTS
(select 1 from pg_namespace where nspname = 'storage')`, then `insert into storage.buckets … on conflict do nothing`. Plain Postgres
and PGlite skip it.

| Bucket | public | file_size_limit | allowed_mime_types |
|---|---|---|---|
| `page-maps` | false | 8388608 (8 MB) | `{image/jpeg}` |
| `recordings` | false | 5242880 (5 MB, above `REC_MAX_BYTES`, so a sealed file fits) | `{application/gzip}` |

- Add both to `docs/security.md` §2.1.
- Say in the decision that they must be folded into `baseline_4` at the next quarterly squash (`docs/ci-migrations.md`).
- **No bucket exists outside Supabase.** CI and local builds run without Storage, so every server function that touches files takes an
  injectable `files` dependency (section 8.2), and the tests use a fake.

---

## 7. The browser side

### 7.1 Mounting

**Where:** in `MarketExtras` (`src/app/s/[store]/[market]/extras.tsx`), in a Suspense of its own, beside the consent banner:

```tsx
{(store.heatmaps || store.recordings) && (
  <Suspense fallback={null}>
    <SiteSignals
      store={{ id: store.id, slug: store.slug, heatmaps: store.heatmaps, recordings: store.recordings,
               share: store.recordingShare, mask: store.recordingMask }}
      breakpoints={breakpointsOf(store.theme.settings)}
    />
  </Suspense>
)}
```

`breakpointsOf()` is pure (`src/lib/breakpoints.ts`), and `MarketExtras` already has the cached `store`. `MarketExtras` stays
synchronous.

**Why there, and not in `layout.tsx`:**

- The market layout draws `MarketExtras` inside `<OffPayRoutes>`, which draws nothing on the cart, checkout and order.
- `pay-routes.graph.test.ts` follows **static and dynamic** imports from the market layout, with `extras.tsx` as its only door. It also
  requires every entry of `FORBIDDEN_ON_PAY_ROUTES` to be reached from `extras.tsx`.
- So add `components/signals/site-signals`, `components/signals/session-recorder`, `components/signals/heat-collector` and
  `components/signals/click-watch` to `FORBIDDEN_ON_PAY_ROUTES` (`src/lib/pay-routes.ts`), and mount **only** here. Do not touch
  `layout.tsx`.

**Rules for the mount:**

- **No request-time reads.** The flags come from the cached `Store`; never read `cookies()` or `headers()` here.
- **The lazy wrapper** (`src/components/lazy/site-signals.tsx`) copies `src/components/lazy/touch-keeper.tsx`:
  `whenIdle(lazyView(dynamic(() => import("../signals/site-signals").then((m) => m.SiteSignals))))`.
- **`OffPayRoutes` unmounts `SiteSignals` while the cart drawer is open** (the pathname becomes `/cart`). Section 7.3 keeps the heat
  view open across that, and section 7.4 pauses and resumes the recorder.
- **Kaizena Flow's site:** while `site_from_store` is on, its pages are the house store's, under this same layout, and need nothing
  more.

### 7.2 `SiteSignals` (`"use client"`, draws `null`)

1. **Opted out.** If `optedOut({ globalPrivacyControl, doNotTrack, windowDoNotTrack, msDoNotTrack })` (`src/lib/visit-beacon.ts`; build
   the argument from `navigator` and `window` as `src/components/visit-beacon.tsx` does) is true, do nothing at all.
2. **Staff.** If `staffPath(store.slug) !== null` (`src/components/back-to-admin.tsx`), do nothing.
3. **Consent.** Read the consent cookie with `decodeConsent()` (`src/lib/cookie-consent.ts`), as `src/components/ab/ab-assign.tsx` does,
   and listen for `CONSENT_CHANGED_EVENT`.
   - `heatOn = store.heatmaps && choices.statistics && versionHas(version, "heat")`
   - `recOn = store.recordings && choices.recordings`
4. **Leftover ids.** On mount, if `choices.recordings` is not true and `kaizen_replay_ids_{storeId}` has entries, call
   `forgetRecordings(storeId)`. This catches a withdrawal made while this component was not listening.
5. **The page.** `signalPlace(window.location.pathname, window.location.search, store.slug)` from `src/lib/signal-paths.ts` (section 7.6)
   gives `{ heat, rec }` or null. `usePathname()` is only the trigger that the page changed; the path is always read from
   `window.location`, because the router's path can be the internal one behind a host rewrite.
6. **Start only what may run.**
   - The click watch runs while `(heatOn && place.heat) || (recOn && place.rec)`, and is stopped otherwise.
   - The heat view runs while `heatOn && place.heat`.
   - The recorder runs while `recOn && place.rec`, through `await import("./session-recorder")`, so rrweb is never in the first scripts.
7. **When the pathname changes.** A pathname change must end the view, but an unmount (the drawer opening) must keep it, and a single
   effect's cleanup cannot tell the two apart. So use **two effects**:
   1. `useLayoutEffect(() => onPage(window.location.pathname), [pathname])`, with **no cleanup**. `onPage` ends the kept view (its final
      summary) only when the view's path differs from the new one. It then starts or continues the view, and starts, pauses or resumes
      the recorder (section 7.4). The recorder also guards itself.
   2. A mount-only `useEffect(() => () => onUnmount(), [])`. Its cleanup sends the heat continuation, sends the recorder's tail, then
      pauses the recorder.

   Never end the view in a cleanup.
8. **When the tab is hidden** (`visibilitychange` to hidden): summarise the heat view and flush the recorder's segment.
9. **Consent withdrawn.** Import `forget.ts` statically, and in the listener, with no `await`:
   - call `discard()` on the heat view and on the recorder, which drops buffered data **without sending it** and aborts uploads in flight
     with an `AbortController`;
   - if `recordings` was withdrawn, call `forgetRecordings(storeId)`;
   - remove the component's `visibilitychange` and `pagehide` listeners.

   `ConsentManager.decide()` dispatches `CONSENT_CHANGED_EVENT` and then calls `location.reload()` in the same task, so all of this must
   be synchronous. `sendBeacon` survives the reload.
10. **Errors.** Catch and swallow every error. Measuring is never worth an error in a visitor's browser.

### 7.3 The heat collector

**The pure parts live in `src/lib/heat-collect.ts`.** They use no DOM, so they can be unit tested in Node (Vitest here has no DOM):

```ts
export type ReachState = { maxBottom: number; maxHeight: number; fold: number | null };
export function reachStep(s: ReachState, m: { scrollY: number; innerHeight: number; scrollHeight: number }): ReachState;
export function reachBucket(s: ReachState, innerHeight: number): number; // 0..20

export type AttentionState = { bins: number[]; lastVisible: Set<number> | null; sentBands: number[]; attH: number | null }; // attH fixed at seq 0
export function attentionTick(s: AttentionState, m: { scrollY: number; innerHeight: number; active: boolean; visible: boolean }): AttentionState;
export function attentionBands(s: AttentionState, maxHeight: number): { bands: number[]; attH: number }; // 20 ints ≤ BAND_CAP_MS
```

**The view's own state** (`HeatView`, kept in a **module-level variable** in `heat-collector.ts`, so it outlives the component):

- At the start it captures `path` (`location.pathname`), `device` and `startedAt`, and an empty `tags` set.
- **The first tags come a tick later.** The view's first tags are taken in a `setTimeout(…, 0)` scheduled when the view starts. That
  runs after React's passive effects, so the previous page's `AbMarker` has already unregistered and the new page's has registered. A
  copy taken in the layout effect would carry the previous page's test into this view. The recorder's `kz-ab` follows the same rule.
- `tags` only grows: each `AB_SHOWN_EVENT` adds its pairs while `location.pathname` still equals the view's `path`. Nothing is ever
  removed during the view.
- Every summary of the view uses these captured values. **Ending a view never reads `location`, never calls `reachStep()` and takes
  no new measurement**, because the screen already shows the next page.
- **Drawer continuity.** When `SiteSignals` unmounts (the cart drawer opened), send a continuation and keep the view. When it mounts
  again and `location.pathname` equals the kept view's `path` within 30 minutes, continue the view. Otherwise end the kept view and
  start a new one.

**The summary** (`HeatBody`, built by `heatBody()` in `src/lib/page-heat.ts`). It is at most 8,000 bytes; past that, clicks are dropped
from the end:

```ts
type HeatBody = {
  v: 1;
  store: string;                 // slug
  path: string;                  // the view's captured pathname, never a query
  seq: number;                   // 0 = the view's first summary; 1.. = continuations
  device: "mobile" | "tablet" | "desktop";
  reach?: number;                // 0..20 bucket: seq 0 only
  fold?: number;                 // 0..1000 per mille: seq 0 only
  attH?: number;                 // the height attention covers, px: seq 0 only
  att: number[];                 // 20 ints, ms added since the last summary of this view
  clicks: [anchor: string, cx: number, cy: number, dead: 0 | 1, rage: 0 | 1][]; // new since the last summary, at most 60
  dv: 0 | 1;                     // first dead click of this view, since the last summary
  rv: 0 | 1;                     // first rage click of this view, since the last summary
  fv: 0 | 1;                     // first dead-or-rage click of this view, since the last summary
  ab: [experiment: string, version: string][]; // the view's tags, at most 5
};
```

**Sending.**

- Use `navigator.sendBeacon("/api/signals/heat", new Blob([JSON.stringify(body)], { type: "text/plain" }))`. A same-origin beacon
  carries the cookies, which the server needs for consent and the A/B tags.
- **When a summary is sent:**
  - on `visibilitychange` to hidden;
  - on `pagehide`, which also ends the view;
  - on a pathname change, which ends the view;
  - on unmount, as a continuation that keeps the view.

  A `pageshow` with `event.persisted` starts a new view at seq 0.
- **Before building a summary,** call `judge.flush(now)` so pending clicks go in as not dead.
- **seq** advances only after `sendBeacon` returned `true`. A view whose visible time is below `MIN_VIEW_MS` sends nothing and keeps
  seq at 0.
- **Continuations** carry only new attention (bands minus `sentBands`), new clicks and new flags. `views`, `reach`, `fold` and `attH`
  count only at seq 0; reach gained after the first summary is lost (accepted, and said in the decision).

### 7.4 The recorder (`src/components/signals/session-recorder.ts`)

**The tab's session** lives in `sessionStorage` `kaizen_replay_{storeId}`:

```ts
{ v: 1, id, seq, sampled, started, lastInput, pages, qualified }
```

- A new session (a new `crypto.randomUUID()`, sampling decided once by `sessionFor()` in `src/lib/recording.ts`) starts when there is
  none, when `lastInput` is older than `REC_IDLE_MS`, or when `started` is older than `REC_MAX_MS`.
- `sampled: false` means nothing is ever recorded in this tab session. A server answer of 410 sets it too.

**rrweb.**

- Dependencies: `@rrweb/record`, `@rrweb/replay` and `@rrweb/types`, **pinned exactly** to the same version (`pnpm add -E`).
- Use `2.2.0` (24 Oct 2026) unless a newer 2.2.x has been out two weeks; `2.2.2` came out on 9 Nov 2026.
- Record with `recorderOptions(mask, isTouch)` from `src/lib/recording.ts` (pure, unit tested):

```ts
{
  maskAllInputs: true,
  maskInputOptions: { password: true },
  maskInputFn: () => "",                 // not even the length of what was typed
  maskTextSelector: mask === "strict" ? "*" : "[data-kz-mask]",
  blockSelector: "[data-kz-private]",
  slimDOMOptions: "all",
  inlineStylesheet: true,
  inlineImages: false,
  collectFonts: false,
  recordCanvas: false,
  recordCrossOriginIframes: false,
  sampling: { mousemove: isTouch ? 150 : 50, scroll: 150, media: 800, input: "last" },
  errorHandler: () => true,              // swallow; count in a module variable
}
```

**`emit(event)` guards every event before it is buffered:**

1. If `signalPlace(location.pathname, location.search, slug)?.rec` is not true, **drop this event and pause**. History is already
   updated when rrweb emits a new page's mutations, so this sees the new path even before React's effects run. Every event already in
   the buffer was checked while an allowed path was current, so pausing keeps them.
2. For an event of type 4 (Meta), set `data.href = location.origin + location.pathname`. No query string and no fragment.
3. Set `event.timestamp = event.timestamp − session.started`. Times are relative to the session's start; the exact clock time never
   leaves the browser.

**Pause and resume.**

- **Pause:** send what is buffered, as a segment by fetch, or as a tail of at most 60,000 bytes when the page is going away. Then call
  rrweb's `stop()` and clear the module's "recording" flag. Only a consent withdrawal (section 7.2, item 9) discards the buffer without
  sending it.
- **Resume** (an allowed page again, or `SiteSignals` mounting again after the drawer): call `record()` again. That gives a new full
  snapshot, with the same session id and the next seq.
- Guard `record()` with the module flag so React's double effects cannot start two recorders.

**Custom events** (`record.addCustomEvent`):

- `kz-page` `{ path }` on each allowed page;
- `kz-click` `{ dead, rage, x, y }` for the timeline;
- `kz-ab` `{ tags }` when the page's tags change.

**Segments.**

- Events are buffered in memory.
- The session qualifies once it is `REC_MIN_MS` old **and** has had one interaction.
- After that, upload:
  - **at once whenever the buffer holds a full snapshot** (type 2);
  - otherwise every 30 s.
- A segment is `JSON.stringify({ v: 1, meta, events })`, gzipped with
  `new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"))`, and POSTed:

  ```
  fetch(`/api/signals/rec?store={slug}&id={id}&seq={seq}&z=1`,
        { method: "POST", body: gzipBlob, headers: { "Content-Type": "application/gzip" }, signal })
  ```
- `meta` is `{ device, w, h, pages: [path, …] (new since the last segment), clicks, dead, rage, ab }`. It has no clock time.
- How the recorder handles each answer:

  | Answer | What the recorder does |
  |---|---|
  | 204 | Continue |
  | 410 | Stop for this tab session (`sampled: false`) |
  | 429 or 503 | Drop this segment and continue. If the dropped segment held a full snapshot, call `takeFullSnapshot()` before the next one. |
  | 400 | Stop (our bug; log nothing to the visitor) |

  **seq advances only after a 204.** After a 429 or 503, the next segment reuses the same seq. If the dropped segment held a full
  snapshot, the next one starts with `takeFullSnapshot()`. Gaps in `seqs` then come only from a tail sent by `sendBeacon`, whose answer
  is never known. This matters because the row is created only by seq 0.

**The tail** is sent when the tab is hidden, and when the recorder pauses because `SiteSignals` unmounts (not when a page is refused):

- If the raw JSON is at most 60,000 bytes, `sendBeacon` it with `&z=0` as `text/plain`.
- Otherwise drop it; if the page stays open, call `takeFullSnapshot()` before the next segment.
- The 64 KiB keepalive budget is shared by every beacon of the page.

**Caps.** Stop and flush at `REC_MAX_SEGMENTS`, at `REC_MAX_BYTES` uploaded, at `REC_MAX_PAGES`, or when more than 20,000 events wait
in the buffer (a runaway page).

**Ids for deleting.**

- **Before** a recording's first upload (fetch or beacon), add `{ id, until: started + 31 days }` to `localStorage`
  `kaizen_replay_ids_{storeId}`.
- Keep at most 50 entries, and drop expired ones on each write.
- This is how a visitor can later delete their recordings.

### 7.5 The click watch

**The pure part** is `src/lib/click-signals.ts`, a judge with an injected clock that knows no DOM:

```ts
export type ClickInput = {
  at: number; downAt: number | null; x: number; y: number; targetId: number;
  candidate: boolean; rageable: boolean; anchor: string; cx: number; cy: number;
};
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
  flush(now: number): Verdict[];    // everything pending, none dead
}
```

**What the judge decides:**

- Every click yields exactly one `Verdict`, and only a candidate can be dead.
- A counted mutation at or after a click's `downAt` (its `pointerdown`, if within 1000 ms) makes it alive. This covers dropdowns that
  close on `pointerdown` (`src/components/dropdown.tsx`) and suggestions that act on `mousedown` (`search-box.tsx`).
- **Rage runs.** The verdicts of a running run are held until its last click has its own verdict.
  - The click that completes a run of `RAGE_COUNT` carries `rage: true`, with the run's first click's anchor and cell.
  - `rageAndDead` is true when any click of the run was judged dead.
  - `flush()` releases held verdicts with `dead: false`.

**The DOM part** is `src/components/signals/click-watch.ts`:

- **Listeners.** Capture-phase, passive listeners for `pointerdown`, `click`, `scroll` (on `document` in capture, so element scrolls
  count), `selectionchange`, `focusin`, `visibilitychange`, `blur` and `pagehide`.
- **Input.** Each event becomes the judge's input. `targetId` is a number kept per element in a `WeakMap`.
- **Anchor and cell** come from `anchorOf()` in `src/lib/heat-anchor.ts`. It takes a plain chain of
  `{ firstClass, tag, isProductCard, cardIndexInPart, listIndex, cardIndexInList }` from the target upward, so it is testable. The
  DOM layer builds that chain and takes the anchor element's `getBoundingClientRect()`.
- **One `MutationObserver`** on `document.documentElement` (`subtree, childList, attributes, characterData`), armed at `pointerdown` and
  kept while a click is pending. It filters records by the counted-mutation rule and disconnects when nothing is pending.
- **Ticks.** It calls `tick()` every 250 ms while something is pending.
- **Private parts.** Clicks inside `[data-kz-private]` are ignored entirely.

### 7.6 Allowed pages in the browser (`src/lib/signal-paths.ts`)

**Why a twin.** `placeOfPath()` cannot be imported into the browser: `visit-record.ts` imports zod and page-content, which
`storefront-bundle.scan.test.ts` forbids. This file is a zod-free **allow-list that mirrors `landingOf()` and `speedKind()`**. The
server stays the authority.

```ts
export function signalPlace(pathname: string, search: string, storeSlug: string): { heat: boolean; rec: boolean } | null
```

**The rule:**

1. Drop `/s/{storeSlug}` in front, when present.
2. If the first segment matches `new RegExp(`^${MARKET_PARAM}$`)`, drop it. `MARKET_PARAM` is exported from `src/lib/pay-routes.ts`
   (pure, and already in the storefront bundle through `isPayPath()`).
   - It covers `no` and `no-en-eur`, a marketless store's (D181) `en`, `eur` and `en-eur`, and `~…` version tokens.
   - On a marketless store, a page slug of two or three letters is dropped as if it were a market. The twin then allows a little more
     than the server, which is fine: the server stays the authority.
3. Allow **only** these remaining shapes:

   | Shape | What it is |
   |---|---|
   | `[]` | the front page |
   | `[p, handle]` | a product page |
   | `[category\|tag, slug]` | a category or tag |
   | `[products]` | the product list |
   | `[blog]` | the blog list |
   | `[blog, slug]` | a blog post, the slug not in `RESERVED_ARTICLE_SLUGS` |
   | `[search]` | the search page: `{ heat: true, rec: false }` |
   | `[slug]` | the store's own page, the slug not in `RESERVED_STORE_PAGE_SLUGS` and not in `PRIVATE_ROUTES` |

   Everything else is null.
4. If `search` has a `q` parameter, `rec` is false; `heat` may stay true.

The twin copies the lists it needs: `PRIVATE_ROUTES`, `RESERVED_STORE_PAGE_SLUGS` and `RESERVED_ARTICLE_SLUGS`. Export
`PRIVATE_ROUTES` from `src/lib/visit-record.ts` so the test can compare.

**The test** (`src/lib/signal-paths.test.ts`) holds a table of paths and asserts two things:

- `signalPlace` **never refuses** a path that `speedKind(placeOfPath(...).landing)` keeps;
- it **refuses every** path with a `PRIVATE_ROUTES` segment.

The table includes `/no/p/x`, `/no/category/x`, `/no/blog/x`, `/no/blogs/a/b`, `/no/a/b`, `/no/withdraw`, `/no/returns/t`,
`/no/cookies`, `/no/cart`, `/no/account/orders` and `/s/demo/no/checkout`. For a store in one country it also has `/p/shirt`, `/eur/p/x`,
`/en-eur/category/y` and `/` (a marketless front page). The test also asserts that the copied lists equal the real ones.

### 7.7 DOM marks to add to storefront components (step 4)

| Mark | Add it to | Why |
|---|---|---|
| `data-kz-private` | **Chat:** the panel and launcher roots (`src/components/chat-widget.tsx`, `[data-chat-panel]`, `[data-chat-launcher]`)<br>**Cart drawer:** its `dialog` (`cart-drawer.tsx`)<br>**Forms:** `site-form.tsx`, `back-in-stock.tsx`, `quote-request.tsx`, `product-question.tsx`, `gift-card-buy.tsx`, `custom-fields-view.tsx`, `appointment-picker.tsx`, `blog-comment-form.tsx`, newsletter forms, `discount-code-form.tsx`, `gift-card-form.tsx`, `vat-number-field.tsx`, `affiliate-field.tsx`, `delivery-choice.tsx`<br>**Search:** the search box's suggestion list (`search-box.tsx`, the `role="listbox"`), the search section's results region (`search-section.tsx`), the domain search's results (`domain-search-box.tsx`)<br>**Pictures:** review pictures (`[data-review-pictures]`, `review-item.tsx`) and Google review photos (`google-reviews-section.tsx`)<br>**Payments:** the express checkout area and Klarna's message on product pages (`docs/pci.md`, `ExpressArea`, `KlarnaMessage`)<br>**Consent:** the banner and its choices (`consent-manager.tsx`) | Personal data, typed text, or echoes of typed text |
| `data-kz-mask` | **On the list's root, not per item** (so items added by *Show more* are covered too): the reviews list (`product-reviews.tsx`), the blog comments list, Google review names | Text written by people |
| `data-kz-ambient` | `countdown-view`, `stats-view` (animated numbers), `brands-carousel` (marquee), `carousel` when it autoplays, `video-view`, `animation-view` | They change the DOM by themselves, which would make every click look alive |
| `data-kz-no-rage` | Quantity steppers, carousel arrows, the product gallery's arrows, size and colour pickers (`Dropdown` options) | People press them quickly on purpose |

- Find each component with `grep -rn "<name>" src/components` before adding the mark.
- Add `src/components/signals/marks.test.ts`, which renders a few of them with `renderToString` and checks the attribute, including the
  reviews list root and a review picture.

---

## 8. The server side

### 8.1 `/api/signals/heat` → `recordHeat()` (`src/server/page-heat.ts`)

**The route** copies `src/app/api/visit/speed/route.ts` exactly, but with `MAX_BYTES = 8000`:

- `connection()`;
- `sameSite()`, otherwise 403;
- the declared and the real byte caps, otherwise 413;
- `JSON.parse`, otherwise 400;
- `recordHeat({ headers: request.headers, body })` inside a try, with `log("warn", "heat.record_failed", {}, error)`;
- always an empty 204 with `no-store`.

**`recordHeat({ headers: h, body, now })`** runs these steps in this order (the order of `recordSpeed()`):

1. **Shape.** `heatInput` (zod, in the server module, never in the browser) `safeParse`, otherwise `invalid`:
   - arrays of their lengths;
   - numbers in their ranges;
   - anchors matching `ANCHOR`;
   - at most 60 clicks and at most 5 `ab` pairs.
2. **Robots and privacy.** `isBot(h.get("user-agent"))` gives `bot`; `wantsPrivacy(h)` gives `privacy`.
3. **Store.** `getOpenStore(slug)` gives `unknown_store`. `!store.heatmaps` gives `off`. `await lockedOut(store)` gives `locked`.
4. **Own page.** `fromStoresOwnPage({...})`, exactly as in `recordSpeed()`, gives `wrong_site`.
5. **Consent.** `cookieValue(h.get("cookie"), consentCookieName(store.id))`, then `decodeConsent()`. It needs `choices.statistics` and
   `versionHas(version, "heat")`, otherwise `no_consent`.
6. **Page.** `placeOfPath(path, …)`, then `speedKind(landing)`. Null gives `not_measured`.
7. **Daily slot.** Bucket `heat`, `HEAT_BEACONS_PER_STORE_DAY = 50_000`, shaped like `takeSpeedSlot()`; otherwise `store_full`. There
   is no `takeBudget`, as the speed beacon has none.
8. **Tags.** `verifiedTags(store.id, input.ab, h.get("cookie"))` (section 8.4).
9. **Upserts.** One upsert of `page_heat_days` for the rows `['', ...tags]`. One upsert of `click_cells` for the same tags, with equal
   cells summed first in code. Both insert their rows ordered by primary key (section 6.2).

### 8.2 `/api/signals/rec` → `recordSegment()` (`src/server/recordings.ts`)

**The route.**

- `MAX_BYTES = 1_048_576`, `export const maxDuration = 30`.
- The query is parsed with zod: `store`, `id` (a uuid), `seq` (an integer 0..199) and `z` (0 or 1).
- The body is read as bytes (`arrayBuffer()`).

**Answers** (each empty and `no-store`):

| Answer | Meaning |
|---|---|
| 204 | Kept |
| 410 | Stop recording this tab |
| 400 | Invalid |
| 413 | Too big |
| 429 | Over budget |
| 503 | Our failure, so the client drops the segment |

**Dependencies.** Every exported function in `recordings.ts` takes `deps: { files?: RecordingFiles | null } = {}`, defaulting to
`recordingFiles()`, as `src/server/reviews.ts` takes `deps.storage`. When `files` is null (no Storage, as in CI):

- `recordSegment` answers 503 and writes nothing;
- `forgetRecordings`, `deleteRecording`, `pruneRecordings` and `sealRecordings` change nothing, leave the rows and log
  `recordings.no_storage`, so no file ever outlives its row;
- the forget route still answers 204.

**Steps:**

1. Not `sameSite()`: 403. `isBot(user-agent)` or `wantsPrivacy(h)`: 410.
2. Store checks: `getOpenStore`, then `store.recordings`, then `lockedOut`, then `fromStoresOwnPage`. Any failure gives 410.
3. Consent: the consent cookie's `choices.recordings === true` (read with `cookieValue()`), otherwise 410.
4. `takeBudget(store.id, "rec", budgetVisitor(h))`, with `rec` in `FAIL_CLOSED`. Over budget gives 429.
5. Decompress. If `z=1`: `gunzipSync(bytes, { maxOutputLength: 16 * 1024 * 1024 })` from `node:zlib`; on error, 400. If `z=0`, the
   body is the JSON, and it is gzipped server-side before storing.
6. Parse and check with zod `segmentBody`:
   - `v: 1`;
   - `meta` as in section 7.4;
   - `events`: 1 to 50,000, each `{ type: int 0..6, timestamp: number, data?: unknown }`;
   - timestamps in `[0, REC_MAX_MS + 60_000]` (they are relative).

   Failure gives 400. Then rewrite every type-4 event's `data.href` to its origin plus pathname, in case a forged client skipped it.
7. Pages: each `meta.pages[]` path goes through `placeOfPath`, then `speedKind`, and must not be the search page. Otherwise 410: the
   recorder should have paused, so nothing is kept.
8. If `seq = 0`:
   - `platform_settings.recordings_open` or `store.house`, otherwise 410;
   - `checkLimit(store.id, "recordings_month", 1)`, memoised per store for 60 s in the module, like `aiMemo` in `src/server/limits.ts`;
   - a daily slot (bucket `recordings`, `RECORDINGS_PER_STORE_DAY = 2_000`).

   Over any of them gives 410. Otherwise insert the row with `started_at` and `last_at` = now floored to 10 minutes, `day`, `device`,
   width and height rounded to 10 px, `entry_page`, `mask` = the store's, and `on conflict (id) do nothing`. A conflicting id that
   belongs to another store gives 410.
9. `verifiedTags(...)`.
10. **Upload** `gzipSync(JSON.stringify(body))`, built from the validated and rewritten body. **Never upload the bytes as received**,
    for z=0 or z=1, or the server-side strip of step 6 never reaches the stored file. `$size` in step 11 is that buffer's length.
    - The path is `recordings/{storeId}/{id}/{seq3}.gz`, with `contentType: "application/gzip"` (the bucket allows only that type).
    - `files.upload()` returns `"ok" | "exists" | "failed"`. It is `"exists"` when the error has `statusCode === "409"`, or
      `status === 409`, or a message matching `/already exists|duplicate/i`; any other error is `"failed"`, answered 503.
11. **One conditional update** (it names `store_id`):

    ```sql
    update commerce.recordings set
      seqs = array_append(seqs, $seq), segments = segments + 1, bytes = bytes + $size,
      last_at = <now floored>, duration_ms = least(3600000, greatest(duration_ms, $maxTs)),
      pages = <pages with the new keys appended, the last not repeated, at most 50>,
      clicks = clicks + $c, dead_clicks = dead_clicks + $d, rage_clicks = rage_clicks + $r,
      tags = (select coalesce(array_agg(t order by t), '{}') from (select distinct t from unnest(tags || $newTags) t limit 5) x)
    where id = $id and store_id = $store and not sealed and segments < 200
      and bytes + $size <= 4194304 and not ($seq = any(seqs))
    returning 1
    ```

    - If it returns a row, answer 204.
    - If not: when `$seq` is already in `seqs`, it is a duplicate, so answer 204. Otherwise remove the file just uploaded and answer
      410.
    - If the upload said `"exists"` and `$seq` is in `seqs`, answer 204 without updating.

### 8.3 `/api/signals/forget` → `forgetRecordings()`

**The route:**

- The body is `text/plain` JSON `{ store, ids: uuid[] (≤ 51) }`, at most 4,000 bytes.
- It checks `sameSite()` and `takeBudget(…, "forget", …)`.
- There is **no consent check**: withdrawal must work after withdrawal.
- It deletes the rows `where store_id = $1 and id = any($2)`, removes `pathsOf(row)` plus everything `list()` finds under each id's
  folder, and always answers 204.

**The browser side** is `forgetRecordings(storeId)` in `src/components/signals/forget.ts`:

- it reads `kaizen_replay_ids_{storeId}`, **plus** the id in `kaizen_replay_{storeId}`;
- it sends one beacon;
- it clears both storage keys.

It is used on withdrawal and on mount (section 7.2), and by the *Delete my recordings* button on the Cookies page (step 9).

### 8.4 Cookies and A/B tags (`src/server/signal-tags.ts`)

```ts
export function cookieValue(header: string | null, name: string): string | undefined   // decodeURIComponent of the value
export async function verifiedTags(storeId: string, claimed: readonly [string, string][], cookieHeader: string | null): Promise<string[]>
```

**`cookieValue`** splits the `Cookie` header on `; ` and **URI-decodes** the value. Next's cookie jar percent-encodes the A/B cookie's
`=` and `,`, and `decodeAssignments()` (`src/lib/experiments.ts`) rejects the encoded form. A grep found no existing parser
(`grep -rn "function readCookie\|parseCookie" src/lib src/server`); if one exists by then, use it.

**`verifiedTags`** reads `kaizen_ab_{storeId}` with `cookieValue()` and `decodeAssignments()`. It keeps a claimed pair only if all of
these hold:

- the cookie's version for that test equals the claimed version;
- the version is not `0` (outside the test);
- the test is in `runningExperiments(storeId)`.

It returns the **distinct** `"{experimentId}:{version}"` strings, sorted.

**`runningExperiments()`:** `signal-tags.ts` imports it from `src/server/experiments.ts`. `beacon-imports.scan.test.ts` reads only the
route file's own imports, and `lockedOut()` already brings `next/headers`, so nothing forbids it. **Do not move it.** Its memo is shared
with `storeIdOfSlug()` and cleared by `forgetRunning()`, which starting and stopping a test call.

**Never** store the A/B visitor id: it leads to `experiment_carts`, then to orders, then to the customer.

### 8.5 Reads for the admin

**`src/server/page-heat-read.ts`.** Each read filters with `owned(storeId)` and runs through `setBased()` with `checkedRows()` and
`col`, as heavy analytics reads do (`src/server/analytics-totals.ts`, `docs/rules/admin/marketing.md`). Arrays are added in code with
helpers from `src/lib/heat-read.ts`.

- **`heatPages(storeId, { from, to, device? })`**, with `tag = ''`. Per page key: views, `frustrated_views`, `dead_views`, `rage_views`,
  clicks, and the average reach (from the histogram). Used by **Where visitors get stuck** and the list by views.
- **`pageHeat(storeId, { page, device, tag = '', from, to })`**, with `tag = $tag`. It returns:
  - the summed reach histogram, the fold average, the attention sums and `att_height_sum`;
  - views and the frustration counts;
  - the click cells summed over days (`group by anchor, cx, cy`), limited to the last `CELL_KEEP_DAYS`.
- **`versionBehaviour(storeId, experimentId)`**, with `where tag like $experimentId || ':%'`, summed over **every page** with that tag
  (a header test spans every page). Per version key: views, the share reaching 50 %, and the dead, rage and frustrated view shares.
- **`taggedTests(storeId, page)`**: the tests with tagged rows for a page (for the version chips, step 12).

**`src/lib/heat-read.ts`** (pure):

- `reachedShares(hist)` gives 21 shares; `reachLines(shares)` gives the deepest band reached by 75 %, 50 % and 25 % of views;
- `foldPercent(foldSum, views)`;
- `attentionSeconds(bands, views)`;
- `frustrationRank(rows, MIN_MAP_VIEWS)`;
- `projectCells(cells, layout)` gives the points `{ x, y, weight }` plus `missing` (clicks whose anchor is not on the picture);
- `frustratedVersion(rows)`: the A/B flag (step 12).

**`src/server/recordings-read.ts`:**

- **`listRecordings(storeId, filters, page)`**, 50 at a time.
  - The order is "most frustrated first" (`order by rage_clicks + dead_clicks desc, started_at desc, id`) or newest first.
  - Filters: device, page key (`= any(pages)`), has rage, has dead, tag (`tags @> array[$tag]`) and period.
- **`recordingEvents(store, id, deps)`**:
  - downloads `all.gz`, or the segments in `seqs` order;
  - gunzips each with `maxOutputLength`;
  - concatenates the `events` arrays;
  - returns `sanitizeEvents(events, { storeOrigins: storeOrigins(store.slug), supabaseOrigin: new URL(publicEnv().NEXT_PUBLIC_SUPABASE_URL).origin })`
    (`storeOrigins` from `src/lib/paths.ts`, `publicEnv` from `src/lib/public-env.ts`);
  - when there are no files (`seqs` empty and not sealed), returns `[]` without touching `files`.

### 8.6 Sanitising recorded events (`src/lib/replay-sanitize.ts`, pure)

Recorded events are whatever someone posted to an open endpoint. rrweb's player keeps scripts off only because of its iframe sandbox:
it rebuilds `onerror` and other `on*` attributes as they were. So the server sanitises the events before the player gets them.

```ts
export function sanitizeEvents(events: unknown[], allowed: { storeOrigins: string[]; supabaseOrigin: string }): unknown[]
```

It is a deep walk over every object in the events: full snapshots, mutations, style rules and everything else.

**1. Which URLs survive.** A URL is kept only if it is one of these:

- a Supabase public-storage URL (`{supabaseOrigin}/storage/v1/object/public/…`), kept as it is;
- an asset path on a store origin (or relative): `/_next/static/`, `/demo/`, `/kaizen/`, `/api/fonts/`, `/api/instagram/`. It is
  **rewritten to the path alone** (relative), so it loads from the admin's own origin, where those paths are served too
  (`src/lib/store-hosts.ts` `SHARED`);
- `data:image/…`, or `#…`.

Every other URL becomes `""`. That includes anything under `/admin` or another `/api`, the platform's other pages, other hosts, and
`javascript:`.

**2. Attributes.** For an object with an `attributes` key whose value is a plain object:

- delete keys matching `/^on/i`, plus `srcdoc` and `ping`;
- if `http-equiv` is present, delete `http-equiv` and `content`;
- apply rule 1 to **every attribute value that starts with a scheme, `//` or `/`**;
- split `srcset` and `imagesrcset` on commas and check each candidate;
- `rr_dataURL` may stay only as `data:image/…`.

**3. Strings** (including `_cssText`, style rules, style declarations and the text of `<style>` nodes):

- first decode CSS escapes (`\75 rl(` is `url(`) and match without regard to case;
- treat the arguments of `url(…)`, `image-set(…)`, `-webkit-image-set(…)` and `@import "…"` / `@import url(…)` as URLs;
- if a disallowed URL remains in a declaration or rule, drop that whole declaration or rule.

**Tests** feed it, at least:

- `<img src="https://evil.example/x" onerror=…>`;
- `<meta http-equiv=refresh>`;
- `style="background:url(https://evil.example)"`;
- `\75 rl(https://evil.example)` and `URL(https://evil.example)`;
- `image-set("https://evil.example" 1x)` and `@import "https://evil.example/a.css"`;
- `imagesrcset` and `rr_dataURL`;
- a store's `/_next/static/…css` (kept and made relative), a Supabase public picture (kept as is), and an
  `https://{store}/admin/x` image (blanked).

**The player page also sends an enforced CSP.** Add `replayRouteHeaders(themesOrigin, { supabaseUrl })` to `src/lib/csp.ts`, returning:

```ts
[{ source: "/admin/:store/analytics/recordings/:id", headers: [{ key: "Content-Security-Policy",
   value: `frame-ancestors 'self'${themesOrigin ? ` ${themesOrigin}` : ""}; img-src 'self' data: blob: ${supabase}; font-src 'self' data: ${supabase}; media-src 'self' blob: ${supabase}` }] }]
```

Spread it in `next.config.ts` `headers()` **right after** `...baseRouteHeaders(...)`.

- In Next, a later header entry with the same key **replaces** an earlier one on a path both match. That is why the value repeats the
  admin's `frame-ancestors 'self'`: without it, any site could frame the player page.
- It sets no `script-src` or `style-src`, so the admin's own scripts and styles are untouched.
- The replay frame is `about:blank`, and it inherits the policy.

Add a `csp.test.ts` case asserting that the player path's policy contains `frame-ancestors 'self'` and `img-src`. Step 11's e2e checks
that the page logs no CSP errors of its own.

### 8.7 Jobs

**Daily prunes.** In `src/app/api/cron/subscription-reminders/route.ts`, add these to `dailyPrunes` with
`tracked("daily.<name>", 86400, …)`:

- **`daily.heat`:** `pruneHeat()` deletes `page_heat_days` older than `HEAT_KEEP_DAYS` and `click_cells` older than `CELL_KEEP_DAYS`,
  set-based, with `with d as (delete … returning 1) select count(*)`.
- **`daily.recordings`:** `pruneRecordings({ deadline }, deps)`. It takes expired rows (`started_at < now() − 30 days`) in batches of
  200, removes their files (`remove()` takes at most 1000 paths per call; plus the `list()` belt), then deletes the rows, and stops at
  the deadline.
- **`daily.map-shots`:** `pruneMapShots()` deletes rows and files older than `SHOT_KEEP_DAYS`.

The prunes run for every store **whatever its status**. `src/server/cron-prunes.scan.test.ts` checks a fixed list of older daily names;
adding the new ones to it is optional.

**Sealing (step 10).** A job in the five-minute dispatcher (`src/app/api/cron/cart-reminders/route.ts`, `runJobs`), with the exact
line shape the scan counts: four spaces, a camelCase key, and the comment on the line above.

```ts
    // Merges a finished recording's segments into one file: each Storage object is a Postgres row (D656).
    sealRecordings: () => sealRecordings({ deadline: Date.now() + 60_000 }),
```

Then add one to `DISPATCHER_JOBS` in `src/server/cron-prunes.scan.test.ts`.

`sealRecordings()`:

1. **Choose** with `where not sealed and segments > 1 and seal_tries < 3 and last_at < now() - interval '45 minutes' order by last_at
   limit 50`, using the partial index. The 45 minutes are `REC_IDLE_MS`, plus the 10-minute floor of `last_at`, plus 5 minutes, so a
   session that can still send is never sealed.
2. **For each recording:**
   - increment `seal_tries` (naming `store_id`);
   - download the segments in `seqs`, gunzip them, concatenate the events, gzip, and upload `all.gz`;
   - then `update … set sealed = true where id = … and store_id = … and not sealed and seqs = $readSeqs returning 1`.
3. **If no row comes back** (deleted, or a late segment arrived), remove the `all.gz` just made and skip.
4. **Otherwise** remove exactly the segment files it read.
5. **Failures.** A failure is logged and skipped for the rest of the run.
6. **An idle run** is one select, whatever the number of stores.

**Pictures (step 6).** `runMapShots()` runs inside the page-looks route's `after()`, **after** `runPageLooks()`, with a deadline of its
own (section 9.2).

**Closed stores.** Closing a store deletes nothing and can be undone (D171, `docs/store-closure.md`). A closed store stops collecting
because `getOpenStore()` refuses it, and its data still expires through the prunes above. Nothing is added to `store-closure.ts`.

---

## 9. Pictures under heatmaps (map shots)

### 9.1 Asking for a picture

`requestMapShot(storeId, page, device, tag)` upserts a `waiting` row when any of these holds:

- there is none;
- the one there was taken more than 14 days ago;
- it failed more than an hour ago;
- the owner pressed *Take a new picture*. That is an action guarded by `analytics:write`, audited `analytics.map_shot_requested`.

The heatmap page asks when it opens. While the row is `waiting` or `taking`, it shows "Taking a picture of this page… it takes a minute
or two" and draws `<RefreshWhile seconds={20} />` (`src/components/admin/refresh-while.tsx`). **Do not** write a new component that
calls `router.refresh()`: `router-refresh.scan.test.ts` fails any new admin file that does.

### 9.2 Taking it (`runMapShots()`, `src/server/map-shots.ts`)

**The route.** In `src/app/api/cron/page-looks/route.ts`:

```ts
const started = Date.now();
after(async () => {
  await runPageLooks(deadline, deps);
  // A look already running can end late; never let the shots pass maxDuration (300 s).
  const until = Math.min(started + 270_000, Math.max(Date.now() + 60_000, started + 120_000));
  if (until - Date.now() >= MAP_SHOT_MS) await runMapShots(until, { photograph: browserMapPhotographer, origin });
});
```

**Claiming.** One row at a time, as `claim()` in `src/server/page-looks.ts` does:

```sql
update commerce.page_map_shots set status = 'taking', claimed_until = now() + interval '5 minutes'
where id = (select id from commerce.page_map_shots
            where status = 'waiting' or (status = 'taking' and claimed_until < now())
            order by requested_at limit 1 for update skip locked)
returning *
```

At most 6 shots per run. A shot starts only while `Date.now() + MAP_SHOT_MS <= until`.

**One browser per shot.** A browser reused after a page's context closed can hang for good (D150, `src/lib/replicate-look.ts`). So:

```ts
looking(launchBrowser, MAP_SHOT_MS - LOOK.closeMs, (browser) => shootMap(browser, url, viewport, cookies))
```

`browserMapPhotographer` goes in `src/server/page-look-runner.ts` beside `browserLookPhotographer`. `shootMap()` goes in
`src/lib/map-shoot.ts`, modelled on `shootPage()`. `MAP_SHOT_MS = 60_000`.

**The address.**

- Build the store page's URL the way store looks do (`src/server/page-looks.ts`, the `marketUrl(…)` calls near line 259). A marketless
  store's page key `/{home}/…` maps back to an address with no market; test it.
- **A tag** opens the **same URL** with two extra cookies, so the proxy serves the version exactly as it does for a visitor:
  - `kaizen_ab=1`;
  - `kaizen_ab_{storeId}` = `encodeAssignments({ visitor: "00000000-0000-4000-8000-000000000000", versions: { [experimentId]: version } })`.

  Do not call `variantPath()`. A tag of version `a` needs no cookies.
- A version is served only while its test runs. A tag whose test has stopped keeps its last picture and is never shot again.
- **A private store's shot fails** with the problem "The store is private, so its pages cannot be photographed", as page looks do
  (`src/server/page-looks.ts`). The map view says so instead of drawing.

**The browser context.**

- Viewport: width `typicalWidth(breakpointsOf(store.theme.settings), size)` with size `sm` (mobile), `md` (tablet) or `xl` (desktop)
  (`src/lib/breakpoints.ts`); height `TYPICAL_SCREENS[size].height`. Mobile adds `isMobile: true, hasTouch: true`.
- `reducedMotion: "reduce"`.
- Add the cookie `consent_{storeId}` = `encodeConsent({ visitor: "00000000-0000-4000-8000-000000000000", version, choices: NO_CONSENT })`.
  The version is `consentVersion(categories, extras)`, where `{ categories, extras } = await siteCookies(store.id, store.tracking,
  liveCustomCode(store.customCode))`, the same arguments `SiteConsent` uses. The banner then stays closed and no tool loads.
- Headless Chromium is a robot to `isBot()`, so no visit or heat is counted.
- Add CSS `[data-chat-launcher], [data-kz-private] { visibility: hidden !important }`.

**Settle and measure.**

- Export `settle` from `src/lib/page-look-shoot.ts` (a one-word change) and call it: it makes lazy pictures eager, scrolls through the
  page and waits for fonts and pictures.
- Then evaluate `measureAnchors` from `src/lib/map-measure.ts`. It is a plain function that Playwright can serialise: inside it, use
  only DOM APIs and constants defined inside the function.
- It emits **the same anchor keys as `anchorOf()`** (section 3) for every part wrapper, every product card, `header`, `footer`, `main`
  and `body`. Each anchor's box is in page coordinates, `[x, y, w, h]` rounded to whole pixels.
- It skips boxes of zero size, keeps the first box per key, and keeps at most 3,000.
- It returns `MapLayout = { v: 1, w, h, fold, anchors: Record<string, [number, number, number, number]> }`.

**The picture.**

- `page.screenshot({ type: "jpeg", quality: 70, fullPage: true, clip })`, with height clipped to `MAP_LENGTH_MAX = 10000` px.
- Upload to `page-maps/{storeId}/{id}.jpg` with `upsert: true` and `cacheControl: "0"`.
- Set `status = 'done'`, `shot_at`, `width`, `height` and `layout`.
- On any error, set `status = 'failed'` and a `problem` of at most 200 characters (`lookProblem()`, never a stack), and log it.

**Showing it.** The admin page gets a signed URL (`createSignedUrl(path, 600)`) on the server and passes it to the view.

### 9.3 Drawing (`src/components/admin/analytics/page-map.tsx`, client)

**The overlay.** An `<img>` at the picture's width, scaled to fit the column. Over it, `<canvas>` strips at most 4,096 px tall each
(the iOS canvas limit).

**What it draws, per view:**

- **Clicks:**
  - points from `projectCells()`, kernel radius 24 px at the picture's scale;
  - intensity normalised to the 99th percentile of the weights;
  - colours from the `--chart-seq-0…6` roles, read with `getComputedStyle`;
  - chips: All, Dead, Rage.
- **How far people scroll:**
  - 20 horizontal bands coloured by `reachedShares`;
  - dashed lines labelled "75 % got here", "50 %" and "25 %" (`reachLines`), and "Average fold";
  - bands and lines are drawn over `layout.h` (the full page height) at the picture's scale. Anything below the picture's bottom (it
    stops at 10,000 px) is not drawn, and the table still lists all four shares.
- **Where people look:**
  - 20 bands over the attention height (`att_height_sum ÷ views`, at most the picture's height), coloured against the busiest band;
  - labels such as "4.2 s".

**Behind it** (the analytics rule: every chart has a table):

- clicks: "Parts clicked most" (label, clicks, dead, rage, share);
- scroll: "Reached 25 / 50 / 75 / 100 %" and the average fold;
- attention: the five bands with the most time.

**Labels for anchors** come from `describePart()` (`src/lib/experiment-parts.ts`). Look the part up with `findPart()` in the page's own
published content, the store's header and footer, or the product layout. The loaders are in `src/server/pages.ts`,
`src/server/site-layouts.ts` and `src/server/product-layouts.ts`; use the functions the storefront calls there.

- Landmarks get fixed words: Header, Footer, "Product card 3", "Elsewhere on the page".
- A card inside a part is "Product card 3 in {part label}".
- A part not found is "A part of the page".

---

## 10. Limits and plans

| Limit or ceiling | Value | Where |
|---|---|---|
| `recordings_month` | Hard: over it, the store stops recording, silently. Seeded with the **proposal** Basic 1,000 · Grow 5,000 · Advanced 20,000 · Plus 50,000. The platform admin changes them under Usage and limits. The house store, templates and starters are exempt (`src/server/limits.ts`). | `plan_limits` rows, migration in step 8 |
| New recordings per store and day (abuse backstop) | `RECORDINGS_PER_STORE_DAY = 2_000` | `chat_usage` bucket `recordings` |
| Heat beacons per store and day | `HEAT_BEACONS_PER_STORE_DAY = 50_000` | `chat_usage` bucket `heat` |
| Request budgets | `rec: { window: "minute", visitor: 20, store: 2000 }` (in `FAIL_CLOSED`)<br>`forget: { window: "minute", visitor: 10, store: 600 }` | `BUDGETS`, `src/server/request-budget.ts` |
| Per recording | 200 segments, 4 MB gzip, 60 min, 50 pages | `src/lib/recording.ts` |

**What it costs**, at 100,000 recordings a month of about 400 KB each:

- **Vercel:** about 1 million segment invocations, roughly $6.
- **Supabase Storage:** about 40 GB a month, inside Pro's 100 GB at 30 days' retention.
- **Postgres:** with sealing, one Storage object row (about 2.8 KB) plus one `recordings` row (about 0.5 KB) per recording. That is
  about 330 MB at 100,000 recordings kept for 30 days. The database was 179 MB on 16 Nov 2026, so the plan values are the real brake.
- **Heat totals:** about 250 bytes a row. A store with 200 pages viewed every day on three devices adds about 60 MB a year.

Put these figures in `docs/capacity.md`.

**One plan-comparison row,** "Recordings and heatmaps", in no plan: a custom migration in step 8, with a test copied from
`src/db/redirects-plan-features.test.ts`.

---

## 11. Platform parity

- **kaizenaflow.com is the house store `kaizenaflow` while `platform_settings.site_from_store` is on** (D484). In that case heatmaps and
  recordings work there with no extra code, under `/admin/kaizenaflow/analytics/…`, which the platform team reaches through the house
  role (`HOUSE_ROLE_TEMPLATE`).
  - Before writing the parity row, read `site_from_store` in production (step 13).
  - While it is off, the site is drawn by `PlatformRoot`, which has no `SiteSignals`. The row then says "missing until site_from_store
    is on".
- **Platform routes outside the house store** (sign-up, the theme store, docs, status, the admin) are not in v1:
  - sign-up holds personal data in forms;
  - the admin is staff monitoring (Datatilsynet's DPIA list, item 5) and is never recorded;
  - the theme store and docs are of low value now.

  **The next step,** named in the decision, is heatmaps for the theme store and docs: a nullable `store_id` in `page_heat_days`,
  `click_cells` and `page_map_shots`, and a mount in `PlatformRoot` (`src/components/platform-root.tsx`).
- **Platform admins see counts only.** Recordings per store and month come through the usage metric on Usage and limits. Admins never
  open a store's recordings: the pages are owner-only, and the DPA says so for support conversations (`en.ts:300`). The DPA gets the
  same sentence for recordings (step 13, owner).
- **The platform hold** `recordings_open` is switched on Usage and limits (`/admin/platform/capacity`):
  - `src/app/admin/(gated)/platform/capacity/actions.ts`:
    `recordingsOpenAction = platformAction({ area: "settings", action: "platform.recordings_open_set", answer }, (account) => setRecordingsOpen(account, on))`.
    Only the platform owner role writes `settings`.
  - `setRecordingsOpen()` (server) updates `platform_settings` and audits `platform.recordings_open_set`, shaped like
    `setDomainsOpenToAll()` in `src/server/domain-admin.ts`.
- **Add a row** to `docs/platform-parity.md` (step 13).

---

## 12. Open questions

### For the owner

| # | Question | Before |
|---|---|---|
| O1 | The plan values for `recordings_month`. The proposal is seeded and can be changed under Usage and limits. | Recordings open to stores |
| O2 | The default sampling share: 50 % proposed (10, 25, 50 and 100 offered) | Step 1 (the column's default; after that, only by a migration) |
| O3 | The points for the DPA, the sub-processor note and Kaizena Flow's privacy notice (section 4, item 9), written by the owner | Recordings open to stores |
| O4 | Who may watch recordings: owner only (proposed), or also a role? A role means a new permission key and a migration. | Step 11 |

### For a lawyer

None of these blocks building. Q3, Q6 and Q7 block opening recordings to stores (`recordings_open`); Q2 is worth asking before
heatmaps go to many stores.

| # | Question |
|---|---|
| Q1 | Is the existing cookieless visit beacon compatible with ekomloven § 3-15 as the EDPB reads Art. 5(3)? It reads the path and referrer and sends UTM tags. This was raised by this research, not by this feature. |
| Q2 | May aggregate heatmaps share the Statistics choice with GA4 and A/B tests, or do they need a choice of their own? |
| Q3 | Is a DPIA needed for every store that switches recordings on, or only for large or sensitive stores? Can our template stand in? |
| Q4 | Is deleting what the browser can name, plus Art. 11, enough for erasure and withdrawal with random ids? |
| Q5 | Is a 365-day consent lifetime right for recordings? Clarity treats consent as valid for 9 months. |
| Q6 | Are the owner's confirmations (no children, no sensitive goods) enough, or is a check needed? |
| Q7 | Does showing the store's own text and catalogue pictures unmasked need to be documented as an "alternative measure" to the CNIL's M0? |

---

# Part B: the build

## 13. Steps

Every step also follows section 14. "Docs" lists the files the step must update in the same push.

**Tests that need a store with a switch on.** The demo store's pages are prerendered and its `Store` is cached, so an SQL change to it
never reaches the running server. The e2e specs therefore follow `e2e/performance.spec.ts`:

1. Create a fresh store with `testStore(name)`, or `storePageWith(name, blocks)` when the test needs a page with a picture or a form
   (`e2e/db.ts`).
2. Before the store's first request, run the switch's `update commerce.stores set …` through `testDb()`.
3. Its addresses have no market (D181): `/s/{slug}`, `/s/{slug}/cart`, `/s/{slug}/account`.
4. End a page view with `page.close()`. Headless Chromium does not deliver a beacon sent while it navigates.
5. Assert on the database with `expect.poll`, not on a beacon sent during navigation.
6. **Never change the demo store.**
7. **Part anchors in tests.** `storePageWith()` names rows `row-{n}` and columns `column-{n}`, which `PART_ID` does not match. When a test
   asserts part anchors (step 6's measure spec, any test of a part's clicks), build the page with `storePageRows()` and give every row,
   column and block an id from `crypto.randomUUID()`.
8. **Getting the store.** Both helpers return only the address. Take the slug with `address.split("/")[2]` and run
   `update commerce.stores set … where slug = ${slug}`, as `runningTest()` in `e2e/ab-tests.spec.ts` does.
9. **Signed-in specs** run on `E2E_STORE` (`e2e-shop`), whose switches must never change. Seed its rows (`page_heat_days`,
   `page_map_shots`, `recordings`) with `testDb()` instead. The screens show the data that exists whatever the switch says; the switch
   only stops new collection.

### Step 1: Consent groundwork and store switches (no visible feature yet)

**Goal.** Visitors can be asked about recordings, Statistics can carry heatmaps, and the switches exist. Nothing collects anything yet.
A store with both switches off sends exactly today's banner and cookie.

**Files.**

**`src/lib/cookie-consent.ts`:**

- Add `"recordings"` to `CONSENT_CATEGORIES` and `OPTIONAL_CATEGORIES`, after `marketing`. `NO_CONSENT` gets `recordings: false` and
  `FULL_CONSENT` gets `recordings: true`.
- `encodeConsent()` writes a **fourth bit only when the version names `recordings`**. `decodeConsent()` accepts `[01]{3,4}`; three bits
  mean `recordings: false`.
- Add `CONSENT_EXTRAS = ["heat"] as const` and the type `ConsentExtra`. Change the signature to
  `consentVersion(categories, extras: readonly ConsentExtra[] = [])`: the categories joined with `+`, then the extras
  (`statistics+marketing+heat`).
- Add `versionHas(version, token)`, which splits on `+`.
- Keep the regex `[a-z+]{1,60}`. The longest version, `preferences+statistics+marketing+recordings+heat`, is 48 characters.

**Owner code and cookie notes may not choose `recordings`:**

- Export `CODE_CATEGORIES = ["necessary", "preferences", "statistics", "marketing"] as const` from `src/lib/custom-code.ts`, and type
  `CodeSnippet.category` with it.
- Use it instead of `CONSENT_CATEGORIES` in:
  - `src/lib/custom-code-schema.ts` (`z.enum`);
  - `src/lib/cookie-scan.ts` (the cookie note's `category`);
  - the note's select in `src/components/admin/cookie-scan.tsx`.
- Replace the local constant in `src/components/admin/cookie-settings.tsx` (`CODE_CATEGORIES`, near line 100) with the import.

**Every other user of the categories.** Run
`grep -rn "CONSENT_CATEGORIES\|ConsentCategory\|OPTIONAL_CATEGORIES\|ConsentChoices\|FULL_CONSENT\|NO_CONSENT\|consentVersion(" src e2e`
and decide each hit; `pnpm typecheck` finds the rest. Known places:

- `src/components/consent/consent-manager.tsx`:
  - add `extras?: ConsentExtra[]` (default `[]`) to its props, and build the version with `consentVersion(categories, extras)` (near line
    254);
  - draw the fourth toggle from `categories`;
  - draw `texts.recordingNotice` above the banner's buttons when it is set;
  - refusing stays one press.
- `src/components/consent/site-consent.tsx`:
  - take `{ categories, extras }` from `siteCookies()`;
  - pass `extras` to `consentTexts(lang, locale, categories, extras)` and to `<ConsentManager extras={extras} …/>`;
  - add `recordingNotice: string | null` to `ConsentTexts`. `consentTexts()` sets it when the categories include `recordings`, and swaps
    `categories.statistics.text` for `textHeat` when the extras include `heat`.
- `src/server/cookie-scans.ts`: build the scan's consent cookie with the same `consentVersion(categories, extras)`.
- `src/server/consents.ts`: in `consentRecord`, keep `preferences`, `statistics` and `marketing` required, and add
  `recordings: z.boolean().default(false)`. A three-key body from an older page is then still kept.
- `src/components/admin/cookie-settings.tsx`:
  - widen `categoryList()`'s type;
  - `ConsentLog` drops `CONSENT_EXTRAS` tokens before naming categories;
  - add `recordings` to the admin legal words `cookies.categories` and `categoriesLower` (`legal.{en,nb}`).

**`src/server/site-cookies.ts`:**

- The store facts it reads (`storeFeatures()` gives `facts`) also give `heatmaps` and `recordings`.
- Heatmaps on: add `statistics` to the categories and `heat` to the extras.
- Recordings on: `declaredCookies(…, { recordings: true })` declares the two storage items below, of category `recordings`, which
  brings the category in by itself.
- Return `{ cookies, categories, extras }`.

**`src/lib/known-cookies.ts` and `src/lib/cookie-patterns.ts`:**

- Two entries, with two new optional fields on `KnownCookie`: `recordings?: boolean` (filtered in `declaredCookies()`) and
  `storage?: "local" | "session"`:
  - `kaizen_replay_…`: session storage, `days: null`, category `recordings`. Purpose: "a random number for this tab that ties a
    recording of your visit together".
  - `kaizen_replay_ids_…`: local storage, 31 days, category `recordings`. Purpose: "the numbers of the recordings this browser made, so
    you can delete them".
- Purposes in en, nb, sv and da.
- Patterns `/^kaizen_replay_[0-9a-f-]{36}$/` and `/^kaizen_replay_ids_[0-9a-f-]{36}$/`.
- **The cookie scan** (`reviewFindings()` in `src/lib/cookie-scan.ts`) today matches only cookies against `KNOWN_COOKIES`. Make it also
  match `localStorage` and `sessionStorage` items against entries with the same `storage` kind, so a store with recordings on gets no
  false "undescribed" item.

**The rest of step 1:**

- **`src/db/schema.ts`:** the store columns of section 6.1, then `pnpm db:generate`. Read them into `Store` in `src/server/stores.ts`.
- **`src/server/analytics-settings.ts`:** `setHeatmaps(member, on)` and `setRecordings(member, { on, share, mask, confirmed })`.
  - Both are owner only, called through `storeAction()`.
  - Both `audit(…, "analytics.heatmaps" | "analytics.recordings", { enabled, share, mask })`, then `refreshTag(storeTag(slug))` and
    `refreshTag(cookiesTag(store.id))`. Copy `setVisitCounting()`.
  - `setRecordings` refuses `on: true` unless all three confirmations are ticked, and sets `recordings_confirmed_at`. Its platform-hold
    check comes in step 8.
- **Shopper words in `src/lib/messages/{en,nb,sv,da}.ts` only** (section 4.1): `consentCategories.recordings`, `consentRecordingNotice`
  and `consentCategories.statistics.textHeat`. The consent manager gets its words as props from `consentTexts()`, never from
  `*-browser.ts`.
- **The Cookies page** (`src/components/consent/cookie-policy.tsx`): `heatmaps` and `recordings` paragraphs, shown while each is on.
  They are passed from `CookiesSection` (`src/app/s/[store]/[market]/cookies/cookies-section.tsx`) like `visitCounting`. The *Delete my
  recordings* button comes in step 9.
- **The privacy starter** (`src/lib/legal-starters.ts` and `legal-starters/{en,nb,sv,da}.ts`): items `privacy.purpose.heatmaps` and
  `privacy.purpose.recordings`, added while the facts are on.
- **Legal facts.** Add the facts **only when true**, so a store with both switches off has exactly today's `LegalFacts` and the same
  `factsHash()`. Otherwise the legal AI rewrites every page of every store that uses it:
  - `...(store.heatmaps ? { heatmaps: true } : {})` and `...(store.recordings ? { sessionRecordings: true } : {})`, as optional keys, in
    `src/lib/legal-facts.ts` and `src/server/legal-facts.ts`;
  - the same in the legal writer's settings (`src/lib/legal-writer.ts`).

  Flag every legal text "for legal review" in a comment (`docs/wave-7-storefront.md`).

**Tests:**

- `src/lib/cookie-consent.test.ts`: a three-bit cookie decodes with `recordings: false`; a four-bit cookie round-trips; a version
  without `recordings` encodes three bits; `consentVersion([...], ["heat"])`; `versionHas`.
- `src/server/consents` test: a three-choice body is recorded, with `recordings` false.
- A test that owner code, and a cookie note, with category `recordings` are refused by their schemas.
- A cookie-scan unit test: a scanned `kaizen_replay_<uuid>` session-storage item is known, category `recordings`.
- `siteCookies()` (unit or integration): heatmaps on adds `statistics` and `heat`; recordings on adds the category and the two items;
  both off gives the same result as before.
- A legal-facts test, in `src/server/legal-facts.int.test.ts` or a unit test with `vi.mock("server-only")`. `factsHash()` from
  `src/server/legal-writer.ts` is unchanged for a store with both switches off, and the built facts then have no `heatmaps` or
  `sessionRecordings` key.
- `e2e/cookies.spec.ts`: a fresh store with recordings on (section 13 header) shows the fourth choice and the first-layer notice;
  refusing all sets a cookie whose fourth bit is 0.
- `src/db/commerce.test.ts`: the new store checks.

**Docs:**

- the decision row (D656, step 1);
- `docs/rules/storefront.md` "Cookie consent": the fourth category, the `heat` token, and that owner code and notes cannot choose
  recordings;
- `docs/analytics.md`: a short "Heatmaps and recordings" section pointing here.

**Done when:**

- typecheck, lint, test and `db:check` pass, and the cookie e2e passes locally;
- the demo store's consent cookie and banner are unchanged.

### Step 2: Pure definitions and detectors

**Goal.** All the logic of section 3, in pure modules with tests. Nothing is wired yet. **Step 3 imports these modules, so build this
first.**

**Files** (all pure, browser-safe, no zod, no `server-only`):

- **`src/lib/page-heat.ts`:**
  - the constants of section 3;
  - `deviceClass(innerWidth, bp)`;
  - `HeatBody`, `heatBody()` (caps at 8,000 bytes);
  - `HEAT_ENDPOINT = "/api/signals/heat"`, `REC_ENDPOINT`, `FORGET_ENDPOINT`;
  - `tagOf(experiment, version)`;
  - `ANCHOR`.
- **`src/lib/click-signals.ts`:** `ClickJudge` (section 7.5).
- **`src/lib/heat-collect.ts`:** `reachStep`, `reachBucket`, `attentionTick`, `attentionBands`.
- **`src/lib/heat-anchor.ts`:** `PART_ID`, `anchorOf(chain)`, `cellOf(clientX, clientY, rect)`, `isCandidateTarget(tag, attrs)`,
  `isRageable(tag, type)`.
- **`src/lib/signal-paths.ts`:** `signalPlace()` (section 7.6). Export `PRIVATE_ROUTES` from `src/lib/visit-record.ts`; that is the only
  file outside these that this step changes.
- **`src/lib/ab-shown.ts`:**
  - `showVersion(experiment, version): () => void`;
  - `shownVersions(): [string, string][]`;
  - `AB_SHOWN_EVENT = "kaizen:ab-shown"`, dispatched on `window` when the set changes.

  Guard `typeof window` so it imports safely on the server.
- **`src/lib/recording.ts`:**
  - the recording constants and `recorderOptions(mask, isTouch)`;
  - `sessionFor(stored, now, share, random)`: whether a new session is needed, and whether it is sampled;
  - `timelineMarks(events)`: the player's markers from `kz-page` and `kz-click` events.
- **`src/lib/replay-sanitize.ts`:** `sanitizeEvents()` (section 8.6).
- **`src/lib/heat-read.ts`:** the functions of section 8.5, except `frustratedVersion()`, which step 12 adds with its tests.

**Tests** (one `*.test.ts` per module). At least:

- **`ClickJudge`:**
  - a mutation at 2000 ms makes a click alive; at 2600 ms it is dead;
  - a scroll at 250 ms means alive; at 400 ms it does not count;
  - a mutation between `pointerdown` and `click` makes the click alive;
  - `flush()` never gives dead;
  - three clicks 900 ms apart within 20 px give one rage, carried by the third, with the first click's anchor; 1100 ms apart give none;
  - three clicks on one element are a rage run (the repeat rule does not stop it);
  - a run on a `label` rages but is never dead;
  - a non-rageable target gives no rage;
  - a scroll in the middle breaks the run;
  - rage plus a dead click gives `rageAndDead`;
  - every click gives exactly one verdict.
- **Attention:**
  - on a page of 5,000 px, a band whose bins were all visible for two ticks gets **250 ms** (not 1,250);
  - one tick gives 0;
  - `active: false` adds nothing;
  - the cap holds;
  - a page of 30,000 px gives `attH = 20000`;
  - a page of 600 px still gives a value in every band;
  - the page grows from 2,000 to 4,000 px after seq 0: the continuation's bands are all ≥ 0 and use H = 2,000.
- **Reach:** a page shorter than the window gives bucket 20; maxima are kept across steps.
- **`anchorOf`:**
  - part classes win over landmarks;
  - `kz-page` is not a part;
  - a card inside a part is `{partId}/c{n}`;
  - two card lists in no part give `@card:0:n` and `@card:1:n`;
  - every fixed id in the default layouts of `src/lib/site-layout.ts` and `src/lib/product-layout.ts` matches `PART_ID` (import them and
    walk them; `header-menu-button` and `header-sign-up` are among them).
- **`signalPlace`:** the table of section 7.6, plus `?q=` making `rec` false.
- **`sanitizeEvents`:** the cases of section 8.6.
- **`heatBody`:** it caps at 8,000 bytes by dropping clicks.
- **`recorderOptions`:** it masks inputs to nothing, and strict mode masks all text.
- **Constants:** a test asserts the values of section 3's constants, written as literals in the test.

**Also** a unit test that the part class is the **first** class of `rowBox`, `columnBox` and `blockBox` (`src/components/page-parts.tsx`):
`anchorOf` depends on it.

**Docs.** Write the figure definitions (page view, scroll reach, fold, attention, frustration) into `docs/analytics.md` now. The
analytics rule is that a figure is defined there before it is built.

**Done when:** the tests pass, and nothing outside these files changed except the export in `visit-record.ts`.

### Step 3: Heat tables and the heat route

**Goal.** The server accepts heat summaries and adds them to daily totals.

**Files:**

- **`src/db/schema.ts`:** the tables of section 6.2 (Drizzle), then `pnpm db:generate`.
- **A custom migration** (`pnpm exec drizzle-kit generate --custom --name page_heat_functions`) with the two array functions and the
  `enable row level security` lines, then `node scripts/prune-snapshots.mjs`.
- **`src/server/page-heat.ts`:** `recordHeat()` (section 8.1), `pruneHeat()`, and
  `HeatOutcome = { recorded: true } | { recorded: false; reason }`.
- **`src/server/signal-tags.ts`** (section 8.4).
- **`src/app/api/signals/heat/route.ts`** (section 8.1).
- **`src/server/beacon-imports.scan.test.ts`:** add the route to `BEACONS`.
- **`docs/security.md` §2.11:** a row for `/api/signals`:
  - heat: totals per page and day, no person;
  - rec: recordings of consenting visitors, owner-only;
  - forget: deletes by id.

  `security-routes.scan.test.ts` requires it.
- **Lists:** `src/lib/store-copy-rules.ts`, `src/lib/personal-data.ts` (`NOT_PERSONAL`) and `src/lib/store-export-scope.ts`, as in
  section 6.2.
- **The daily route:** `daily.heat`.

**Tests:**

- **`src/db/commerce.test.ts`:** the checks (array lengths 21 and 20, the tag form, the cell range), the add functions
  (`add_int_arrays('{1,2}', '{3,4}') = '{4,6}'`), and RLS on.
- **`src/server/page-heat.int.test.ts`:**
  - recorded with consent and `heat`;
  - refused for no consent, consent without `heat`, GPC, a robot, the switch off, the wrong site, `/no/cart`, a private store's
    locked-out visitor, and over the daily slot;
  - seq 1 adds attention and clicks but not views or reach;
  - two beacons add up;
  - a tag the cookie does not hold is dropped;
  - a held tag writes both rows: the `tag = ''` row and the tag's row each have `views = 1` (checked with SQL);
  - a duplicated `ab` pair is recorded once;
  - the A/B cookie is set URI-encoded, as Next writes it;
  - `lockedOut()` reads `cookies()` from `next/headers`, not the headers passed in. So mock `next/headers` with a cookie jar, as
    `src/server/private-mode.int.test.ts` does, and set or clear `kaizen_unlock_{storeId}` there for the private-store cases (an unlocked
    visitor is kept).
- **`src/server/page-heat-prune.int.test.ts`:** old rows go and recent ones stay, for an open store and a closed one.

**Done when:**

- the tests pass;
- CI's release job applies the migration;
- the security and performance advisors show nothing new (CLAUDE.md, Database);
- the versions are recorded in the decision.

### Step 4: The collector in the storefront (heatmaps only)

**Goal.** Consenting visitors on stores with heatmaps on send summaries. No store has the switch on yet, so production is unchanged.

**Files:**

- **`src/components/signals/click-watch.ts`, `heat-collector.ts` and `site-signals.tsx`** (sections 7.2, 7.3 and 7.5).
  - Come in step 9: the recorder branch, section 7.2 item 4, and item 9's call of `forgetRecordings()`.
  - Built now: item 9's `discard()` of the heat view and its removal of the listeners.
- **`src/components/lazy/site-signals.tsx`**, and the mount in **`src/app/s/[store]/[market]/extras.tsx`** (section 7.1). Do not touch
  `layout.tsx`.
- **`src/components/ab/ab-marker.tsx`**, the exact edit:
  - after the `if (mine !== variant) { … return; }` block, and **before** `if (!reported.has(experiment))`, add
    `const unshow = showVersion(experiment, variant);`;
  - change `if (!goalBlock) return;` to `if (!goalBlock) return unshow;`;
  - change the final return to `return () => { unshow(); document.removeEventListener("click", onClick, true); };`;
  - nothing else changes in what the marker posts.
- **The DOM marks** of section 7.7, and `src/components/signals/marks.test.ts`.
- **`src/lib/pay-routes.ts`:** the four modules in `FORBIDDEN_ON_PAY_ROUTES`.

**Tests** in `e2e/heatmaps.spec.ts`, on a fresh store with `heatmaps = true` (section 13 header):

- with no consent, **no request** to `/api/signals/` (`page.on("request")`);
- with GPC (`extraHTTPHeaders: { "Sec-GPC": "1" }`, plus `navigator.globalPrivacyControl` set through `addInitScript`), none;
- with the consent cookie `1.{uuid}.statistics+heat.010` set: after a scroll, `page.close()` leaves one `page_heat_days` row with
  views 1 (`expect.poll`);
- on `/s/{slug}/cart` and `/s/{slug}/account`, no request;
- on a page with a picture (`storePageWith`): click the picture, wait 3 s (more than `DEAD_AFTER_MS`), then `page.close()`, and poll for
  `dead_clicks = 1`. A click on a link that opens something gives none;
- opening and closing the cart drawer on a product page, then closing the page, counts **one** view;
- withdrawing Statistics sends no `/api/signals/heat` request;
- in `e2e/ab-tests.spec.ts` style: from a page under a page test, soft-navigate to another page; that page's view row has no tag of the
  test.

**Also:** `e2e/performance.spec.ts` still passes unchanged, because the collector is not a `script[src]` in the HTML. And
`pay-routes.graph.test.ts` passes.

**Done when:** the e2e passes locally before the push, and in CI after it.

### Step 5: The heatmaps switch for the owner

**Files:**

- **The settings page.** `src/app/admin/(gated)/[store]/analytics/settings/page.tsx` and `actions.ts`, plus
  `src/components/admin/analytics/settings-forms.tsx`.
  - Add `SignalsSection` after `VisitsSection`, as `<AnalyticsSection id="signals" …>`, modelled on `VisitsSection` (its status pill and
    an on/off `SubmitButton`).
  - **Heatmaps:** a sentence of what it does, the switch, and "Visitors will be asked again about statistics".
  - The action `setHeatmapsAction` goes through `storeAction()`.
  - If you use `FoldRow`, put it inside a `<ul>`: it renders an `<li>`.
- **Admin words** in `src/lib/admin-messages/heatmaps.{en,nb}.ts`, registered in `src/lib/admin-text.ts` (`AdminAreaMessages`,
  `CATALOGUES`). Add `"heatmaps"` to the settings page's `adminTexts(ctx.lang, ["analytics", …])`.

**Tests:** a view test (`renderToString`) of the off and on rows; `admin-strings.scan.test.ts` passes.

**Done when:** an owner can switch heatmaps on and off, and the store's banner asks about Statistics again. **Send the owner a
screenshot** of the settings section.

### Step 6: Pictures under heatmaps

**Files:**

- **`src/db/schema.ts`:** `page_map_shots` (section 6.3), then `pnpm db:generate`. Then a custom migration for the `page-maps` bucket and
  RLS.
- **`src/lib/page-look-shoot.ts`:** export `settle`.
- **`src/lib/map-measure.ts`** (`measureAnchors`) and **`src/lib/map-shoot.ts`** (`shootMap`).
- **`src/server/map-shots.ts`:** `requestMapShot()`, `runMapShots(deadline, deps)` (with claiming, as in section 9.2), `mapShotUrl()` and
  `pruneMapShots()`. Each takes an injectable `files` dependency.
- **`src/server/page-look-runner.ts`:** `browserMapPhotographer`.
- **`src/app/api/cron/page-looks/route.ts`:** the `after()` change of section 9.2.
- **The daily route:** `daily.map-shots`.
- **Lists:** `COPY_RULES`, `NOT_PERSONAL` (the table only), `STORE_EXPORT_LEFT_OUT`.
- **`docs/security.md` §2.1:** the bucket.

**Tests:**

- **`src/server/map-shots.int.test.ts`**, with a fake photographer and fake files:
  - a waiting row becomes done with its layout;
  - a failure becomes failed with a short problem;
  - two runs at once never take the same row;
  - a fresh done row is not asked for again, and a 15-day-old one is;
  - a private store fails with the private-store problem.
- **A unit test of `mapShotUrl()`:** a market store, a marketless store (D181), and a tag (the two cookies, no URL change; version `a`
  without cookies).
- **`e2e/map-measure.spec.ts`:** `measureAnchors` runs against a fresh store page built with `storePageRows()` and uuid ids (section 13
  header, item 7), and returns those parts' keys. It needs a browser.

**Done when:** the tests pass. The production check moves to step 7, because no screen asks for a shot before then. Never point a local
build at production storage.

### Step 7: The heatmaps screens

**Files:**

- **`src/app/admin/(gated)/[store]/analytics/heatmaps/page.tsx`.** A thin page in the shape of `traffic/page.tsx`, using
  `analyticsContext(slug, query)` (key `analytics:read`).
  - Without `page`: the hub.
  - With `page`: the map. It calls `requestMapShot()` when needed and passes the signed URL.
- **`src/app/admin/(gated)/[store]/analytics/heatmaps/actions.ts`:** `takeNewPictureAction`, guarded by `analytics:write`.
- **`src/server/page-heat-read.ts`** (section 8.5).
- **`src/components/admin/analytics/heatmaps-view.tsx`** (server-rendered) and **`page-map.tsx`** (client canvas, section 9.3). While a
  picture is being taken, draw `<RefreshWhile seconds={20} />`.
- **`src/lib/store-nav.ts`:** `item("/analytics/heatmaps", "Heatmaps", …, { icon: … })` in the group "The site", after Speed. The icon
  comes from `NAV_ICON_NAMES` (`src/components/admin/nav-icons.tsx`), or add a lucide one to `PAGE_ICONS`.
- **`src/lib/admin-map.ts`:**
  - `store("analytics.heatmaps", "/analytics/heatmaps", "Heatmaps", …, { keywords: ["heatmap", "click map", "scroll map", "attention", "rage clicks", "dead clicks"] })`;
  - **move the keyword `"heatmap"` away from `analytics.traffic`** (replace it with "busiest hours");
  - add `"store:analytics.heatmaps"` to `NOT_YET_IN_PROMPT` (pitfall 17).
- **Words:** `src/lib/admin-messages/nav.nb.ts`, `pages.nb.ts` and `heatmaps.{en,nb}.ts`.
- **`src/components/admin/analytics/traffic-view.tsx`:** a *Heatmap* link on each landing-pages row whose path is a page key.

**The Homer view:**

- `AnalyticsHeader` with a `lead` sentence;
- one card, **Where visitors get stuck**: up to 5 rows, each with the page (its title where known, otherwise its path), views and
  frustration %. The first row's *See the map* is the page's one green button;
- one card, **Most viewed pages**;
- when off: "Heatmaps are off." and, for owners, a link to `/analytics/settings#signals`;
- when on with nothing yet: "Collecting. A page's map appears after 30 page views."

**The map view:**

- `PageHeader` with *back*;
- view chips (Where people click / How far people scroll / Where people look);
- device chips, defaulting to the device with the most views;
- period chips (7, 30 and 90 days; scroll and attention also 365);
- then the overlay and its table;
- Lisa's fold holds *Take a new picture*, the "not on this picture" count and the dates.

The version chips come in step 12.

**Tests:**

- `heatmaps-view.test.ts`: off, collecting, too few views, a ranked list, and seed rows that are tagged and untagged (the tagged ones are
  never double-counted);
- `src/server/page-heat-read.int.test.ts`: `heatPages()` over a beacon with one verified tag counts one view;
- `e2e/signed-in/heatmaps.spec.ts`, modelled on `live.spec.ts`. Seed `page_heat_days` rows (≥ 30 views) and a `done` `page_map_shots`
  row for one page of `E2E_STORE`, then open `…/heatmaps?page=…`. The OWNER sees *Take a new picture* in the fold; the READER (Read-only
  role) can open the page but does not see it;
- `store-nav.test.ts`, `admin-map.test.ts`, `permissions.scan.test.ts` and `admin-pages-nb.test.ts` pass.

**Done when:**

- the view tests pass with seeded rows;
- after the deploy, opening the house store's map (heatmaps switched on for it) asks for a shot, which is `done` within two cron runs,
  and the map draws in all three views.

**Send the owner screenshots** of the hub and of each view (phone and computer), plus `docs/heatmaps-and-recordings.svg`.

### Step 8: Recordings: tables, limits, the platform hold and the ingest route

**Goal.** The server can take recordings. No browser sends any yet.

**The order matters** (the checks are generated from the TypeScript lists):

1. Edit `RETENTION_KINDS` and `RETENTION_SEED` (`src/lib/retention.ts`), `USAGE_METRICS` (`src/lib/usage-metrics.ts`) and `LIMITS`
   (`src/lib/limits.ts`). Add the `recordings` table and `platform_settings.recordings_open` to `src/db/schema.ts`.
2. Run `pnpm db:generate`. It writes the table, the column and the widened checks.
3. Then `pnpm exec drizzle-kit generate --custom --name recordings_rules`, containing only:
   - the `recordings` bucket insert;
   - `enable row level security`;
   - the `retention_rules` seed insert;
   - the `plan_limits` inserts by plan name, with the proposal values of section 10, or the owner's if given;
   - the plan-comparison row.
4. `node scripts/prune-snapshots.mjs`, then `pnpm db:check`.

**Files:**

- **The lists:** the retention label in `privacy.{en,nb}.ts`; the metering changes of section 6.4 (`usage-meter.ts`, `limits.ts`
  `liveValue`, `usage.ts` `OWNER_LINES`); words in `m.plans.limitNames` (en, nb, sv, da) and the `capacity` catalogue (en, nb).
- **`src/server/recording-files.ts`:** `recordingFiles()` with `upload` (`"ok" | "exists" | "failed"`), `download`, `remove`, `list` and
  `pathsOf(row)`.
  - Read the key exactly as `reviewPictureStorage()` does (`src/server/review-picture-store.ts`): `process.env.SUPABASE_SECRET_KEY`,
    refused when `supabaseKeyKind()` says publishable, and null without one.
  - Use `cacheControl: "0"` and `upsert: false`.
- **`src/server/recordings.ts`:** `recordSegment()` (section 8.2), `forgetRecordings()` (section 8.3), `pruneRecordings()`, and
  `deleteRecording(member, id)` (owner, audited `analytics.recording_deleted`).
- **The routes:** `src/app/api/signals/rec/route.ts` and `src/app/api/signals/forget/route.ts`, both in `BEACONS`.
- **`src/server/request-budget.ts`:** `BUDGETS.rec` and `BUDGETS.forget`, with `rec` in `FAIL_CLOSED`.
- **`src/server/analytics-settings.ts`:** `setRecordings` refuses `on: true` unless `recordings_open` is on, or the store is the house
  store.
- **The platform switch** for `recordings_open` on `/admin/platform/capacity` (section 11), with a platform action and words.
- **More lists:** `COPY_RULES`; `PERSONAL_DATA` (both entries) with the Norwegian reasons; `PURPOSE_OF` (both); `STORE_EXPORT_LEFT_OUT`.
  Add to `NOT_INCLUDED` in `src/lib/privacy-text.ts`, in nb, sv, da and en (translated):
  `{ what: "Recordings of visits", why: "They are kept under a random number for one browser tab, for 30 days, and cannot be tied to you." }`.
- **The daily route:** `daily.recordings`.

**Tests:**

- `src/db/privacy.test.ts` passes (the register and the retention seed); `src/db/commerce.test.ts` covers the checks.
- **`src/server/recordings.int.test.ts`**, with a fake `files` modelled on `memoryStorage()` in `src/server/review-pictures.int.test.ts`:
  - seq 0 creates the row, with coarse times; seq 1 adds to it;
  - each of these gives 410: no consent, GPC, a robot, the switch off, `recordings_open` off (and the house store passes), a private
    store's locked-out visitor (an unlocked one is kept; mock `next/headers` as in step 3), a refused page, over the monthly limit, and
    over the day's slot;
  - seq 0 answered 503, then seq 0 again, creates the row;
  - a zip bomb (a 20 MB string gzipped) gives 400;
  - an id of another store gives 410;
  - a duplicate segment is counted once;
  - a seq gap (0, 1, 3) is stored, and `pathsOf()` names exactly those files;
  - a failed conditional update removes the uploaded file;
  - `files` null gives 503 and no row;
  - a Meta event's `?email=…` is stripped, checked in the file the fake `files` received;
  - forget deletes the rows and removes exactly their files;
  - prune deletes expired rows and their files, stops at its deadline, and prunes a closed store's rows too.
- `src/db/<name>-plan-features.test.ts`, copied from the redirects one.
- `src/server/limits.int.test.ts`: `recordings_month` is counted and refuses past the limit.

**Done when:** the tests pass, CI applies the migration, the advisors are clean, and the versions are recorded.

### Step 9: The recorder in the storefront

**Files:**

- **The packages:** `pnpm add -E @rrweb/record@2.2.0 @rrweb/replay@2.2.0 @rrweb/types@2.2.0`, or the newest 2.2.x out for two weeks.
  Update the version note in this file.
- **`src/components/signals/session-recorder.ts`** (section 7.4) and **`src/components/signals/forget.ts`** (section 8.3).
- **`src/components/signals/site-signals.tsx`:** the recorder branch, page changes, the tail, pause and resume, and withdrawal.
- **The Cookies page:** the *Delete my recordings* button. It is a small client component in `src/components/consent/` that calls
  `forgetRecordings()`, then says "Deleted". Its words go in `*-browser.ts`.

**Tests** in `e2e/recordings.spec.ts`, on a fresh store with `recordings = true, recording_share = 100, recordings_confirmed_at = now()`
(section 13 header). CI has no Storage, so the test answers the segment route itself:
`page.route("**/api/signals/rec**", (r) => r.fulfill({ status: 204 }))`, keeping each request body to inspect.

- With Statistics accepted but not Recordings: no request to `/api/signals/rec`, and no rrweb chunk is fetched.
- After accepting Recordings, a segment is POSTed within 40 s of activity.
- **Masking.** On a page with a search block (`storePageWith`):
  - type `secret-123` into the search box and wait for suggestions;
  - load `?q=secret-123`;
  - type into a form field.

  Gunzip every rec body in the test (`zlib.gunzipSync`) and assert that none contains `secret-123`, and none contains a run of 10 `*`.
- A soft navigation to `/s/{slug}/account` (signed in as a test customer, if the store allows it, otherwise the sign-in page) and
  back:
  - no rec body contains the account page's heading or the customer's email;
  - the session id stays the same;
  - a new full snapshot follows the return.
- Opening the cart drawer pauses the recorder, and closing it resumes with the same id.
- Withdrawing Recordings in the consent choices sends one `/api/signals/forget` request carrying the id, and no rec request after it.
- Staff (the admin return cookie set) record nothing.
- No rec body holds a Meta `href` with a query.
- `e2e/performance.spec.ts` is unchanged.

**Done when:** the e2e passes locally before the push, and in CI after it. Owners still cannot switch recordings on: the switch is
step 11, and the platform hold is closed.

### Step 10: Sealing recordings, and the DPIA draft

**Files:**

- **`src/server/recordings.ts`:** `sealRecordings({ deadline }, deps)` (section 8.7). `recordingEvents()` (step 11) reads `all.gz` when
  sealed.
- **`src/app/api/cron/cart-reminders/route.ts`:** the exact line of section 8.7. Add one to `DISPATCHER_JOBS`.
- **`docs/dpia-recordings.md`:** a **draft** DPIA in the shape of `docs/dpia-ai.md`. It covers systematic monitoring, the measures of
  section 4, the risks of section 15, and the "balanced" masking default recorded as the documented alternative to M0 (Q7). The heading
  says "Draft for the owner and a lawyer".

**Tests** in `src/server/recordings.int.test.ts`:

- a finished recording with three segments becomes one file with the events in order, and the segments are removed;
- an active recording (last segment 10 minutes ago) is left alone, and so is one whose floored `last_at` is 40 minutes old;
- a segment arriving during sealing makes the seal step back (all.gz removed; segments kept);
- a forget during sealing leaves no file;
- a recording that fails three times is never picked again;
- an idle run makes one query.

**Done when:** the tests pass and the DPIA draft is committed.

### Step 11: The recordings screens, and the recordings switch

**Files:**

- **`src/app/admin/(gated)/[store]/analytics/recordings/page.tsx`:** `analyticsContext(slug, query, "owner")`; the list, chips and
  filters.
- **`src/app/admin/(gated)/[store]/analytics/recordings/[id]/page.tsx`:** owner only; the player page. Add its path to the `FULL_WIDTH`
  regex in `src/app/admin/(gated)/[store]/layout.tsx`.
- **`src/app/admin/(gated)/[store]/analytics/recordings/[id]/events/route.ts`:**
  - GET, guarded with the literal `"owner"` key through `requirePermission(slug, "owner")` (`src/server/permissions.ts`). A refused
    member gets 404 (`notFound()`);
  - `permissions.scan.test.ts` walks a route's path up to its nearest map page. With the map entry `analytics.recording`
    (`/analytics/recordings/[id]`, `needs: "owner"`), the scan itself requires the `owner` key here, so **no `OWNER_ONLY_EXTRA` entry
    is needed**;
  - **audit first:**
    `audit(member.account.id, store.id, "analytics.recording_viewed", { recording: id, device, durationS }, { target: { type: "recording", id } })`.
    If the audit fails, answer 503 and send nothing (the precedent is `exportAnalyticsTable()`);
  - set `viewed_at` if it is null;
  - then `recordingEvents()`, as gzip JSON (`Content-Encoding: gzip`, `Cache-Control: private, no-store`).
- **`next.config.ts`:** the enforced CSP header of section 8.6 for the player path.
- **`src/server/recordings-read.ts`** (section 8.5).
- **`src/components/admin/analytics/recordings-view.tsx`** (server) and **`recording-player.tsx`** (client):
  - `const { Replayer } = await import("@rrweb/replay")`, plus the package's stylesheet (find its path in
    `node_modules/@rrweb/replay/package.json` `exports`);
  - `new Replayer(events, { root, skipInactive: true, mouseTail: false, showWarning: false })`;
  - **never** `UNSAFE_replayCanvas`, and never add `allow-scripts`;
  - scale the replay to fit the column, like `ScaledFrame` (`src/components/theme-preview-stage.tsx`);
  - controls: play and pause, speed 1, 2, 4 and 8, skip the quiet parts (on), and a timeline with `timelineMarks()`;
  - an event list beside the player; pressing a line seeks there;
  - *Delete this recording*, with a confirmation.
- **The recordings switch** on Analytics settings (`#signals`):
  - a **Recordings** row;
  - three confirmation checkboxes: "My store is not aimed at children", "My store does not sell health, religious, political or other
    sensitive goods", and "My privacy policy says visits may be recorded" (which links to the store's privacy page);
  - share chips (10, 25, 50 and 100 %, defaulting to the column's default);
  - "Hide all text in recordings", in its own fold;
  - "Recordings are kept 30 days. Only you can watch them.";
  - `setRecordingsAction`.

  While the platform hold is closed and the store is not the house store, the row says "Recordings are not available yet" instead of the
  switch.
- **Existing recordings stay visible.** The list and the player show the recordings that exist whatever the switch says; the switch only
  stops new ones. When it is off, a line says so above the list.
- **Links into recordings:** *Watch recordings* on each **Where visitors get stuck** row and on the map view
  (`/analytics/recordings?page=…&has=rage`), shown only where `canOpenPath()` allows (owner).
- **Navigation and map:**
  - `store-nav.ts`: `item("/analytics/recordings", "Recordings", …, { icon: "video" })`;
  - `admin-map.ts`: `analytics.recordings` and `analytics.recording`, both with `needs: "owner"`, both in `NOT_YET_IN_PROMPT`.
- **Words:** `recordings.{en,nb}.ts`, `nav.nb.ts`, `pages.nb.ts`, and `"recordings"` in the settings page's `adminTexts`.

**The Homer view of the list:**

- the lead sentence;
- chips with counts, shown only when not zero: All, Rage clicks, Dead clicks, Phone, Tablet, Computer;
- rows grouped by day (Today, Yesterday, then the date). Each row shows the time ("around 14:00"), the device, the length, the number
  of pages, the entry page, rage and dead counts as chips, and the versions;
- watched rows are dimmed;
- *Watch* on each row;
- the sort is "Most frustrated first", with Newest as the alternative;
- Lisa's fold holds the page, period and version filters.

**Tests:**

- view tests of the list: off, not available yet, empty, grouped by day, dimmed when watched;
- `setRecordings` refuses another store while `recordings_open` is off;
- **`e2e/signed-in/recordings.spec.ts`:**
  - **Seed** a `recordings` row for `E2E_STORE` with `testDb()`; never change its switches.
  - **The player:** the OWNER sees the list and opens a player fed a fixed events file served by `page.route` on the events URL. The
    player draws an iframe whose `sandbox` is `allow-same-origin`, without `allow-scripts`, and the page logs no CSP errors.
  - **The route itself** (no `page.route`):
    - seed a recording row with `seqs = '{}'`; `recordingEvents()` returns `[]` without touching files when there are none, so no
      Storage is needed;
    - the OWNER's `page.request.get(eventsUrl)` answers 200, and an `analytics.recording_viewed` audit row exists;
    - the READER's answers 404, and no `analytics.recording_viewed` row is written. (A `staff.permission_refused` row is, as for any
      refused member.)
  - **The READER** gets the page refused and no nav link.
- a unit test that the events route refuses when the audit fails (mock `audit`).

**Done when:** the owner switches recordings on **for the house store** (with the confirmations), visits it in another browser, and
watches the recording in production. **Send the owner screenshots** of the list, the player (a phone and a computer recording) and the
settings row.

### Step 12: Tying it to A/B tests

There are no new tables and no per-visitor rows: behaviour per version comes from the tagged totals.

**Files:**

- **`src/lib/heat-read.ts`:** `frustratedVersion(rows)`.
  - For each version other than `a` with at least `FLAG_VERSION_VIEWS` page views in both it and `a`, compute a two-proportion z on
    `rage_views / views` and on `dead_views / views`.
  - It flags when z ≥ 3.29 against the version. Fewer rage clicks is never a flag. It never stops a test.
- **`src/components/admin/experiment-results-view.tsx`:**
  - a section `#ab-behaviour` after the funnel, one row per version, from `versionBehaviour()`: reached half the page, page views with
    rage clicks, page views with dead clicks;
  - links *Heatmap* (`/analytics/heatmaps?page=…&tag=…`) and *Recordings* (`/analytics/recordings?tag=…`), each shown only where
    `canOpenPath()` allows (`src/lib/permissions.ts`);
  - below `MIN_VERSION_VIEWS`, "Too few page views yet";
  - a warning line when `frustratedVersion()` flags;
  - words in `experiments.{en,nb}.ts` `results`.
- **The experiment page** (`src/app/admin/(gated)/[store]/experiments/[id]/page.tsx`) reads `versionBehaviour()` and passes it on.
- **The platform view:**
  - `src/lib/platform-experiments.ts`:
    - widen `Flag["kind"]` with `"frustrated"`, and give it a label wherever the platform view switches on the kind;
    - add `frustrated: string | null` to `TestLine`;
    - push `{ kind: "frustrated", words: "Version X gets clearly more rage or dead clicks." }` in `flagsOf()` for a running test;
    - add `frustrated?: string | null` to `adviceFor()`'s input, with a line saying the platform tells the owner and never stops the
      test;
  - `src/server/platform-experiments.ts` fills `frustrated` beside `harmed`.
- **The heatmap page** reads a `tag` parameter and shows **version chips** (from `taggedTests()`). Map shots for a tag use the cookie
  route of section 9.2.
- **The recordings list** reads a `tag` filter and shows version chips.

**Tests:**

- `src/lib/heat-read.test.ts`: `frustratedVersion()` with 2,000 versus 1,999 page views, z just above and just below 3.29, and the
  direction;
- `experiment-ui.test.ts`: the behaviour section renders, with the links hidden for a member who cannot open them;
- `src/server/platform-experiments.int.test.ts`: the flag;
- `e2e/ab-tests.spec.ts`:
  - set `heatmaps = true` on the store `runningTest()` creates, before any visit;
  - write the consent cookie with the version `statistics+heat` (not `enrol()`'s `statistics`);
  - an enrolled visitor's view writes the tagged row (`expect.poll`).

**Done when:** a running test on a test store shows behaviour per version, and a version's heatmap draws on that version's own picture.
**Send the owner a screenshot** of the behaviour section.

### Step 13: Words for the law, and the docs

**Files.**

**Owner tasks**, written in the decision row and **not** made in code:

- The DPA's data types and nature (`src/lib/platform-legal/en.ts:288`, `nb.ts:287`) gain "interaction and recording data", and the
  sentence "we never use recordings for our own purposes; platform staff do not watch a store's recordings".
- Kaizena Flow's own privacy notice gains a sentence about its site's heatmaps and recordings.
- The Cookies pages' wording is reviewed.

**`docs/analytics.md`:** the full "Heatmaps and recordings" section, including what is not measured.

**The rules files and CLAUDE.md:**

- Write each rule as a `## ` heading in `docs/rules/storefront.md` and in `docs/rules/admin/marketing.md` (check
  `docs/rules/admin/README.md` for the right file).
- Each heading's text starts with exactly the words of its CLAUDE.md line: "Heatmaps and recordings (D656, `docs/heatmaps-and-recordings.md`, …)".
- Write the heading and the line **in the same push**. `src/lib/rules-index.test.ts` fails otherwise.

**The other docs:**

- `docs/capacity.md`: the limit and the size figures.
- `docs/platform-parity.md`: the row, after reading `site_from_store` in production (section 11).
- `docs/ab-testing.md`: a short "What the behaviour section adds" under phase 11.
- `docs/security.md`: check §2.1 and §2.11, and add the replay sanitising and the player's CSP to §2.3 ("recorded DOM is never drawn
  as live HTML").
- `docs/pci.md` (D373): one sentence saying the recorder runs on product pages only with consent, blocks the express area
  (`data-kz-private`), and is never on pay routes.

**Done when:** the docs say what was built, and `brand.scan.test.ts` and `rules-index.test.ts` pass.

### Step 14: The AI manager's tools (last)

**Before pushing,** tell the owner. Until the owner records the eval again, CI's `agent-eval-replay.int.test.ts` fails. While it fails,
**no push with a migration, by anyone, can release.** Push this step only when the owner can record the same day.

**Files:**

- **`src/lib/owner-tools.ts`:** two read-only tools with no gate.
  - `page_behaviour({ page?, days, device? })`: the figures of **Where visitors get stuck**, or one page's reach at 25, 50, 75 and
    100 %, its attention per band, and the parts clicked most with their dead and rage counts.
  - `version_behaviour({ experiment })`: the A/B behaviour per version, and the flag.

  Copy the description style of `speed_report`: "Read-only; repeat its figures, never make one", plus the minimum volume.
- **`src/server/heat-tools.ts`:** the handlers, calling the same reads as the pages. They return figures already formatted, plus
  `page: \`/admin/${store.slug}/analytics/heatmaps\``, written as `analytics-tools.ts` writes its own (its `adminLink` is not exported).
- **Wiring:** `TOOL_PERMISSIONS` (`analytics:read` for both), the handler map in `src/server/owner-tools.ts`, `src/lib/tool-words.ts`
  and `assistant.nb.ts`.
- **The contract:** run `WRITE_API_CONTRACT=1 pnpm exec vitest run src/lib/api-contract.test.ts`, then write the new version's entry in
  `content/docs/developers/changelog.md`. Never hand-edit the contract JSON. `mcp-catalogue.ts` needs no change for `analytics:read`
  tools.
- **`src/lib/agent-eval.ts`:** one case in which a part's label (from `describePart`) hides an instruction and a canary. Expect
  `forbiddenText: [CANARY]` and no gated tool.
- **`NOT_YET_IN_PROMPT`:** remove the new pages.
- **No tool reads recordings.** Recordings never go to a model in v1: that would be a new purpose and a new recipient (section 4).

**Tests:** `src/lib/heat-tools.test.ts` (pure parts), `src/server/heat-tools.int.test.ts`, `agent-eval.test.ts`,
`api-contract.test.ts` and `owner-tool-permissions.test.ts`.

**Then the owner records the eval** on Platform → AI, and commits `src/data/agent-eval-recording.json`.

---

## 14. Rules every step follows

**Server code:**

- Server-only modules import `server-only`.
- Reads go through `typedRows()` with `col` (heavy analytics reads through `setBased()` and `checkedRows()`), filter with
  `owned(storeId)`, and use `coalesce()` on sums.
- A write that picks a row by id also names `store_id` (`ratchet.scan.test.ts`).
- Log with `log(level, event, fields, error)`: ids and counts only, never a path with a token, never a person's data. No `console.error`.

**Beacon routes** copy the speed route (`sameSite()`, byte caps, an empty `no-store` answer), import nothing from chat, auth, AI or
admin text, and are listed in `BEACONS`.

**Browser code:**

- No zod, no `lib/page-content`, no `lib/i18n` and no `lib/known-cookies` (`storefront-bundle.scan.test.ts`).
- rrweb only by `import()`.
- Words a client component shows come from `src/lib/messages/*-browser.ts`.

**Admin code:**

- No English literal in admin markup (`admin-strings.scan.test.ts`); words go in the `heatmaps` and `recordings` areas.
- One green button per page.
- Lisa's depth in one *Advanced* fold.
- Every chart has a table behind it.
- Figures go through the analytics formatters.
- No new `router.refresh()` caller: use `RefreshWhile`.

**Every page and action checks its own guard:**

- heatmap pages use `analytics:read`, and their write actions `analytics:write`;
- recordings, the player, the events route and the delete action are owner only;
- settings actions are owner only.

**Migrations:**

- Add, never rename or drop.
- Checks built from TypeScript lists are generated, never written by hand.
- Run `node scripts/prune-snapshots.mjs` after a custom migration.
- Never apply a migration by hand. Record the versions.

**Every new table** goes in `COPY_RULES`, in `PERSONAL_DATA` or `NOT_PERSONAL`, and in `STORE_EXPORT_TABLES` or
`STORE_EXPORT_LEFT_OUT`, with RLS on.

**Every cookie or storage item** goes in `KNOWN_COOKIES` and `COOKIE_PATTERNS`, with purposes in en, nb, sv and da.

**Shopper words** are hand-written in en, nb, sv and da, and the ones a law asks for are flagged for legal review.

---

## 15. Risks and how we hold them

| Risk | Hold |
|---|---|
| The recorder leaks typed or personal data | `maskAllInputs` with `maskInputFn: () => ""`; blocked forms, chat, drawer, search suggestions and review pictures; the allow-list of pages, with `q=` off; the `emit` guard that pauses before a refused page's DOM is buffered; query strings stripped from Meta events; the e2e masking tests; "Hide all text" |
| A recording is joined to a person by time | Relative event times in the browser; `started_at` floored to 10 minutes; width and height rounded; no market column; the A/B and consent ids are never stored |
| Forged recordings carry hostile HTML into the owner's browser | `sanitizeEvents()` with an allow-list of asset paths; rrweb's sandbox without scripts; the player's enforced CSP; owner-only access; budgets; the same-site and own-page checks |
| Recordings switched on before the law is settled | `platform_settings.recordings_open` stays off until O3, Q3, Q6 and Q7 are answered; the DPIA draft comes before the switch |
| A heavy page makes the full snapshot slow on cheap phones (up to 0.7 s at a 6× CPU slowdown, measured on a 2,300-element page) | Sampling; started when idle after load; `slimDOMOptions: "all"`; mouse moves throttled; stops on runaway pages |
| Many Storage objects grow Postgres | Segments by size and time; sealing into one file; the monthly limit; the 30-day prune |
| Files outlive their rows | `seqs` names every file; conditional updates remove the file on failure; the seal checks `seqs` before claiming; forget, delete and prune also `list()` the folder |
| Hot daily rows lock under heavy traffic | One short upsert per beacon, rows in primary-key order. If `heat.record_failed` logs show lock timeouts, add a staging table folded every five minutes |
| Dead clicks that are not dead | `data-kz-ambient`; `style` and `data-fx-*` mutations ignored; arming at `pointerdown`; the 2.5 s window; shown as a share with a minimum volume |
| Pictures that do not match what visitors saw | Re-shot after 14 days or on demand; widths from the store's breakpoints; consent cookie set; `settle()`; the "not on this picture" count; anchors by part, not pixel |
| The consent change breaks today's banners | A fourth bit only when recordings are asked about; `heat` only when heatmaps are on; legal facts unchanged when off; three-key consent records still accepted; byte-identical checks in step 1 |
| Rolling deploys: an old instance reads a four-bit cookie | Only stores that switched recordings on write four bits. That switch arrives in step 11 and is held platform-wide |

---

## 16. Pitfalls (read before steps 1, 4, 9 and 11)

1. **The A/B version is not in the URL.** The proxy rewrites on the server. Use the view's tags (from `AbMarker` through
   `showVersion()`) and the server's check.
2. **There is no `data-ab` attribute.** The version reaches the browser only as `AbMarker`'s props. Register it there, with the exact
   edit of step 4.
3. **The first A/B page view is always the original, and a stale page reloads once.** `MIN_VIEW_MS` drops the reload, and tags come
   only from a confirmed marker.
4. **`OffPayRoutes` unmounts on `/cart`, the drawer included.** The heat view lives in a module variable, and the recorder pauses and
   resumes.
5. **By the time `usePathname()` changes, the new page is on screen.** A view ends with the values it captured at its start; it never
   reads `location` at its end.
6. **`kz-page`, `kz-menu` and `kz-brands-track` are not parts.** Only the **first** class of a wrapper, matching `PART_ID`, is an anchor.
7. **`data-kz-block` is taken (inline editing) and `kaizen_rec` is taken (recommendations).** Use `data-kz-private` and
   `kaizen_replay_…`.
8. **The motion runtime writes `style` and `data-fx-*` on pointer moves.** Those mutations must not make a click alive.
9. **`sendBeacon` and keepalive share one 64 KiB budget per page.** Tails stay under 60,000 bytes; heat summaries under 8,000.
10. **Vitest here has no DOM.** Keep the logic in pure modules, and test the DOM layer in Playwright.
11. **`pay-routes.graph.test.ts` follows static and dynamic imports.** Mount `SiteSignals` only in `MarketExtras`.
12. **Never reuse the consent cookie's visitor id or the A/B visitor id** for a recording, and never store exact times.
13. **A store with recordings off must produce exactly today's consent cookie and legal facts** (step 1).
14. **`chat_usage` is pruned after two days.** Never keep a monthly count there.
15. **Owner-only routes.** `permissions.scan.test.ts` derives a route's key from its nearest map page. Mark the recordings pages
    `needs: "owner"`, and their routes then need the `owner` key. Only an owner-only file whose nearest map page is **not** marked owner
    goes in `OWNER_ONLY_EXTRA`. Never loosen recordings to `analytics:read`. A refused member gets 404, not 403.
16. **Every Storage object is a Postgres row.** Never write one file per event or per page view.
17. **New admin pages and new owner tools change the AI manager's prompt.** CI's eval replay then fails until the owner records the
    eval again. List new pages in `NOT_YET_IN_PROMPT` (steps 7 and 11), and take them out only in step 14.
18. **`siteCookies()` is cached under `cookiesTag`.** Every setter of the switches refreshes it.
19. **Next percent-encodes the A/B cookie.** Read cookies with `cookieValue()`, which decodes.
20. **Do not run `playwright install`.** Use `PLAYWRIGHT_CHROMIUM_PATH` (CLAUDE.md, Commands).
21. **rrweb 2.2.2 was a week old on 16 Nov 2026.** Pin all three packages to the same exact version.
22. **The admin cannot frame a store's own domain,** so the picture under a heatmap is a screenshot. **One browser per shot** (D150).
23. **`src/lib/analytics-heatmap.ts` and the `Heatmap` chart are the weekday-by-hour sales map.** Do not touch or reuse them.
24. **Never `UNSAFE_replayCanvas`.** It adds `allow-scripts` to the replay frame.
25. **The platform's legal texts are the owner's,** hand-written (`src/lib/platform-legal/*`). List the points; never edit them.
26. **CI has no Storage.** Inject `files`; fake them in integration tests; answer the segment route with `page.route` in e2e.
27. **The demo store is prerendered and cached.** E2e tests use a fresh `testStore()` with the switch set before its first request.
28. **Two register rules.** `registerProblems()` refuses `storage:` keys in `NOT_PERSONAL`, because they are not tables. And
    `personal-data.test.ts` refuses a non-`none` entry with no personal columns; never add to its exceptions. Follow section 6.4 exactly.

---

## 17. Sources

The research of 16 November 2026 covered this codebase (the A/B engine, privacy and the beacons, the storefront's DOM, data and jobs,
the admin and AI) and the web (tool definitions, techniques, the law).

**Vendor and open-source definitions:**

- Microsoft Clarity: semantic metrics, scroll and attention maps, masking, and consent API v2 (enforced in the EEA from 31 Oct 2025),
  learn.microsoft.com/clarity.
- PostHog `posthog-js`:
  - `dead-clicks-autocapture.ts` (2500 ms; scroll and selection 100 ms);
  - `rageclick.ts` (3 clicks, 1 s, 30 px);
  - `scroll-manager.ts` (max content percentage);
  - `heatmaps.ts`.
- Sentry `replay-internal` (3000 ms, 300 ms scroll, 7000 ms timeout).
- Datadog RUM `computeFrustration.ts`.
- OpenReplay `deadClick.ts` (1234 ms) and `clickRage.ts`.
- Contentsquare's exposure (150 ms).
- Clarity `click.ts` (element-relative coordinates).

**Techniques:**

- rrweb 2.x: stable since 2.0.0 (1 Jun 2026), 2.2.2 on 9 Nov 2026, MIT. Measured: recorder 23 KB gzip, replayer 85.5 KB gzip.
- Measured bytes: a full snapshot is 38 to 360 KB gzip, then 6 to 24 KB a minute.
- `CompressionStream` has been Baseline since May 2023.
- The 64 KiB keepalive budget (Fetch Standard).
- Supabase Storage pricing, and its rows in `storage.objects`.
- Vercel `dub1` pricing.

**Law** (dated in the research):

- EDPB Guidelines 2/2023 v2.0 (7 Oct 2024).
- Norway: ekomloven § 3-15 (LOV-2024-12-13-76, in force 1 Jan 2025); Nkom (16 May 2025); Datatilsynet's consent advice (3 Apr 2025),
  analytics advice (23 Apr 2025) and DPIA list.
- CNIL: the recommendation on session replay tools (adopted 8 Oct 2026, published 5 Nov 2026) and its synthesis (Oct 2026); the
  self-assessment for audience measurement (Jul 2025).
- WP248 rev.01.
- CJEU C-252/21, C-21/23, C-413/23 P, C-40/17 and C-673/17.
- Princeton CITP "No boundaries" (2017).

---

## 18. Change log

| Date | Change |
|---|---|
| 16 Nov 2026 | Written: research, design and the build in 14 steps. Nothing built. |
| 16 Nov 2026 | **Reviewed from five angles (112 findings) and corrected.** The main changes:<br>- `SiteSignals` is mounted in `MarketExtras` (the pay-route graph test follows dynamic imports).<br>- The browser's page rule is an allow-list mirroring `placeOfPath()` and `speedKind()`, and refuses `q=` for recordings.<br>- `PART_ID` matches ids with several dashes.<br>- Product cards inside parts get anchors of their own.<br>- Attention is a mean per band, not a sum.<br>- Frustration is counted once per view.<br>- A view keeps its path and tags from its start, and survives the cart drawer.<br>- The click judge arms at `pointerdown` and gives one verdict per click.<br>- No per-visitor A/B rows: behaviour per version comes from tagged totals, with a stricter flag.<br>- The recorder pauses in `emit`, before a refused page's DOM is buffered, strips query strings, masks inputs to nothing and sends relative times; recordings keep coarse times.<br>- `seqs` names every file; conditional updates and seals; the bucket is 5 MB.<br>- Map shots use one browser per shot, claim their rows, and take their widths from the store's breakpoints, with A/B versions served through cookies.<br>- The sanitiser uses an allow-list of asset paths, and the player sends an enforced CSP.<br>- Recordings are held platform-wide (`recordings_open`), and the DPIA draft comes before the switch.<br>- Owner code and cookie notes cannot choose the new category; legal facts and consent records stay compatible.<br>- The e2e tests use fresh stores and no Storage.<br>- The migration order for generated checks is fixed.<br>- `RefreshWhile` instead of `router.refresh()`.<br>- The closed-store hook was dropped (closing deletes nothing).<br>- The storage keys are renamed to `kaizen_replay_…`. |
| 16 Nov 2026 | **Second review round (46 findings: a consistency critic and a check of the new code claims), corrected.** The main changes:<br>- The attention height is fixed at seq 0, so continuations never go negative.<br>- A view's first tags are taken a tick after it starts, after `AbMarker`'s passive effects.<br>- `SiteSignals` uses two effects, so the drawer never ends a view.<br>- The player's CSP lives in `csp.ts` and repeats `frame-ancestors`, which a later header would otherwise remove.<br>- Sealing waits 45 minutes past the floored `last_at`.<br>- A segment's seq advances only after a 204.<br>- The stored file is the rewritten body.<br>- `runningExperiments()` is imported, not moved: its memo is shared with `forgetRunning()`.<br>- The page rule drops a first segment matching `MARKET_PARAM` (it covers `eur` and `en-eur` for marketless stores).<br>- The monthly limit is counted live, without `measuredPlusLive()`.<br>- `breakpointsOf(store.theme.settings)` is used, and `MarketExtras` stays synchronous.<br>- The map-shot deadline is capped.<br>- **Corrections to round one:** the events route needs no `OWNER_ONLY_EXTRA` entry, because its owner-only map page already applies; a refused member's `staff.permission_refused` audit row is expected.<br>- **E2e fixes:** signed-in specs seed `E2E_STORE`'s rows; part-anchor tests use `storePageRows()` with uuid ids; the `lockedOut()` cases mock `next/headers`. |
