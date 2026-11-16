# Data protection impact assessment: recordings of visits and heatmaps (draft)

GDPR Article 35. D656 (`docs/heatmaps-and-recordings.md` section 4, item 10, and step 10). Written 16 November 2026 from the code at
`b762c2e6` and the steps built before it (1 to 9): every *collected* and *kept out* below was read in the modules named beside it.

> **Draft for the owner and a lawyer.** It describes what the code does and lists risks and measures; it does not conclude that any
> processing is lawful or compliant, and none of its *legal basis candidates* has been chosen by anyone with the authority to choose.
> The conclusions in section 7 are proposals. Where something is not known or not yet built, it says so.

Related: `docs/heatmaps-and-recordings.md` (the plan and its open questions, section 12), `docs/dpia-ai.md` (the AI features' draft,
whose shape this follows), `docs/security.md`, `docs/residency-register.md`, `src/lib/personal-data.ts` (the register,
`PERSONAL_DATA`), `src/lib/personal-purposes.ts` (the purpose `recordings`).

---

## 1. Why an assessment, and who it is for

**Recordings of visits** replay what a visitor saw and did on a store's pages: the page as drawn, clicks, taps, scrolling and pointer
movement. The Article 29 Working Party's guidelines on DPIAs (WP248 rev.01) name *systematic monitoring* as a criterion, and session
replay is the CNIL's example of it in its recommendation on session replay (2026). That alone makes an assessment wise; whether it is
*required* for every store that records, or only for large or sensitive ones, is open question Q3. Datatilsynet's list of processing
that always needs a DPIA: [[Add: recordings checked against Datatilsynet's list, by a person]].

**Heatmaps** keep only daily totals per page shape, device and A/B version (no visitor, no id, no address), so they carry a far lower
risk; they are covered here because they share the consent, the collector and the A/B link.

**Who is the controller.**

| Where | Controller | Kaizena Flow's role |
|---|---|---|
| A store's own pages | The store (its owner) | Processor: it stores the recordings and totals for the store and never uses them for itself (no benchmarks across stores, no model training, no product analytics; doing so would make it a joint controller, CNIL §3.2, citing CJEU C-40/17 *Fashion ID*) |
| kaizenaflow.com, while it is served from the house store `kaizenaflow` (`platform_settings.site_from_store`, D484) | Kaizena Flow | Controller |

This document is Kaizena Flow's assessment for kaizenaflow.com and a template a store can adapt for its own (Q3).

---

## 2. What is processed

### 2.1 Recordings (step 8 and 9; `src/components/signals/session-recorder.ts`, `src/server/recordings.ts`)

| Collected | Where it is kept | How long |
|---|---|---|
| The page's DOM as drawn, with private parts blocked and marked text masked (section 3.2) | gzip files in the private bucket `recordings` (Supabase, eu-west-1 Ireland) | 30 days from the start (`pruneRecordings()`, `RECORDING_KEEP_DAYS`) |
| Clicks, taps, scrolling, pointer movement (sampled every 50 ms, 150 ms on touch screens), focus and the masked fact that a field changed | the same files | 30 days |
| The pages visited (as the store's page keys, never a query), the device class, the viewport rounded to 10 px, counts of clicks, dead clicks and rage clicks, the A/B versions the visitor's cookie confirms | `commerce.recordings` | 30 days |
| A random id made by the browser for one tab (`crypto.randomUUID()`), the store's day, start and last times floored to 10 minutes, the duration | `commerce.recordings` | 30 days |

**Kept out:** everything typed (masked to nothing, not even its length, `maskInputFn: () => ""`), passwords, payment data, the chat, the
cart drawer, every form, search suggestions, review pictures and the express checkout (`data-kz-private`: they replay as empty boxes),
text people wrote (reviews, comments; `data-kz-mask`: three dots whatever its length), canvas, cross-origin frames, network and console,
any query string or fragment (stripped in the browser and again on the server), the exact time of day (event times are relative to the
session's start), the consent cookie's visitor id and the A/B visitor id (never stored), the IP address and the user agent (never
stored).

**Pages never recorded:** the cart, checkout, order, account, any page with a token, the country chooser, the admin, the search page and
any address with `q=` (`signalPlace()` in the browser, `placeOfPath()` and `speedKind()` on the server). Staff looking at their own store
are never recorded.

### 2.2 Heatmaps (steps 3 and 4; `src/components/signals/heat-collector.ts`, `src/server/page-heat.ts`)

| Collected | Kept | How long |
|---|---|---|
| Per page view: how far down the page was scrolled, how long each band was on screen, clicks by part of the page and a 10 × 10 cell of it, whether a click was dead or rage, the A/B versions confirmed | added into `commerce.page_heat_days` and `commerce.click_cells` per page shape, day, device and version; the page view itself is not kept | 13 months (totals), 90 days (cells) |
| A robot's picture of the public page under each heatmap | `page-maps` bucket | until nobody asks for it for 90 days |

No id, address or user agent is kept; the totals cannot be traced back to a visit.

---

## 3. Measures

### 3.1 Consent and choice

- **Consent before anything is sent** (EDPB Guidelines 2/2023 paras 33, 44, 53; ePrivacy Art. 5(3); ekomloven § 3-15). Recordings are a
  purpose of their own (`recordings`, CNIL §5.1–5.2), with a short mention on the banner's first layer while the store records;
  heatmaps run under Statistics, whose words name them, and visitors are asked again when heatmaps start (`heat` in the consent version).
- **Global Privacy Control and Do Not Track** stop both, in the browser and on the server.
- **Withdrawal** stops recording at once, in the open page, sends nothing buffered, and deletes the recordings the browser can name
  (`forget.ts`, `/api/signals/forget`, CNIL §6.2). The Cookies page has *Delete my recordings*.
- **Sampling** (CNIL L1): only the store's share of tabs is recorded (10, 25, 50 or 100 %, 50 by default).

### 3.2 Masking (CNIL M0 to M3)

- M3: every input, select and textarea is masked to nothing.
- S1: passwords and payment data are never collected (blocked areas, masked fields, no pay route loads the recorder; `pay-routes.graph.test.ts`).
- **M0 and the "balanced" default (Q7).** The CNIL's M0 is to mask all text by default. Kaizena Flow's default, *balanced*, masks text
  people wrote and blocks every area that holds typed or personal data, but shows the store's own text and catalogue pictures unmasked,
  because those are what the store needs to see to find what is hard to use, and they hold no personal data. **This is recorded here as
  the documented alternative measure to M0.** A store can choose *Hide all text* (`strict`), which masks all text. Whether this needs
  more than documenting is open question Q7.

### 3.3 Minimisation and pseudonymisation (CNIL I1)

- A random id per tab, never joined to an account, a cookie id, an order or an A/B visitor (Art. 11 GDPR: the store cannot find a
  person's recordings, and does not try).
- Coarse times and sizes; no IP address or user agent kept; no clock time leaves the browser.

### 3.4 Access and security (CNIL S2)

- Recordings: the store's owner only (step 11; O4 as proposed). Every viewing is written to the activity log before the events are sent, and nothing is sent if it cannot be. Platform admins see counts only (Usage and limits); the DPA
  says so for support conversations, and, since 16 November 2026, says the same for recordings.
- Private buckets reached only by the server with the secret key; files shown through short-lived signed addresses; RLS on every table.
- The ingest checks the same site, the store's own page, robots, privacy signals, private mode, consent, the platform's hold, the plan's
  monthly limit, a day's slot and a request budget (fail closed), and stores the checked body, never the bytes as sent.
- The player (step 11): the server sanitises the recorded events before sending them (`src/lib/replay-sanitize.ts`: event handlers, `srcdoc` and every URL but the admin's own asset paths, the project's public storage and picture data go, in attributes and CSS alike); the replay's frame has no scripts; the player's page sends an enforced Content Security Policy of its own (`replayRouteHeaders()`).

### 3.5 Retention and deletion

- Recordings 30 days; the owner can delete one (audited); the visitor's browser can delete its own.
- Every file is named by its row, and forget, delete, prune and the seal remove exactly their files; nothing outlives its row.

---

## 4. Risks

| Risk to people | Likelihood before measures | Measures | Left |
|---|---|---|---|
| Typed or personal data in a recording | High | Masked fields, blocked areas, the page allow-list without search, the browser's guard that pauses before a refused page is buffered, queries stripped twice, the e2e masking tests | Low; a store's own custom HTML that shows personal data outside a marked area could still be recorded (O3: the store's notice) |
| A recording tied to a person by time or context | Medium | Relative event times, floored and rounded facts, no ids joined, no IP | Low; context in a recording (for example a name shown on a page) could still identify; masking and the page list limit this |
| Special-category data on sensitive stores (health, sexual wellness, religion, politics; CJEU C-252/21, C-21/23) | Medium for those stores | The owner confirms the store sells nothing sensitive and is not aimed at children before recording starts (Q6) | Depends on the owner's confirmation |
| Children (Datatilsynet strongly advises against tracking on services for children) | Medium for those stores | The same confirmation | Depends on the owner's confirmation |
| Hostile HTML in a forged recording reaching the owner's browser | Medium | Same-site, own-page and consent checks, budgets, owner-only access; the player's sanitising, a frame without scripts and an enforced CSP (step 11) | Low; [[Add: a person's review of `replay-sanitize.ts` and its tests]] |
| Recording before the law is settled | — | `platform_settings.recordings_open` stays off until O3, Q3, Q6 and Q7 are answered; only Kaizena Flow's own site may record meanwhile | — |
| Kaizena Flow using stores' recordings for itself | Low | Never built; the DPA says so (O3) | Low |

---

## 5. Necessity and proportionality

The purpose is to find what is hard to use on a store's pages, so the store can fix it. Heatmaps answer most of that with totals and no
personal data; recordings answer what totals cannot (the sequence of what a visitor tried), which is why they are a separate choice,
sampled, masked, kept 30 days and off by default. [[Add: the owner's and lawyer's view on whether the purpose could be met with
heatmaps alone for most stores.]]

---

## 6. Consultation

[[Add: whether visitors or their representatives were asked (Art. 35(9)), and the DPO's advice if one is appointed.]] Prior
consultation with Datatilsynet (Art. 36) is needed only if a high risk remains after the measures: [[Add: the lawyer's view]].

---

## 7. Proposed conclusions (draft)

None of these is a decision. For the owner, with a lawyer:

1. Answer Q3, Q6 and Q7 (`docs/heatmaps-and-recordings.md` section 12) before opening recordings to stores.
2. ~~Write the DPA's types of data, and a sentence in Kaizena Flow's privacy notice (O3).~~ Written 16 November 2026 at the
   owner's request (`src/lib/platform-legal/en.ts`, `nb.ts`); a lawyer should still read them.
3. Decide who may watch recordings (O4): owner only is proposed.
4. Assess the player, built in step 11 (its sanitising and CSP).
5. Each store that records needs its own assessment for its own pages; Kaizena Flow offers this document as the processor's help.

---

## 8. Sign-off

| Role | Name | Date | Decision |
|---|---|---|---|
| Owner of Kaizena Flow | [[Add]] | | |
| Lawyer | [[Add]] | | |
| Data protection officer, if one is appointed | [[Add: whether one is required]] | | |

Review this assessment when what is recorded or masked changes, when the player is built (step 11), before recordings open to stores,
and at least yearly.
