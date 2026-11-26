# Rules: Customers, marketing and analytics

Part of the admin's rules (`docs/rules/admin/README.md`), moved verbatim from `docs/rules/admin.md` on 31 October 2026 (PSI CODE-05).
CLAUDE.md names this file in its map; find a rule by searching for the path, component or table you change.

## Store analytics (D152, `docs/analytics.md`, `/admin/{store}/analytics/…`, store section Analytics)

- Store analytics (D152, `docs/analytics.md`, `/admin/{store}/analytics/…`, store section Analytics): the owner's cockpit. One
  definition per figure, written in `docs/analytics.md` and implemented once: a paid order is `PAID` in
  `src/server/analytics-sql.ts` (captured payment, never copied or host orders; a cancelled paid order still counts and its refund
  is subtracted), amounts are in the store's main currency without VAT, grouped by currency in SQL and converted in code
  (`inMain()`/`toMain()`, a currency with no rate is left out and counted, never summed silently), days are the store's
  (`dayStart()`/`inPeriod()`). Pure parts are `src/lib/analytics-*.ts` (period, KPIs, finance bridge, customers: cohorts, RFM,
  LTV, repeat rate; products, inventory, discounts, subscriptions, traffic and channels, targets, alerts, forecast, diagnosis),
  the queries `src/server/analytics-*.ts` (`periodTotals()`/`overviewData()` first), the pages thin loaders over presentational
  `*-view.tsx` components with `renderToString` tests (`src/components/admin/analytics/`, hand-drawn SVG charts in the admin's
  `--chart-*` tokens, every chart with a data table behind it). A new figure is defined in the doc first; a figure that cannot be
  known is shown as what is missing and how to add it, never as zero; an estimate says so; profit says how much of sales it covers
  (`costCoverageOf()`: line-based, shipping income is not a product). Cost is `product_variants.cost_minor`, copied to
  `order_lines.unit_cost_minor` when sold (`placeOrder()`, the renewal, `copy_orders`), so later changes never rewrite history;
  payment fees, shipping costs, fixed costs and the LTV lifespan are the owner's estimates in `analytics_settings`; ad spend is
  `marketing_spend`; targets `analytics_targets`; all are `never` in `COPY_RULES`. Every analytics query takes the store id and
  the heavy ones run through `setBased()` (a read-only transaction without nested loops, so a store with no planner statistics
  cannot explode; `analytics-perf.int.test.ts` guards it). Visit counting (`stores.visit_counting`, default off; `/api/visit`,
  `VisitBeacon`, `src/server/analytics-visits.ts`) sets no cookie and uses no storage, keeps no IP address or user agent, stores
  only a whitelisted landing path (`placeOfPath()`: never an id or token) and a visitor hash that changes every store day, and
  ties a visit to a cart made that day (`carts.visit_id`) so orders know their channel and device; a visit keeps its tidied tags (`source`, `campaign`, and since D870 `content`, `cleanContent()`), which `postReport()` follows to each post's orders and profit (`docs/analytics.md` "Post"); any new claim about it must
  stay true to that. Alerts, the forecast and the diagnosis are code (`alertsFor()`, `forecastMonth()`, `explainChange()`), with
  minimum volumes; the AI manager's `analytics_overview`, `explain_change` and `analytics_alerts` repeat them and never make a
  number. A rule's input is read in `alertSnapshotFor()` and nowhere else, so the Overview, Home, the alert emails, the briefing and
  the autopilot's alert events read one list; since E4.2 (D729) that includes the heat totals (`pageFrustrationRows()`), the speed
  samples' 75th percentiles (`speedWindowRows()`) and the domains' health over what is kept (`domainAlertRows()`, never a lookup on
  read: the domain watch asks the world once a day, `src/server/domain-watch.ts`).


## The market check (D900, `docs/market-check.md`, `src/lib/market-check.ts`, `src/server/market-check.ts`, `/admin/{store}/analytics/markets`)

- **The market check (D900, `docs/market-check.md`, `src/lib/market-check.ts`, `src/server/market-check.ts`, `/admin/{store}/analytics/markets`)**:
  the store against itself, country by country (M1), then its rivals (M2, M3) and the platform's (M4). Facts are read by code from what the store
  keeps, through the figures' one definition each (`docs/analytics.md` "Markets"): visits and conversion are `marketTraffic()` (the Traffic
  page's countries, shared with `trafficReport()`), orders and revenue `geoReport()`, searches `searchesByMarket()` (its `MISS` and term),
  products with no price or no name in a country's language are counted in `marketCheck()`. Findings are only `marketFindings()` (pure:
  minimum volumes, `twoProportionZ()` for a country against the rest, a fixed order of kinds), worded only by `findingText()`; the AI
  manager's `market_check` and *Make a plan* (`askAboutFinding()`, through `AskAboutAlert`, sent by the person) repeat them and never make a
  number. A new kind of finding is a kind in `FINDING_KINDS` with its rule in `marketFindings()`, its page in `FIX_PATHS`, its words in
  `market-check.en.ts` and `.nb.ts`, and its definition in `docs/analytics.md`. Kaizena Flow's own store reads no orders or prices (it sells
  plans); its sign-ups by country (M1b) are parked while its site sells in one country. Rivals (M2) are added only by a person (the owner's
  own act), and `commerce.market_rivals` and `rival_offers` are written only by `src/server/market-rivals.ts`; an offer is read only by
  `readOfferPage()` (robots.txt first, the page's JSON-LD only, on the rival's own host) and compared only by `priceGap()`, in one currency.
  The SWOT is only the findings drawn by `SWOT_OF`, never a text a model writes. Every read keeps what moved (`keepOffer()`), and the
  dispatcher's `watchRivals()` reads offers again before they go old (M3); a rival's change is an event (`rival_changed`) whose plan always
  waits for the owner's yes: a store's price never follows a rival's by itself. Other platforms' prices (M4, `platform_rival_prices`) are
  kept by a platform admin with their page and checked there by code (`priceOnPage()`), never read off a page by a model. Rivals are every
  store's (D905, M5a): a rival's site is read only from its sitemaps (`readSitemapPaths()`: robots.txt first, each file a page of the day,
  addresses only, never a page's words), weekly by the same watcher (`watchRivalSites()`), its paths kept in `rival_pages` by
  `keepRivalSite()` alone; what needs products (offers, *Read the page*, `read_rival_offer`) stays the shop's. A rival's service price
  (M5d, `rival_service_prices`) is kept only by a person with its page, checked there by code (`priceOnPage()`, when kept and by the
  watcher), and compared (`serviceGap()`) only when found there. Words followed in search (M5b, `search_terms`) are written only by
  `src/server/market-search.ts`, searched only through `searchWeb()` by the watcher, and placed only by `placesIn()`. Sites' speed (M5c,
  `site_speeds`, the key in `speed_settings`) is written only by `src/server/site-speed.ts`, read only from the Chrome UX Report by the watcher,
  and rated only by `speedRating()`.

## Which companies visited (D890, `docs/analytics.md` "Companies", `src/server/company-visits.ts`, `src/lib/company-lookup.ts`, `/admin/{store}/analytics/companies`)

- **Which companies visited (D890)**: a counted page view on a store with `stores.company_recognition` on is looked up after `/api/visit`
  has answered (`recordCompanyVisit()`, loaded only for such a store), through Kaizena Flow's Leadfeeder connection
  (`company_lookup_settings`, platform row, written only by `src/server/company-lookup-admin.ts`, read by `company-lookup-settings.ts`, which
  stays light). The address is sent to Leadfeeder's fixed host only and never written: the day's answer is kept under `lookupKey()` in
  `company_lookups` (two days), the company once in `visit_companies`, a store's day in `company_visits` (no visitor id, never joined to
  visits, carts, orders or customers); `recordCompanyVisit()` and `pruneCompanyVisits()` are their only writers. A sole trader
  (`isSoleTrader()`, Brønnøysund's `ENK`) is never counted or shown. Only the house store may switch it on until it is opened to stores
  (`setCompanyRecognition()`), and the store's Cookies page says it while on (`cookieCompanies`); any new claim must stay true to
  `docs/analytics.md` "Companies".


## Heatmaps and recordings: the owner's screens (D656, `docs/heatmaps-and-recordings.md`, `src/server/page-heat-read.ts`, `src/server/recordings-read.ts`, `src/lib/replay-sanitize.ts`)

- Analytics → Heatmaps (`analytics:read`) reads `src/server/page-heat-read.ts` (every visitor's rows unless a version is chosen, so
  nothing is counted twice) over pictures taken by `runMapShots()` as a robot that refused every optional cookie; a new picture is
  `analytics:write`. Arithmetic is code (`src/lib/heat-read.ts`), and a figure below its minimum volume is left out, never guessed.
- Recordings are the owner's alone (the literal `owner` key; O4). The events route writes `analytics.recording_viewed` to the activity
  log before it sends anything, and sends nothing (503) if it cannot; the events go through `sanitizeEvents()` first; the player keeps
  rrweb's sandbox (never `allow-scripts`, never `UNSAFE_replayCanvas`) under its page's own enforced policy (`replayRouteHeaders()`).
  Platform admins see counts only (Usage and limits, where the owner role holds `recordings_open`) and never watch a store's recordings;
  Kaizena Flow never uses them for itself.
- The switches are on Analytics → Settings, through `storeAction()` with the `owner` key: recordings start only after four
  confirmations (not aimed at children, nothing sensitive sold, the privacy policy says so, and the store's own DPIA, downloadable
  there from Kaizena Flow's template with the store's facts: the lawyer's answer to Q3), with a share of tabs and *Hide all text*.
  The four tables are left out of the export and of a store's copy. A/B behaviour comes from tagged totals (`versionBehaviour()`); the
  `frustratedVersion()` flag warns, never stops. The DPIA draft is `docs/dpia-recordings.md`; review it when what is recorded changes.
- The AI manager reads heatmaps through `page_behaviour` and `version_behaviour` (`src/server/heat-tools.ts`, figures written by
  `src/lib/heat-tools.ts`); page keys come from visitors' browsers and are read as addresses. **No tool reads recordings**: sending them to
  a model would be a new purpose and a new recipient.
## Reports (wave 8 unit A, D345, `docs/wave-8-analytics-ai.md` 3, `docs/analytics.md` Reports)

- **Reports (wave 8 unit A, D345, `docs/wave-8-analytics-ai.md` 3, `docs/analytics.md` Reports)**: Analytics → Reports is a closed
  catalogue (`src/lib/report-catalogue.ts`: `METRICS`, `DIMENSIONS`, `READY_REPORTS`, `specProblems()`, `describeSpec()`; schema
  in `report-catalogue-schema.ts`), never free SQL; a spec is only turned into SQL by `runReport()` (`src/server/report-query.ts`:
  `PAID` orders, keys once in the `cut` CTE (never a parameterised expression in a `GROUP BY`), money per currency converted in
  code, a line cut's rest row so it adds up, profit by `estimatedCogs()` with its coverage). Saved reports are
  `commerce.saved_reports`, written only by `src/server/saved-reports.ts`; the CSV is the `reports/csv` POST. A new figure or cut
  is a key in the catalogue with its definition in `docs/analytics.md` first, its words in the `customReports` catalogue (en, nb),
  its SQL in the compiler and a case in `report-query.int.test.ts` (a money figure with a euro case, a line cut adding up to
  `periodTotals()`). The AI manager asks through `run_report`, `save_report` and `report_catalogue` (D346,
  `src/server/report-tools.ts`, ungated, the rows written out by code), never a query of its own; *Save as report* in the panel
  opens only an address `reportOfResult()` reads in the builder's shape, and the rounds after a report tool are metered as
  `analytics_question`. A saved report emailed on a schedule (D395) is `commerce.report_schedules`, written only by
  `src/server/report-schedules.ts` (recipients only members who may read analytics, `reportRecipients()`) and sent only by
  `sendScheduledReports()` (five-minute dispatcher, a store day claimed in `last_run_on`, each recipient read again, the report
  through `runReport()` alone, the CSV attached).

## Live and revenue after a search (wave 8 unit C, D347, `docs/analytics.md` Live)

- **Live and revenue after a search (wave 8 unit C, D347, `docs/analytics.md` Live)**: the Live page is only `liveFigures()`
  (`src/server/analytics-live.ts`), read again every 10 seconds by `LiveRefresh` while shown, never a socket; a visitor figure
  without counting is null, never 0. A search keeps the day's visit only through `visitKeyOf()` (read the headers while rendering,
  `after()` cannot) passed to `logSearch()`, whose insert finds the visit: never a cookie, storage or a new identifier, and
  erasure deletes the searches of the person's carts' visits. What searches led to is only `searchReport()`'s `afterSearch` (paid
  orders placed after the search from a cart of the same visit, each once); the thresholds of *Found, but rarely opened* are
  `src/lib/analytics-search.ts`.

## Targets, alert emails and the briefing (wave 8 unit D, D348, `docs/analytics.md` Alerts, targets, forecast)

- **Targets, alert emails and the briefing (wave 8 unit D, D348, `docs/analytics.md` Alerts, targets, forecast)**: a target is a metric of
  `TARGET_METRICS` over a period of `TARGET_PERIODS` (`analytics_targets`: `metric`, `period`, `starts_on`, `ends_on`, `target_value` in the
  metric's unit), saved only by `savePeriodTarget()` (and the first form's `saveTarget()`, kept in step by a trigger) and followed only by
  `periodProgress()` through `runningTargets()`. Alert emails are the staff alert event `analytics` (in no one's defaults), sent only by
  `sendAnalyticsAlertEmails()` (once per store day from `ALERT_EMAIL_HOUR`, each alert once by `analytics_alert_sends`, at or above `alert_floor`,
  never good news). The briefing is the staff summary (`summaryEmail()` given `BriefingParts`, `briefingFacts()` in `src/server/briefing.ts`):
  never for a quiet period (`quietPeriod()`), its note only through `checkedNote()`; the store checkup is one function, `checkupFindings()`
  (`src/server/store-checkup.ts`), so a new finding is a key in `CHECKUP_KEYS` with its words in the `staffEmails` catalogues. An alert is handed
  to the AI manager only by `askAboutAlert()`'s words through `ASK_AI_MANAGER_EVENT`.


## Profit per order and the briefing's one-press actions (D415, D416, `src/lib/order-profit.ts`, `src/lib/briefing-actions.ts`)

- **Profit per order and the briefing's one-press actions (D415, D416, `src/lib/order-profit.ts`, `src/lib/briefing-actions.ts`)**: handling and packaging (the owner's cost per order with something to send, `handlingCostMinor`) and return labels as booked (without the standard VAT of the order's country) are costs of an order on the Finance page and in its profit alike, in contribution (D646); an order's profit is
  only `orderProfit()` (pure, `src/lib/order-profit.ts`) over what `orderProfitFor()`/`periodOrderProfits()` read (`src/server/order-profit.ts`), by the
  Finance page's definitions for one order; a goods line without a cost makes it unknown, never a figure that leaves the cost out. A booked label's cost
  is written only by `recordLabelCost()`, once (the database's `shipments_guard()`), without VAT in the order's currency. The briefing's findings take
  their action only from `alertAction()`/`checkupAction()` (`src/lib/briefing-actions.ts`), and every action is a link to a page that prepares the work
  (`reorderDraft()` fills the purchase order form, the thank-you broadcast, the AI manager's box through `?ask=` and `AskOnArrival`): never a link that
  does something by being opened. A new alert with an obvious next step gets its action there.
## Campaigns and first visits (wave 5 unit I3, D303, `docs/wave-5-marketing.md` 12.4)

- **Campaigns and first visits (wave 5 unit I3, D303, `docs/wave-5-marketing.md` 12.4)**: a campaign's figures are only
  `campaignReport()` (`src/server/analytics-traffic-data.ts`) through `campaignRows()` (`src/lib/analytics-campaigns.ts`), last
  visit or `model=first`. A first visit is kept only with statistics consent: `TouchKeeper` and `kaizen_touch_{store}`
  (`src/lib/first-touch.ts`), written onto the day's visit only by `recordTouch()` (`/api/visit/touch`, once per visit); never add
  a cookie to the visit beacon. Imported spend goes only through `importSpend()`, never replacing an entry.

## The subscriber list (wave 5 unit A, D295, `docs/wave-5-marketing.md` 3, `src/lib/marketing-consent.ts`, `src/server/marketing-subscribers.ts`)

- **The subscriber list (wave 5 unit A, D295, `docs/wave-5-marketing.md` 3, `src/lib/marketing-consent.ts`,
  `src/server/marketing-subscribers.ts`)**: who asked for a store's marketing email is only `commerce.marketing_subscribers` (one
  row per store and address, with the words agreed to, when, where, the confirmation and how they left) and its append-only
  history `marketing_consent_events`, written only by that module and moved only as `mayMove()` and the database's
  `marketing_subscribers_rules()` allow (each status change writes its event). A typed address waits for its link (`joinList()`
  with `proof: "link"`, the `marketing.confirm` email, `/account/news/{token}`'s button); a newsletter form's own link (D93) is
  its waiting record and calls `joinList()` when opened; only a signed-in customer with a verified email subscribes at once
  (`setAccountSubscription()`, never telling an unverified one an address is subscribed). Every marketing email will carry the
  subscriber's `token` (the unsubscribe page and one-click POST look it up first, `unsubscribeByToken()`); staff never subscribe
  anyone, only unsubscribe (`marketing:write`), and the export is the owner's. A form's sign-up keeps its form (`source_ref`) and page
  (`source_path`, D850), and the list narrows by either (`listSubscribers()`, `subscriberSources()`). The one other way in is a move from Shopify (D445
  step 8, the owner's Decision 1): `addMovedSubscribers()` adds only those Shopify records as `SUBSCRIBED` with a date
  (`movedSubscriber()`), source `shopify`, Shopify's record as the consent words, confirmed only for a confirmed opt-in, never
  over an address already on the list; a moved subscriber's first broadcast says the shop moved (`m.news.movedReason`). A new way
  to join is a source in `SUBSCRIBE_SOURCES` with its check widened, a new way to leave one in `UNSUBSCRIBE_SOURCES`; never mark
  consent on a customer or an order. Shopper words are `m.news` (hand-written, `HAND_WRITTEN_ONLY`).

## Personal fields in marketing emails (email plan M2.6, `src/lib/personal-fields.ts`)

- **Personal fields (M2.6)**: `{first_name|there}` and `{company|your team}` in a marketing email's subject, preview and words are filled
  per reader by `personalizeContent()` inside `marketingEmail()`, from the subscriber's name, else their account's, and the account's company;
  a test or preview passes no person and shows every fallback, the worst case. A field without a fallback, or one not in `PERSONAL_FIELDS`,
  is refused by `sendProblems()` (broadcasts) and `contentChecks()` (a flow's `personal_field`, blocking). Broadcasts and flows pass the reader;
  the older automations show the fallback. A customer's staff-only fields (D120) are never personal fields.

## Engagement in words (email plan M2.8, `src/lib/engagement.ts`)

- **Engagement (M2.8)**: a subscriber's level is only `engagementLevel()`, from their latest press on a link (`email_clicks`, kept 180 days; no opens are
  kept, M0.1 b) and when they joined: pressed this month, in 3 months, quiet over 3 months, new, or asleep (no press in 6 months); paused when
  the sunset paused them. Shown on the subscribers list and a subscriber's page, for those on the list.
- **The sunset (M2.8, `docs/flows.md`)**: a person is paused only by `pauseSunsetRuns()` (a sunset flow's run ended with no press since it
  began) and woken only by a kept press (`email-clicks.ts`); a paused person stays subscribed and is never deleted, and `suppressed()` holds
  every marketing email to them (broadcasts and automations), never a transactional one.
- **An email's look (M4.1)**: a marketing email's look comes only from `emailLook()`: the live theme's light palette (page, card, words,
  quiet words, lines, the accent and its text), the buttons' and cards' corners, the headings' weight and case, and the fonts named
  before the system's. Each pair that carries words contrasts 4.5 to 1 or keeps the default, and a font name other than letters, digits,
  spaces and hyphens keeps the system's. It is read through `emailLookOf()` (kept five minutes per store), never per recipient from the
  database; without a look, `renderEmail()` draws as it always did, so transactional emails are unchanged.
- **Topics (M4.2, D882)**: `src/server/marketing-topics.ts` is the only writer of `marketing_topics` and `marketing_topic_choices`
  (append only, a row only when the choice changes). A reader is in a topic by their newest choice, else its `default_on`: `inTopic()`,
  read by a broadcast's count, its frozen list and the preference page, never a second rule. A reader's `frequency` and `rest_until`
  are written only by `src/server/email-preferences.ts` (by their token) and held only in `suppressed()`, so every marketing email obeys them. A broadcast's `topic_id` is
  checked as the store's at save; a topic gone stops the start with words.
- **Send time per person (M4.4)**: a broadcast with `best_time` gives each recipient `send_after` only in `startBroadcast()`'s transaction
  (`setOwnHours()`: their own hour of most presses, else the store's, within `QUIET_DEFAULT`, `src/lib/send-time.ts`), and the claim
  waits for it; never with a split test (`BEST_TIME_WITH_TEST`).
- **Split tests (M2.5, D868, `docs/split-tests.md`)**: a broadcast's test is only `broadcasts.test` (version B's subject and preview, share,
  hours); readers are split only by `startBroadcast()` (refused below `audienceNeeded()`) and released only by `callDueTests()`, which calls
  with `callBroadcastTest()` (the A/B engine's `callRates()`, readers who left as the guardrail) once. A model never picks the winner.
- **The lead score (M2.8, D865)**: a business customer's score is only `leadScore()` (`src/lib/lead-score.ts`, pure, each point with its
  reason), its facts only `customerLeadScore()` (one statement: quotes not declined in 90 days, open deals while Deals is on, presses by
  address, product views kept), the page through `customerLeadScore()` and segments through `leadScoresByEmail()`; a customer with no company
  name or company account has none. A model never sets or explains a score.

## Segments and customer tags (wave 5 unit B, D296, `docs/wave-5-marketing.md` 4, `src/lib/segments.ts`, `src/server/segments.ts`)

- **Segments and customer tags (wave 5 unit B, D296, `docs/wave-5-marketing.md` 4, `src/lib/segments.ts`,
  `src/server/segments.ts`)**: a store's people (accounts, buyers by D152's `PAID`, subscribers; by lower-case address) are read
  only by `segmentPeople()`, and a segment is only its rules (`commerce.segments`, `segmentRulesSchema`), matched in code by
  `matches()`/`countSegment()` each time it is read, never a stored member list; money is the main currency without VAT through
  `toMain()` (a currency with no rate makes it unknown, never zero) and the RFM group is D152's own `rfm()`. A new condition is a
  case in `conditionSchema`, `holds()`, `describeCondition()`, `newCondition()`, `CONDITION_KIND_WORDS`, the editor's
  `ConditionFields` and a test, and reads only facts `segmentPeople()` loads (email engagement, M2.4: `clicked`, the latest press from
  `email_clicks`, read by `readSegmentFacts()` only when a rule asks; a customer field, `field`, only of fields the owner marked *Use it in
  segments*, `marketingFields()`, its values used to choose people and never shown or sent, `field-values-readers.test.ts`; products
  looked at, `viewed`, from `customer_product_views`, offered only while views are kept, `viewsKept()`). A segment's people are shown only to staff with
  `customers:read`. Customer tags (`commerce.customer_tags`) are written only by `addTag()`/`removeTag()`, by address, audited
  without it, and are personal data (export, erasure).
  Segments everywhere (wave 11 unit A, D380): a segment's customer types are only `rfmGroups()` (`src/server/analytics-customers-data.ts`, the
  Customers page's own pool and arithmetic), so a new reader of RFM groups asks it. A code or campaign may name a segment (`segment_id`, the
  store's own by a composite key; the segment is kept while one names it, `segmentUses()`), matched for the signed-in buyer only by
  `segmentsOfBuyer()` (`src/server/segment-membership.ts`) in `findUsableDiscount()` and `runningCampaigns()`; a new discount that targets
  people asks it too, with a euro scenario. Bulk tags are only `tagMany()`; a segment's people are paged by `evaluateSegment(…, page)` and
  exported only by `segmentCsv()` (the owner's).
  One view of a person (ecosystem plan E2.4, D713): a customer's page shows the saved segments they are in now through `segmentsOfPerson()`
  (`segmentPeople()` for their address alone, which filters every part of its query by the addresses asked, and every segment's rules matched
  in code; never a query a segment), to `customers:read`, each linked to its page where the viewer may open it; their place on the email list
  (`personSubscription()`) and their number's SMS consent, masked (`personSms()`), only to `marketing:read` (`CustomerMarketing`).

## Broadcasts (wave 5 unit C, D297, `docs/wave-5-marketing.md` 5, `src/lib/broadcasts.ts`, `src/server/broadcasts.ts`)

- **Broadcasts (wave 5 unit C, D297, `docs/wave-5-marketing.md` 5, `src/lib/broadcasts.ts`, `src/server/broadcasts.ts`)**: a
  broadcast is written per language from `broadcastContentSchema`'s blocks (a picture only from the store's own media library, as
  JPEG, PNG or GIF; social links, M4.1, up to `SOCIAL_MAX` profiles, each through `socialHref()` and left out when it is no
  address; columns, M4.1, two or three cells side by side that stack on a phone, a cell's button tracked by its own key
  `nb-NO.3-1` and its picture checked like any other; a block saved by name for later in `email_saved_blocks`, D875, at most 50;
  own HTML under *More blocks*, D879, cleaned by `cleanEmailHtml()` each time it is sent and left out where the builder has no
  cleaner; a hand-written template completed by `completeTemplate()` with the store's running campaigns for an offer and its
  published footer's social links, `siteSocialLinks()`) and sent only to addresses on the subscriber list that are `subscribed` (everyone, or a segment's through
  `segmentPeople()`/`matches()`), frozen into `broadcast_recipients` when the send starts (`startBroadcast()`); the database moves
  its status only as `broadcasts_rules()` allows and fixes its words once sending. Emails go only through `runBroadcasts()` (the
  every-minute `/api/cron/broadcasts` and `after()` the press): one `email_messages` row per recipient under
  `broadcast:{id}:{subscriber}` before Resend is called (`deliverBatch()`), the subscriber's own unsubscribe token and
  `List-Unsubscribe`/`List-Unsubscribe-Post` in every one. A hard bounce or a complaint unsubscribes the address
  (`applyEmailEvent()`). Links go through `/api/marketing/c/…`, which redirects only to the content's own links and counts a press
  (`broadcast_link_clicks`); a recipient's own links carry their signed reference (`p`, D754, `src/lib/email-clicks.ts`), and a
  press with a genuine one by a subscriber still on the list is kept as theirs (`email_clicks`, only through `keepClick()` and `keepFlowClick()`: export,
  erasure, 180 days, said in the privacy notice); never add an open pixel. Orders after any message (a broadcast, an automation
  email, a flow's email, a text) are counted only through `orderCredit()`/`creditOrders()` (D761): each paid order once, for the latest message
  its buyer got in the 7 days before it, so no screen counts an order twice. Every marketing message (broadcast, automation email,
  text) asks the contact policy first (D764, `policyVerdict()` with `recentContacts()`, `src/server/contact-policy.ts`): a held one
  is suppressed or skipped with `cap` or `spacing`, never sent later; a welcome, a cart reminder and back in stock always go, and
  automation emails wait for the reader's daytime while quiet hours are on. AI words are suggestions only, through `findClaims()`
  (feature `marketing_email`). Recipients are personal data (export, erasure, pruned 90 days after a send with its figures kept).

## A store's own sending domain (D727, `src/lib/sending-domains.ts`, `src/server/sending-domains.ts`, `SendingDomainCard`)

- **A store's own sending domain (D727, `src/lib/sending-domains.ts`, `src/server/sending-domains.ts`, `SendingDomainCard`)**: a store (or
  Kaizena Flow, with no store) has at most one sending domain, written only by `src/server/sending-domains.ts`: added to Resend in
  `eu-west-1` (`SENDING_REGION`), its records (DKIM on `resend._domainkey`, SPF and the return path on `send.`; never Resend's
  tracking record, as we count clicks ourselves) written into the zone through `applyDnsChange()` when Kaizena Flow keeps it, else
  shown to copy. Only a `verified` domain sends: `senderFor()` gives `{from_local}@{domain}` to `sendEmail()` and `runBroadcasts()`,
  and an email Resend refuses with it (403 or 422) is sent again from the shared `EMAIL_FROM` (`deliver()`). The daily job
  `daily.sending-domains` asks Resend again about pending and failed domains, and about verified ones each week, so one that breaks goes
  back to the shared address. The card sits on Settings, Notifications (`settings:write`) and on Platform, Emails (`settings`). Adding a
  domain needs Resend's key to have full access; a sending-only key is refused in plain words.
- **The account's own sending domain (D874)**: a row with `organisation_id` (a row is a store's, an account's or Kaizena Flow's own;
  `SendingOwner` in `src/server/sending-domains.ts`). Every store of the account without its own sends from it, order emails and marketing
  alike (`senderFor()`, `marketingRoute()`: the store's own first, then the account's, then the shared address). It is set on Your domains
  by the account's owner only (`ownedAccount()`); a store's card says when it sends from the account's address.
- **Email automation's send allowance (D876, `src/lib/send-allowance.ts`, `src/server/send-allowance.ts`, `SendAllowanceNotice`)**: the
  account's size of email automation (`accountSize()`) sets its `marketing_emails_month` (contacts times emails per contact, in place of the
  plan's number) and its contacts (subscribed, each address once, across its open stores). Broadcasts tells at 80 % and holds a new
  broadcast at the limit (`broadcastRefusal()` in `startBroadcast()`); flows and order emails are never held here. One press moves up
  (`moveUpEmailAction`, the account owner's only; `moveUpExtension()`).
- **Marketing email through Amazon SES (D872, `src/server/ses.ts`, `src/lib/ses.ts`, `/api/ses/events`)**: with `AWS_SES_*` set, a
  store's broadcasts and flows (`SES_KINDS`) go through SES in the EU (`marketingRoute()`: its own domain once SES verified it, else
  Resend's way; the shared address through SES only when it is on Kaizena Flow's own domain and SES verified that). Order, account and
  staff emails never do. Each sending domain is also an SES identity (Easy DKIM, MAIL FROM on `ses.`), its records in `ses_records`
  beside Resend's, written and checked the same way. An SES call that broke off is never repeated (`UNCERTAIN`); an outright refusal goes
  through Resend. SES's events come only from `AWS_SES_EVENTS_TOPIC_ARN`, signed by SNS, and are recorded by `applyEmailEvent()`.

## Flows (D767, `docs/flows.md`, `src/lib/flows.ts` pure, `src/server/flows.ts`, `/admin/{store}/flows`)

- **Flows (D767, `docs/flows.md`, `src/lib/flows.ts` pure, `src/server/flows.ts`, `/admin/{store}/flows`)**: a flow is a trigger, a tree of steps
  (email, wait, wait until, tag, if, end; a wait-until's deadline kept on the run, `flow_runs.wait_ends_at`, the tag put on the address as
  a form's are) and goals, checked by `checkFlow()` and walked by `advance()`, both pure; every save is a version in
  `flow_versions`, switched off until that version is tested (`testFlow()` walks the newest subscriber and sends nothing). People enter
  only from the event log (reader `flows`; the events a flow may start on are `EVENT_TRIGGERS`, each with its person found by
  `emailOfSubject()`, and a new one needs both and its words; a segment trigger reads its segment hourly, `enterSegments()`, D887; a schedule enters everyone or a segment at its time, `enterScheduled()`), once per event and never twice at once (`flow_runs`), and the every-minute marketing job
  moves each due run on one step a turn (`tickFlows()`, one read while no flow is on); an email goes through the sending guard, the
  plan's room, quiet hours and the contact policy, a held one never later. The owner reads a flow as a story (`storyLines()`); the tree is
  one step away, under Customise, drawn as a chart and dragged and dropped (`flow-board.tsx`). A flow that `replaces` an automation switches it off when switched on, and keeps it off. Runs are personal data: exported, erased, gone 90 days after they end.
- **A recipe in the store's voice (D897, `src/server/flows-voice.ts`)**: after *Start* answers, a flow made from a recipe's ready-made
  words (never the owner's own automation's) is rewritten by `suggestBroadcast()` per email, saved only through `saveFlow(…, { onlyAtVersion: 1 })`
  so an owner's change made meanwhile wins; the flow's page says it is writing (`?voice=1`).

## The sending guard (D730, `src/lib/sending-guard.ts`, `src/server/sending-guard.ts`, `SendingGuardNotice`)

- **The sending guard (D730, `src/lib/sending-guard.ts`, `src/server/sending-guard.ts`, `SendingGuardNotice`)**: a store's marketing email
  (`MARKETING_KINDS`: broadcasts and email automations, never an order's emails) is held when, since the later of seven days ago and its
  last resume, at least 100 were sent and 5 % bounced or 0.3 % were marked as spam (`guardVerdict()`). The check runs when a bounce or a
  spam report on a marketing email arrives (`applyEmailEvent()` calls `guardStore()` for that store), never as a scan of every store.
  While `commerce.sending_pauses` holds the store (`resumed_at` null), `startBroadcast()` refuses, `runBroadcasts()` claims none of its
  recipients (they wait, queued) and `runAutomations()` skips it; its owners get one email in their admin language. The Marketing,
  Broadcasts and Email automations pages show the pause, or a warning at 2 % bounces or 0.1 % spam reports, and an owner with
  `marketing:write` resumes it; counting then starts again from the resume. Platform, Emails lists the stores held now.
  Email reaches the event log (D732): `email.bounced`, `email.complained`, `broadcast.sent` and `marketing.paused` are queued through
  `queue_integration_event()` in the statement that makes them, so they are workflow triggers and webhook topics; a new email event does the same.

## Reserved test addresses are logged, never sent (D792, `src/lib/reserved-address.ts`)

- **Reserved test addresses are logged, never sent (D792, `src/lib/reserved-address.ts`)**: an address on `example.org` or `example.net`
  (or under them; RFC 2606 reserves both, `isReservedAddress()`) is kept whole in `email_messages` as `logged` with `RESERVED_NOTE` and
  never handed to Resend: `sendEmail()` and the broadcast batches (`sendBatch()`) write the row as `logged` in the insert that keeps it,
  and a broadcast counts the recipient as sent, as when sending is not set up. A new path that hands mail to Resend asks too. Only these
  two domains: `example.com` and `.test`, `.example`, `.invalid` are what the tests deliver to through a stubbed Resend. Made-up people
  (a demo store's seeded customers, D792) use `example.org`, so they cannot bounce against the sending guard or reach anyone, and the email
  log and their timelines still show every email.

## SMS marketing (D565, `docs/sms-marketing.md`, `src/lib/sms.ts`, `src/server/sms.ts`, `/admin/{store}/text-messages`)

- **SMS marketing (D565, `docs/sms-marketing.md`, `src/lib/sms.ts`, `src/server/sms.ts`, `/admin/{store}/text-messages`)**: a
  store texts only through its own 46elks account (`sms_settings`, connected, changed and disconnected by the OWNER; the API
  password encrypted with `SETTINGS_ENCRYPTION_KEY`, read only to send), and only numbers in `sms_subscribers` that are
  `subscribed`: the database refuses a message (`sms_messages_rules()`) for any other, and a number's status moves only as
  `sms_subscribers_rules()` allows, each change written to `sms_consent_events`. Consent is its own, never email's: checkout's
  unticked box keeps it `pending` on the order with the words shown (`keepCheckoutSms()`), made a subscription once the order is
  paid and dropped after 7 days unpaid (`confirmPaidSmsConsents()`). Every text is `smsBody()`: the store's name first and the
  number's own stop link last (`/sms/{token}`, a page with one button, never a stop on GET); a STOP reply on the store's 46elks
  number stops it at once (`/api/sms/{key}/inbound`, the store's inbound key). A campaign (`sms_campaigns`, `marketing:write`)
  goes to every subscribed number or a segment's (by address or account), is priced by 46elks's own dry run per country before it
  starts and refused past the month's cap (`withinCap()`), and makes one queued message a number waiting for its reader's hours
  (`nextSendTime()`: the country's zone, 09 to 20 unless the owner narrows them, never 21 to 08, no Sundays in France). Only
  `runSms()` (the five-minute dispatcher's `sms` job) sends; it stops a store's campaigns once the month's real cost reaches the
  cap. Numbers, their history and the texts sent are personal data (export, erasure, merge).

## Marketing email from the store's own facts (wave 8 unit H, D352, `src/server/broadcast-facts.ts`)

- **Marketing email from the store's own facts (wave 8 unit H, D352, `src/server/broadcast-facts.ts`)**: a broadcast's or automation's
  `product` and `campaign` blocks hold only ids; their picture, price and offer are drawn by code for each recipient's market and language
  (`emailFactsFor()` through `factsForEmail()`, passed to `marketingEmail()` as `facts`), the price by the storefront's rules (`priceLines()`),
  never stored in the content or written by a model; a new sender of marketing email passes the facts too. *Write with AI* chooses them only
  through its read-only tools (`find_products`, `running_campaigns`) and `keepHanded()`; a new fact a writer may use is such a tool, and the
  model still never writes a price, discount or stock figure in its words.

## Email automations (wave 5 unit D, D298, `docs/wave-5-marketing.md` 6, `src/lib/automations.ts`, `src/server/automations.ts`,…

- **Email automations (wave 5 unit D, D298, `docs/wave-5-marketing.md` 6, `src/lib/automations.ts`, `src/server/automations.ts`,
  `src/server/stock-requests.ts`)**: whether back in stock is on comes with `buyFacts()` on the product page (step 2.13, refreshed by
  `saveAutomation()` and `switchAutomation()`); welcome, after a purchase and win-back go only to `subscribed` addresses, once per person and
  trigger (`automation_sends`, written before the email), and only for a moment after the automation's `enabled_at` and within
  `CATCH_UP_DAYS`; their words start from `AUTOMATION_STARTERS` (hand-written, four languages) and every marketing email is built
  by `marketingEmail()` (unsubscribe token and headers). Back in stock is `stock_requests`, written only by `stock-requests.ts`: a
  typed address confirms first, a verified customer's own waits at once, the answer never says whether an address was known, and
  the email goes once when `variant_availability` says it is back and the product is offered, with the price as the storefront
  shows it then (`livePrice()`); a request never subscribes anyone, and is stopped only through `cancelStockRequest()` (the
  confirmation email's link, a page with a button) or `cancelOwnStockRequest()` (the signed-in customer's *Stop*), both answering
  alike whether or not one was found (D392). Both run in `runAutomations()` from the every-minute marketing job; audit actions are
  `marketing_automation.*`. Shopper words are `m.backInStock` (browser) and `m.stockNotice` (`HAND_WRITTEN_ONLY`). Since D653 two
  more kinds, cross-sell and restock (`PICK_KINDS`), go a set number of days after delivery like after a purchase; each reader's
  email shows up to `PICKS_SHOWN` products chosen by `picksFor()` in code (cross-sell: what other paid orders of the last year had
  with the order's products, never one the address bought; restock: the order's own products that one address bought in two paid
  orders, `rebought`), on sale and in stock, placed into the words by `withPicks()` and drawn by `EmailFacts`; with none it is
  claimed `suppressed` and never goes, and a model never chooses or names them. Every lifecycle kind may have up to two follow-ups
  (`automation_steps`, positions 2 and 3, `FOLLOW_UP_DAYS`), each its days after the email before was sent, keyed
  `{first key}#{step}` with `automation_sends.step`, only to a reader still `subscribed` who has placed no paid order since the
  flow's first email; written only through `saveFollowUp()`/`deleteFollowUp()` (the third moves up when the second goes), edited
  at `/admin/{store}/automations/{kind}/follow-ups/{position}`.

## Discounts in depth (wave 5 unit E, D299, `docs/wave-5-marketing.md` 7, `src/lib/discounts.ts`, `src/server/discounts.ts`)

- **Discounts in depth (wave 5 unit E, D299, `docs/wave-5-marketing.md` 7, `src/lib/discounts.ts`, `src/server/discounts.ts`)**: a
  code reaches products, categories and tags only through `reaches()` (terms by `termsOfProducts()`), its minimum number of items
  and who may use it (groups, named customers) only through `applyDiscount()`/`availability()`, used by `cartSummary()` and
  `placeOrder()` alike (`previewCartCodes()` and `stackForBasket()`); a new condition gets a case in both and a scenario in
  `checkout-kinds.int.test.ts`. Single-use codes are `discount_code_items`, made only by `generateCodes()` and found only by
  `findUsableDiscount()` (an item is used once, counted under its row lock); a code's text is the store's once across codes and
  generated codes (the database refuses another). Several codes on one order (E2): which of a cart's codes apply is only
  `stackCodes()` through `stackForBasket()` (each code's class by `codeClass()`, combinations by `combines()` from
  `combines_with`; the cart holds five, `carts.discount_code` then `more_codes`, changed only by
  `addCartCode()`/`removeCartCode()`/`setCartCode()`); an order keeps its codes in `order_discount_codes` (written by
  `insertOrder()`, never changed) beside the joined text in `discount_code`, so a new reader of a code's uses counts both.
  Campaigns in depth (E3): an amount off (`amounts` per country, `splitAmount()`), free shipping and tiers (`tier_basis`, `tiers`,
  `tierPercent()`) are kinds in `applyCampaigns()`; free shipping is the order's (`orders.campaign_shipping`, inside
  `campaign_discount_minor`, taken before codes, never with a subscription), so a reader of a campaign's uses counts it beside the
  lines' parts (`ordersOf()`); amounts reach the cart through `shownIn()`; how far the next step is is only `nextSteps()` (never a
  promise where another campaign holds the lines); a new kind is a case in `priceOff()` or after the gifts, `describeCampaign()`,
  `noticeText()`, the editor, the checks and a scenario in `checkout-kinds.int.test.ts`. A tier gives a percentage or an amount
  off per market (`tierGive`, a step's `off`, only `tierReward()`; an amount spread over the lines reached, D392). Buy X get Y
  (E4, kind `bxgy`) is only `bxgyOff()` (the buy set is the reach, the get set `get_*` or the same; dearest counted, cheapest
  given, never both, `uses_per_order`); a check that can meet a null is wrapped in `coalesce(…, false)`. Campaigns and codes
  (D367): whether a campaign combines with codes (`campaigns.combines_with_codes`) and a code with campaigns
  (`discount_codes.combines_with_campaigns`), both on by default; where they do not, only `campaignsAndCodes()`
  (`src/server/discount-combinations.ts`) chooses whichever saves the shopper more, for `cartSummary()` and `placeOrder()` alike,
  and the cart says which was left out (`with_campaigns`, `campaignsLeftOut`); a new discount that competes with them is weighed
  there.

## Product reviews (wave 5 unit G, D301, `docs/wave-5-marketing.md` 9, built in steps; G1 writing, G2 checking and showing)

- **Product reviews (wave 5 unit G, D301, `docs/wave-5-marketing.md` 9, built in steps; G1 writing, G2 checking and showing)**:
  only buyers write: a review is of an order line the signed-in customer bought and received, read only by `reviewableLines()`
  (`src/server/reviews.ts`: D298's `SOLD`, goods once the order has `delivered_at`, a download once paid, a service once its
  booking ended and was no no-show, not a gift card, within 365 days), so every written review is a verified purchase; an import
  (G3) is never verified. `commerce.product_reviews` is written only by `src/server/reviews.ts` (the author's
  `writeReview()`/`deleteOwnReview()`) and `src/server/reviews-admin.ts` (staff: publish, hide with a `HIDE_REASONS` reason,
  answer, the publish setting): the database (`product_reviews_rules()`) lets the stars and words change only inside the author's
  write (`kaizen.review_author`), moves the state only as staff may and deletes only where `kaizen.review_delete` is set, so never
  write or change a review another way, and never give staff a way to edit one. Never reward a review or hide one because it is
  negative. What a page shows is only `reviewFacts()` (`src/server/review-facts.ts`, published reviews of that product, cached
  under `reviewsTag(store)`, which every decision, an author's write that changes what is shown and erasure refresh); the parts
  `rating` and `reviews` (feature `reviews`) draw nothing without a published review, and `productJsonLd()`'s
  `aggregateRating`/`review` come from the same facts only. Review words are text in their own language (`lang`), never HTML,
  never translated, never sent to a model. Shopper words are `m.reviews` ({lang}-reviews.ts, by hand; *How reviews are checked*
  and the account intro `HAND_WRITTEN_ONLY`). Reviews are personal data (export section `reviews`, erasure deletes them,
  `buyerKeysOf()`). Requests (G3, `src/server/review-requests.ts`): only `runReviewRequests()` asks, once per order
  (`review_requests`, claimed first), only a `subscribed` address (asking is marketing: `marketingEmail()`, kind
  `marketing.review_request`, counted against the plan), and the emailed link writes only that order's lines through
  `writeReviewAs()` with `invitationOf()`'s `Reviewer`, never a review another way. Imports (G3b) go only through
  `importReviews()` over `readReviewFile()` (the store's own products by handle, `import` reviews never verified, a repeated
  review skipped by `importKey()`), the export through `reviewsCsv()`. Pictures (G4, `src/lib/review-pictures.ts`,
  `src/server/review-picture-store.ts`): `commerce.review_pictures` (three a review, a buyer's only) are written only inside the
  author's write (`writeReviewAs()`'s `pictures`, each checked by `checkPicture()` from its bytes, WebP or the compressor's JPEG
  fallback, 600 KB and 1600 px; files uploaded before the commit) and hidden one at a time only by `setPictureHidden()`; their
  files are named by the picture's id in the private bucket `review-pictures` (`picturePaths()`), read only through
  `pictureForVisitor()` (`/api/reviews/picture/{id}`: published review, picture not hidden, else its signed-in author) and
  `pictureForStaff()` (the admin's route), and removed after the rows go (`removePictureFiles()` from the author's delete, an edit
  and erasure; `pruneReviewPictureFiles()` daily sweeps what a row no longer names), so a new way a review is deleted removes its
  pictures' files or leaves them to the sweep.

## Customers in the admin (wave 10 unit C, D366, `src/server/customer-staff.ts`, `src/server/customer-merge.ts`, `src/server/customer-import.ts`)

- **Customers in the admin (wave 10 unit C, D366, `src/server/customer-staff.ts`, `src/server/customer-merge.ts`, `src/server/customer-import.ts`)**:
  staff's writes on a customer (adding, changing name, email, phone, address, company) go only through `createCustomerIn()`/`updateCustomerIn()`
  over `cleanCustomerInput()` (`src/lib/customer-staff.ts`), which the customer import shares; a changed email is unproven again and its tags and
  notes move with it; a refusal after a write throws inside the transaction so nothing stays. Notes are `commerce.customer_notes` by the person's
  address (never edited, personal data). A merge is only `mergeCustomers()` (plan read again under both rows' locks, refused before anything
  changes for `MERGE_REFUSALS`), so a new table that points at a customer gets a line there (move it, or a refusal) as well as in erasure. The
  customer import is a D165 job (`customer_import`, the owner's) that never sets a password or subscribes anyone and names a row by its number only.
- The list (D603, D834): `customerPage()` (`src/server/customer-admin.ts`) reads a hundred a page with the count of what the search, tag and view find,
  ordered to the email; *Tag everyone the search finds* reads the same search, tag and view again on the server, on every page, at most `BULK_TAG_MAX`.
  Kaizena Flow's Customers page the same (`platformCustomerPage()`).
- Deleting customers (`src/server/customer-delete.ts`, `customers:write`): **Delete** in the bar of the people ticked (at most a page,
  `DELETE_CUSTOMERS_MAX`) and *Delete customer* on a customer's page, each after the admin's dialog. A customer with an order, a subscription,
  a subscription box or a creator profile is kept and counted in the answer: a person to be forgotten goes through Privacy requests. The others
  go with their own deals (about them, no company), notes and tags; a cart and their marketing and text consents are kept without them; audited
  `customer.deleted`. Kaizena Flow's own store never takes in the live drills' test addresses (`DRILL_EMAIL_DOMAIN`, `syncHouseCustomers()`),
  so a deleted drill customer does not come back.

## A customer's timeline (D462, `src/lib/customer-timeline.ts`, `src/server/customer-timeline.ts`, `CustomerTimeline`)

- **A customer's timeline (D462, `src/lib/customer-timeline.ts`, `src/server/customer-timeline.ts`, `CustomerTimeline`)**: a person's and a
  company's timeline only reads what the store keeps (`readTimeline()`); nothing is stored for it. A new kind is a reader in `READERS` through
  `typedRows()`, its events in `TIMELINE_KIND_OF`, its gate in `visibleKinds()` (the permission and feature of the page it comes from, so it never
  shows more than that page would) and its words in the customers catalogue in every admin language; it leaves out what the privacy rules hide (an
  order with `restricted_at` or `anonymised_at` and what hangs on it). What someone typed is an excerpt (`excerptOf()`) shown as text.

## Deals and pipelines (S2, D464, `src/lib/deals.ts`, `src/server/deals.ts`, `DealBoard`)

- **Deals and pipelines (S2, D464, `src/lib/deals.ts`, `src/server/deals.ts`, `DealBoard`)**: a deal (`commerce.deals`), its pipeline and
  stages, what it is linked to (`deal_links`: one order, quote or Work assignment, in one deal only) and its history (`deal_moves`, written by a
  trigger only) are written only by `src/server/deals.ts`, by a member with `customers:write` while the feature `sales` is on; linking an order or
  a quote also needs `orders:read`, a Work assignment Work on and `settings:read`. A deal's value is worked out in one place, `dealValue()`: the
  linked things' amounts before VAT once there are any, else the estimate, in the store's main currency, naming what it could not convert. Only
  the database wins a deal that is not a person's (`deal_win()`: a paid order, an issued Work invoice, or a link to something already paid or
  invoiced), never a closed one and never through a copied order. The feature is offered by the platform (`featureOffered()`: a pilot's
  `stores.sales_pilot`, or `platform_settings.sales_open`); one kept on stays on. The words are the server-only area `deals`; the board's client
  parts get theirs as props.


## Contracts' words and drafts (D695, D856, D857, `src/lib/contract-fields.ts`, `src/lib/contract-rich.ts`, `ContractTextEditor`)

- **Contracts' words and drafts (D695, D856, D857, `src/lib/contract-fields.ts`, `src/lib/contract-rich.ts`, `ContractTextEditor`)**: a template's and a
  draft's paragraphs and clauses are written in `ContractTextEditor` (rich text), never a textarea, and kept as the block's `doc` beside its
  plain `text`. A contract takes paragraphs, bulleted and numbered lists, line breaks, bold, italic and underline only (`contractDoc()`):
  no link, colour, text style or heading inside a block. `text` is always the `doc`'s words (`contractDocText()`, set by `parseBlocks()`,
  never taken as sent), so whatever reads words (fields, the AI manager's tools) reads `text`; a block without `doc` is
  plain text and stays valid. `fillContract()` fills `doc` and `text` with the same fields; `ContractDocumentView` draws `doc` as elements,
  never as HTML. A new mark or node is added to `contractDoc()`, the editor's extensions and the view together, with a test in
  `contract-rich.test.ts` and `static-markup.test.ts`.
- **A draft's page (D857, D862)**: *What it says* and *How it will look* side by side from `xl` (the preview kept in view), or stacked at
  full width by the member's choice (kept per browser) and always below `xl`; *Save as template* makes a new template from the words on the
  screen (`templateFromDraft()`, a name in use refused, the draft unchanged). The preview is filled in the browser as the words are
  typed (`fillContract()` from `draftFacts()`), and Send is offered only with nothing unsaved, since sending fills it again from what was
  saved. Each contract says its version (`contractVersions()`, from `replaces_id`) and lists its versions with a declined signer's reason
  (admin page only). The store's contracts are listed at `/deals/contracts` (`listContracts()`), the menu item right under Deals.

## Sales reports (S6, D520, `src/lib/sales-reports.ts`, `src/server/sales-reports.ts`, `SalesView`)

- **Sales reports (S6, D520, `src/lib/sales-reports.ts`, `src/server/sales-reports.ts`, `SalesView`)**: Analytics → Sales, behind the
  store's `sales` feature and `analytics:read`, is read only by `salesReport()` from the deals' own rows: the forecast from every open deal now
  (`forecast()`: by the month it is expected to close, weighted by its stage's `probability`, a deal without one or without an estimate left
  out of the weighted value and said so), the stages from deals made in the period and their `deal_moves` (`stageConversion()`: a skipped
  stage counts as passed, a won deal as past them all), and the people and the time to win from deals won or lost in the period, by the
  store's day (`byPerson()`, `timeToWin()`). Counts and sums only: a deal's title, customer or company is never read for it.
## Activities (S3, D468, `src/lib/activities.ts`, `src/server/activities.ts`, `ActivitiesCard`, `TodayCard`)

- **Activities (S3, D468, `src/lib/activities.ts`, `src/server/activities.ts`, `ActivitiesCard`, `TodayCard`)**: a call, a meeting or a task
  (`commerce.activities`) is written only by `src/server/activities.ts`, by a member with `customers:write` while the feature `sales` is on,
  about the store's own person, company or deal and for a member whose access has not ended (the one who made it unless they chose). What is
  typed is checked by `cleanActivityInput()`: a day in the store's time zone and a time or none, a length only for a meeting. When it is late and
  what *Today* shows are `activityWhen()` and `todayList()`, never worked out again in a page; dates and times are drawn by
  `activityViews()`/`whenText()` in the store's zone. The person it is for is told once on their devices when a timed one is due (the
  dispatcher's `activities` job, claimed by `notified_at`). A deal's activities go with it; a person's or a company's lose the link; a merge
  moves them; an erasure deletes those about the person alone and takes the person off the rest. Audited as `activity.*` with ids only.
  Added and done are events (`activity.created`, `activity.done`, ecosystem plan E5.1, D757), queued by the table's trigger; the note is
  never in a payload.

## Finding companies and do not contact (email plan P5.1, P5.6, D893, `src/lib/prospect-search.ts`, `src/server/prospect-search.ts`, `src/server/do-not-contact.ts`, `/admin/{store}/companies/find`)

- **Finding companies and do not contact (D893)**: Find companies turns the owner's words into filters (`filtersFromWords()`: the model
  chooses SN2025 industry codes from the bundled list and names places; `cleanFilters()` keeps only what is on
  `src/data/no-register-codes.json`), redirects to an address holding them, and asks Brønnøysund's open register for a page of companies
  (`searchUrl()`: `ORG_FORMS` only, never `ENK`, none bankrupt or being wound up). Nothing is kept and nothing is sent. Kaizena Flow's store
  only while P5.3 waits for the lawyer (`house` in the menu, `store.house` in the page and its route). The do-not-contact list
  (`platform_do_not_contact`) holds hashes of folded addresses and domains (`entryHash()`), shared by every store and the platform, never
  removed; `mayContact()` is asked before any outreach is sent, and a found company whose website's domain is on it is marked and its link
  hidden. An entry by hand is a route handler (same-site, `customers:write`), audited with its kind only.
- **Finland (D896)**: `country: "FI"` searches PRH's open register (`FI_HOST`) with one industry (the code without its dot) and one
  municipality by its Finnish name; no headcount. PRH ignores its form filter, so `readFiCompany()` keeps only `FI_FORMS` and drops a company
  ceased, in liquidation or bankrupt; our page of 20 is a fifth of PRH's 100.
- **Reading a found company's site (D894, `src/lib/prospect-reading.ts`, `readCompanySite()`)**: on request, one company at a time, never
  one on the do-not-contact list; the front page through `readWebPage()`; the model says what the company does and scores the owner's site
  criteria (`c=` in the address, from the filter prompt), and the fit is `compareOptions()` in code. Contact shown is `generalAddresses()`
  only (a role name on the company's own domain); the model's sentence goes through `plainSentence()`. Nothing is kept.
  The addresses come from the whole page (`pageEmails()`, footers and `mailto:` links, returned by `readWebPage()` as `emails`, never
  passed to a model by `readWebPageTool()`), else from the contact page (`CONTACT_PATHS`, at most two reads) (D899).
- **The country rules and the outreach gate (D906, `src/lib/outreach-rules.ts`)**: `COUNTRY_RULES` holds the owner's position per country
  and a `legalReading`, null until a lawyer signs; `outreachGate()` is the one check before writing and before sending (country, recipient
  kind, address kind, the do-not-contact list, consent), returns every reason, takes no store, and sends nothing under a row no lawyer has
  read. The do-not-contact hashes are keyed from the settings key (`entryHash()`), which must not be replaced while the list holds entries.

## A leads inbox (S4, D475, `src/lib/leads.ts`, `src/server/leads.ts`, `LeadsList`)

- **A leads inbox (S4, D475, `src/lib/leads.ts`, `src/server/leads.ts`, `LeadsList`)**: leads are read where their requests are (quote
  requests, questions and forms, chats, new subscribers), never copied into a table of their own; only what staff decided about a person is
  kept (`commerce.lead_decisions`, by normalised address), written by `dismissLead()` and `makeLeadDeal()` with `customers:write` while
  Deals is on. A person who has paid for an order (restricted orders left out) or is in an open deal is no lead; a decision hides a person
  until they ask again after it. A new kind of request a person makes of a store joins `leadRows()`, with where it is kept. Leads is a page
  of its own under Customers (`/leads`, ecosystem plan E2.8, D713; `/deals?view=leads` leads there), and each kind of request on a row opens
  where it is kept (`leadSourcePath()`): a quote request's draft, a chat's or a form message's conversation in the support inbox, a form's
  responses (a message D705 kept that the inbox did not take), a subscriber; only for a viewer who may open that page. A form's message is
  read from `form_responses`, never `form_submissions` (which keeps no address of a message, only the limits' counts). Leads have no owner
  yet: that needs a column. Each decision is an event (`lead.dismissed`, `lead.deal_made`, ecosystem plan E5.1, D757), its payload the
  decision with the person's requests as ids (`leadRequestsOf()`), never their address or words.

## Email on the timeline (S5, D476, `src/lib/filed-email.ts`, `src/server/email-filing.ts`)

- **Email on the timeline (S5, D476, `src/lib/filed-email.ts`, `src/server/email-filing.ts`)**: mail to a store's filing address arrives
  through the one inbound pipeline (`support_inbound_emails`, purpose `filing`) and is filed only by `fileReceived()`: from a team member's
  address, while Deals is on, never automatic mail or mail failing DMARC, and only on people the store knows. Its words are a person's data and
  untrusted text: kept for the email bodies' rule, erased with any of its people, drawn as text, and read by no AI unless the DPIA and the
  chat's notice say so first.

## Moving in from Pipedrive (S7, D477, `src/lib/pipedrive.ts`, `src/server/pipedrive.ts`, `src/server/pipedrive-client.ts`)

- **Moving in from Pipedrive (S7, D477, `src/lib/pipedrive.ts`, `src/server/pipedrive.ts`, `src/server/pipedrive-client.ts`)**: the owner's,
  on Settings → Moving in while Deals is on. The token is kept only encrypted (`crm_moves`) and goes to Pipedrive only in the `x-api-token`
  header; nothing is ever written to Pipedrive. A check and an import follow the same rules (`skipOf()`), so the check's counts are the
  import's; a run goes page by page under a lease, each page written and counted in one transaction. Everything brought over is linked in
  `crm_move_links` (by the Pipedrive company), so a second run brings only what is new, and a row deleted or a person erased here is never
  brought back. Customers follow D366 (nobody subscribed or emailed; what the store has wins); imported activities are marked told.

## Creators (wave 11 unit G, D386, `src/lib/creators.ts`, `src/server/creators.ts`)

- **Creators (wave 11 unit G, D386, `src/lib/creators.ts`, `src/server/creators.ts`)**: a store's creator programme (`commerce.creator_settings`,
  on while the shop is, `creator_program_on()`), creators (`commerce.creators`, a signed-in customer's application from `/account/creator`
  with the consent's words kept), their payouts (`commerce.creator_payouts`) are written only by `src/server/creators.ts`; the commission is the
  database's alone (`creator_order_paid()`, `creator_settle_refunds()`, `creator_order_cancelled()` by trigger) in the append-only
  `commerce.creator_commissions`, per currency, never converted. A creator's code is the referral program's link, visit count and consented
  cookie (`validAffiliateCode()`, `affiliate_count_visit()`, `affiliateSite().capture`), unique across both programmes, and `placeOrder()`
  attributes it through `creator_attribute_order()`; a new way to pay, cancel or refund an order needs nothing more, and a new way to place an
  order with a code in play calls it too. The creator's page never names a buyer.

## The social post creator (D870 C1, `src/lib/social-posts.ts` pure, `src/server/social-posts.ts`, `/admin/{store}/social`)

- **The social post creator (D870 C1, `src/lib/social-posts.ts` pure, `src/server/social-posts.ts`, `/admin/{store}/social`)**: posts to copy by
  hand, one per channel of `POST_CHANNELS`, written only by `writeSocialPosts()` (`marketing:write`, AI feature `social_posts`) from a product's
  facts in the store's main market, a published page of its site (`socialPages()`, C1b: its title and search description, linking to it;
  Kaizena Flow's own posts are its store's, from kaizenaflow.com's pages) or the owner's topic, in the store's main language with `brandGuide()`, and kept only in `social_posts`. The
  model never writes a price, a stock level or a link: the price line is the shop's price (`priceLines()`) and the link is `postLink()`'s, one
  reference per batch (`newPostRef()`), so each channel's visits and orders are the post's (S1.1); every caption, title and hashtag passes
  `postClaims()` (the claims filter and the brand's words to avoid) or nothing is kept. What the owner copies is `copyText()`; a channel that
  opens no link in a post (`linkInCaption: false`) gets its link to copy apart. A new channel is a key in `POST_CHANNELS` (and the table's check)
  with its `CHANNEL_SPECS`. A post's picture (C2) is only `socialPicture()` (`src/server/social-pictures.tsx`), drawn by code on request and
  never stored or made by a picture model: the product's own photo (read only from the store's own site or Supabase Storage's public files, with a
  time limit and a size cap), its title, the price line the post was written with and the store's name, in the live theme's colours
  (`paletteOf()`) and the channel's shape (`PICTURE_SIZES`); a post without a product shows `pictureHeadline()`. Its type is the store's heading and
  body fonts (C2b), fetched only by `fontFile()` (`src/server/font-outlines.ts`, `fonts.gstatic.com` alone, as brand marks), its logo the store's
  own (`navigation.logo`, `logoDark` on a dark theme), read as the photo is; a font or logo that cannot be read leaves the picture without it. The page, its routes, the Facebook
  callback, the AI manager's social tools and the weekly review are the paid extension `social` (D870 S1.6, €39 a month, plans chosen by the owner).
  Edited in the person's own Canva (D898 C3, `canva-posts.ts`, `marketing:write`, the `social` extension), a post shows that copy instead, a
  library item (`social_posts.picture_media_id`), until *Use the original picture*; the drawn one is never stored.

## The social calendar (D870 S2.4, `src/lib/social-calendar.ts` pure, `src/server/social-calendar.ts`)

- **The social calendar (D870 S2.4, `src/lib/social-calendar.ts` pure, `src/server/social-calendar.ts`)**: *Your posting plan* on Social posts
  lays the newest advice's plan over this week and next (from today's Monday, `socialCalendar()`), each slot with the newest draft planned for
  its day and channel (`social_posts.planned_for`, written by `writeSocialPosts()` with `plannedFor`); a draft no slot names shows on its own.
  Homer's one button a week (`weekAction()`, worked out on the server): write the slots from today on that have no draft (one `/write` each),
  then approve the week's drafts. Lisa writes, approves or takes back one post, and changes its words (`editSocialPost()`: the channel's
  length, `postClaims()` with the brand's words to avoid, the yes taken back, `edited_at` asking for its picture again). `approveSocialPosts()`
  and `editSocialPost()` are the only writers of `approved_at`, `approved_by` and `edited_at`, through `social/calendar` (`marketing:write`,
  the extension `social`), each audited; phase 3 publishes approved posts only.

## The vision check of a post's picture (D870 S2.3, `src/lib/social-vision.ts` pure, `src/server/social-vision.ts`)

- **The vision check of a post's picture (D870 S2.3, `src/lib/social-vision.ts` pure, `src/server/social-vision.ts`)**: `checkSocialPosts()`
  (the calendar route's `check`, `marketing:write`, the extension `social`) sends each post's picture as it will be posted (`socialPicture()`,
  its Canva one else drawn) as data to `seeing()` with `visionPrompt()` (the post's channel and shape, its product, page or topic, the theme's
  colours, `UNTRUSTED_TEXT`), metered as `social_posts`; `parseVisionVerdict()` reads four answers into `CHECK_PROBLEMS` and a note without
  digits. The only writer of `checked_at`, `check_problems` and `check_note`; no answer leaves a post unchecked, never failed, and
  `editSocialPost()` clears them. The calendar checks each post it writes, shows the verdict, and leaves a failed post out of *Approve the
  week* (`checkFailed()`), for a person to approve on its own.

## How a store's own Instagram posts did (D870 S1.2, `src/lib/social-insights.ts` pure, `src/server/social-insights.ts`)

- **How a store's own Instagram posts did (D870 S1.2, `src/lib/social-insights.ts` pure, `src/server/social-insights.ts`)**: the Instagram
  feed's connection (D560) asks `instagram_business_manage_insights` beside `instagram_business_basic`, and `instagram_accounts.insights` says
  whether the token carries it (`grantsInsights()` over the exchange's permissions; an account connected before is asked to connect again).
  `social_post_insights` is written only by `refreshSocialInsights()` (the dispatcher's `socialInsights` job, never throws): once a day per
  account, its posts of the last `INSIGHTS_DAYS` from `/me/media` and each one's totals (`METRICS` per kind, reach alone where a kind refuses
  them), kept 400 days; Instagram's refusal is the account's `insights_problem`. Only the account's own posts and their counts are read, never
  who liked or saw them. The owner reads them on Social posts (`insightsView()`); Kaizena Flow's own store shows the platform's account while it
  has none of its own.

## A store's Facebook Page (D870 S1.2b, `src/lib/facebook-pages.ts` pure, `src/server/facebook-pages.ts`)

- **A store's Facebook Page (D870 S1.2b, `src/lib/facebook-pages.ts` pure, `src/server/facebook-pages.ts`)**: connected from the Facebook card
  on Social posts (plain forms posted to `/admin/{store}/social/facebook`, `marketing:write`, same site), through Facebook Login with
  `pages_show_list`, `pages_read_engagement` and `read_insights`, back at `/api/integrations/facebook/callback` (state in an httpOnly cookie,
  the same person). The person's token is made long-lived and their Pages listed: one is kept at once; with several, the person's token and
  the Pages' ids and names wait in `facebook_pages` until the owner chooses, then only the Page's own token is kept (encrypted, as payment
  secrets). `refreshFacebookInsights()` (the dispatcher's `facebookInsights`, never throws) reads each chosen Page once a day: its posts of
  `INSIGHTS_DAYS` from `published_posts` with reactions, comments and shares, and with `read_insights` each post's reach and views
  (`PAGE_METRICS`, the newer names first), into `social_post_insights` with channel `facebook` and `page_id`; Facebook's refusal is the
  Page's `problem`. A new connection or a disconnect removes the old Page's figures. Only the Page's own posts and their counts are read,
  never who reacted or saw them. The adviser's facts (`facebook`), the manager's `social_report` and the weekly review carry them.

## The social media adviser's facts (D870 S1.3, `src/lib/social-facts.ts` pure, `src/server/social-facts.ts`)

- **The social media adviser's facts (D870 S1.3, `src/lib/social-facts.ts` pure, `src/server/social-facts.ts`)**: what the adviser is told is
  only `socialFacts()`, worked out by code from what `gatherSocialFacts()` reads, all through the analytics' own readers: 28 days' sales against
  the 28 before (`periodTotals()`), the active goals' progress, the products on sale with margin (`productsReport()`) and stock, social
  channels' visits and sales (`marketingReport()`), tagged posts (`postReport()`), the creator's posts and the Instagram figures
  (`insightsView()`). A product with `LOW_STOCK` or fewer in stock is never offered to push; a figure that cannot be known is null, never 0. The
  owner reads the same object under *What the adviser reads* on Social posts. A new fact is a field of `SocialFacts` with its test.

## The social media adviser (D870 S1.4, `src/lib/social-advice.ts` pure, `src/server/social-advice.ts`)

- **The social media adviser (D870 S1.4, `src/lib/social-advice.ts` pure, `src/server/social-advice.ts`)**: written only by
  `writeSocialAdvice()` (`marketing:write`, AI feature `social_adviser`, the route `/admin/{store}/social/advise`): the store's AI is given
  `socialFacts()` as data and nothing else about the store, with `ADVISER_RULES`, `RULES_STAND`, `UNTRUSTED_TEXT` and the brand, and answers
  three verdicts, recommendations and a two-week calendar. `parseAdvice()` keeps only sentences with no digit, no claim and no avoided word
  (`checkedWords()`), products the facts offered, days of the next two weeks and recommendations that can be acted on; fewer than three verdicts
  keeps nothing. `social_advice` holds the answer with the facts it read (the figures shown beside its words), the newest twenty per store.
  Homer's one button writes the main recommendation's posts through the creator's own route; every other button is Lisa's, one step away.

## The social media adviser's weekly review (D870 S1.5, `src/lib/social-review.ts` pure, `src/server/social-review.ts`)

- **The social media adviser's weekly review (D870 S1.5, `src/lib/social-review.ts` pure, `src/server/social-review.ts`)**: sent only by
  `sendSocialReviews()` (the dispatcher's `socialReviews`, email kind `social.weekly`), the only writer of `social_reviews`: to each person who
  asked the adviser in a store within `REVIEW_ACTIVE_DAYS` (asking is the opt-in), their membership and `marketing:read` read again, from
  Monday `REVIEW_HOUR` in the store's time, once a week (the row claimed before the email goes), when `reviewWorthSending()`. Its figures are
  code's (posts written and copied, tagged posts' visits, orders and sales against the week before, Instagram posts and the best reach), and
  its only words from a model are the newest advice's verdicts and the coming week's plan, checked when written. No model is asked.

## Ad tags and shop events (wave 5 unit I1, D303, `docs/wave-5-marketing.md` 12, `src/lib/shop-events.ts`)

- **Ad tags and shop events (wave 5 unit I1, D303, `docs/wave-5-marketing.md` 12, `src/lib/shop-events.ts`)**: what a shopper does
  reaches the store's tags only through `trackShop()`, passed by `ConsentManager` to the tags the visitor allowed in their own
  words (`mapEvent()` in `shop-event-map.ts`, loaded only when a tag is on); an event carries product ids (SKU else id), names,
  prices as shown and the currency, never a person (search words only through `searchWordsSendable()`). A new tag is an id in
  `TrackingSettings` with its schema, `toolCategories()`, `KNOWN_COOKIES`, `TRACKING_TOOL_NAMES`, its loader and its case in
  `mapEvent()`; the ads tags are store only (`STORE_ONLY_TOOLS`). Pay routes never send an event: checkout and purchases are the
  server's (I2). Server-side conversions (I2, `src/server/ad-conversions.ts`, `src/lib/ad-payloads.ts`): a cart's marketing
  consent and the platforms' ids are written only by `recordAdSignals()`, an order takes them from its cart by trigger, and events
  are made only by `queueAdConversions()` and sent only by `sendAdConversions()` (once per order, platform and event, the order id
  as event id, hashes only at *Enhanced*, never an IP or user agent); tokens are `ad_connections`, written only by
  `src/server/ad-connections.ts`. A new platform is an id in `AD_PLATFORMS`, its host in `AD_HOSTS`, its case in `adRequest()` and
  its words.

## Ad budgets in the owner's own ad account (D585, `docs/agent-spending.md`, `src/lib/ad-budgets.ts`, `src/server/ad-accounts.ts`)

- **Ad budgets in the owner's own ad account (D585, `docs/agent-spending.md`, `src/lib/ad-budgets.ts`, `src/server/ad-accounts.ts`)**: Kaizena Flow never pays for ads: the platform bills the owner as before, and `commerce.ad_accounts` (one per store and
  platform, Meta first; Kaizena Flow's own is its house store's) only lets the store read what the account spends and change a daily budget
  or a switch inside it. `ad-accounts.ts` is the table's only writer and the only caller of Meta's Marketing API (`META_API`); the token is
  encrypted and goes only in the `Authorization` header; Meta's own words never reach a page or a prompt (a refusal is a code with Meta's
  error number). Money is read in the account's currency (only those Meta counts as we do, `AD_CURRENCIES`) and its own month and time zone.
  The owner's monthly limit (`monthly_limit_minor`, null: the AI never raises a budget itself) and `budgets.adRaisePercent` are the
  autopilot's rule (`adChangeProblem()`): a change that cannot spend more always may; a raise needs the limit, stays within the percentage and
  keeps the month's projection (`projectedMonthMinor()`, unknown while a lifetime budget runs) within it. A change is checked against the
  account as Meta has it now (`previewAdChange()`) before it is made, and audited with its figures.

## Product feeds (wave 5 unit H, D302, `docs/wave-5-marketing.md` 13, `src/lib/feeds.ts` pure, `src/server/feeds.ts`, `src/server/feed-settings.ts`)

- **Product feeds (wave 5 unit H, D302, `docs/wave-5-marketing.md` 13, `src/lib/feeds.ts` pure, `src/server/feeds.ts`,
  `src/server/feed-settings.ts`)**: a feed's items come only from `storeFeed()`, over the catalogue's own cached reads, so a price
  is the storefront's (with VAT, in the market's currency, as shown); never price a feed item another way. Files are written only
  by `feedFile()` (Google RSS, the CSVs through `writeCsv()`), a product left out has a reason in `FEED_PROBLEMS`. The address's
  token is `feed_settings` (a hash, and the token encrypted), written only by `feed-settings.ts`; `/api/feeds/{token}/{file}`
  serves only an open store's offered markets with the shop on, cached 15 minutes and under the `feed` budget. A new channel is an
  id in `FEED_CHANNELS`, its extension, columns and a test.

## Saved addresses (wave 5 unit J1, D304, `docs/wave-5-marketing.md` 11.1, `src/lib/customer-addresses.ts`, `src/server/customer-addresses.ts`)

- **Saved addresses (wave 5 unit J1, D304, `docs/wave-5-marketing.md` 11.1, `src/lib/customer-addresses.ts`,
  `src/server/customer-addresses.ts`)**: a shopper's addresses are `commerce.customer_addresses` (20 at most, one default for
  shipping and one for billing), written only by `customer-addresses.ts`, which keeps `customers.address` equal to the default
  shipping address for its older readers; never write either another way. Checkout offers them (`choicesFor()`: the market's
  country only) where Kaizena Flow asks the address itself; the order keeps its own snapshot. Personal data (export section
  `addresses`, erasure deletes), `never` copied. *Your orders* (J2, `/account/orders`) reads its address only through
  `parseAccountOrderParams()` and lists only through `findCustomerOrders()` (own orders, words bound, keyset). A newsletter form's
  welcome code and tags (J3) are given only by `confirmSignup()`: codes only through `issueSignupCode()` (`signup_incentives`,
  once per store, discount and address), tags through `tagFromForm()`; both fields never reach the browser or another owner's
  copy.

## The bonus program (D130, `docs/bonus.md`, `src/lib/bonus.ts`, `src/server/bonus.ts`, SQL `commerce.bonus_*`)

- The bonus program (D130, `docs/bonus.md`, `src/lib/bonus.ts`, `src/server/bonus.ts`, SQL `commerce.bonus_*`): credits (money in
  `bonus_settings.currency`, the store's main currency) that signed-in customers earn on what they pay and use as a price
  reduction. The ledger (`bonus_entries`, `bonus_allocations`) is append-only and only the `bonus_*` functions write it, each once
  per idempotency key; never update or delete an entry, never compute a balance in code from anything but
  `commerce.bonus_balance()`. Orders reach the ledger through triggers (paid, cancelled, refunds), not from application code, so a
  new way to pay, cancel or refund an order needs no extra call. Used credits are a discount: `orders.credit_minor` is included in
  `discount_minor` (`OrderView.discountMinor` excludes it), with each line's share in `order_lines.bonus_discount_minor`;
  `cartSummary()` and `placeOrder()` both use `redeemLimit()` and must agree (`checkout-kinds.int.test.ts`). Credits are applied
  last, after campaigns, group discounts and codes, never on shipping, sign-up fees, subscriptions or a venue's balance. Copied
  orders (D129) and hosts' orders never earn; store copies carry the settings, never balances. Amounts shown in another currency
  are converted with `convertCredits()`, never stored. A customer's level (D392, `src/lib/bonus-levels.ts`) is only
  `commerce.bonus_earn_bps()` over `commerce.bonus_level_spend()` (paid for goods in 365 days, less refunds, the order being paid
  left out), read by `bonus_order_paid()` and `creditState()` alike and never stored; the credit for opening an account is only
  the trigger `customers_bonus_signup` (kind `signup`, once per customer). Never reward a review or a consent with credits.
  Rewards (D401) are only `src/server/bonus-rewards.ts`: each owns a hidden discount code
  (`discount_codes.reward`, `max_units`), redeemed only through `commerce.bonus_redeem_reward()` (kind `reward`) for a code of the customer's
  own (`discount_code_items.customer_id`), so a reward takes off only what the code engine says; the birthday credit is only
  `commerce.bonus_birthday_grants()`. New emails and texts go in `email-text.ts`/`i18n.ts`; an AI tool changing the program is gated.

## The affiliate program (D131, `docs/referrals.md`, `docs/affiliates.md`)

- The affiliate program (D131, `docs/referrals.md`, `docs/affiliates.md`): two levels. Platform (`src/lib/referrals.ts`,
  `src/server/referrals.ts`, `src/server/referral-billing.ts`, SQL `commerce.referral_*`, `/admin/account/referrals`,
  `/admin/platform/referrals`, `/r/{code}`): store owners refer store owners and earn credit, per currency and never converted, on
  the referred store's plan invoices and Kaizen's sale fee, put on their own Kaizen invoices by the billing webhook
  (`invoice.created`: ledger entry first, then one Stripe line, given back on failure or void). Store (`src/lib/affiliates.ts`,
  `src/server/affiliates.ts`, SQL `commerce.affiliate_*`, `/account/referrals`, `/admin/{store}/affiliates`): customers refer
  customers; the friend's welcome discount is decided only by `friendState()` and is part of `discount_minor`
  (`orders.referral_discount_minor`, lines' shares), so `cartSummary()` and `placeOrder()` agree (`checkout-kinds.int.test.ts`);
  the referrer's reward is a bonus credit lot (`bonus_entries.kind = 'referral'`, no order id on the entry) granted and reversed
  by triggers, with every guard (self, not new, blocked, cap, copied and host orders) in SQL. Both ledgers are append-only and
  written only by their SQL functions, each once per idempotency key. Cookies `kaizen_ref` and `kaizen_aff_{storeId}` are
  marketing, set only after consent (`KNOWN_COOKIES`); a code is also kept in memory, never in storage before consent. A referrer
  or an affiliate never sees who a friend is. Two foreign keys (`customers_referred_by_fk`, `affiliate_attributions_friend_fk`)
  are `ON DELETE SET NULL (column)` in SQL, which Drizzle cannot express: never regenerate them from `schema.ts`. A new fee Kaizen
  takes from a store earns the referrer through `commerce.referral_earn()`.

## Product recommendations (D139, `docs/recommendations.md`, `src/lib/recommendations.ts` pure, `src/server/recommend.ts` engine,…

- Product recommendations (D139, `docs/recommendations.md`, `src/lib/recommendations.ts` pure, `src/server/recommend.ts` engine,
  `recommend-settings.ts`, `recommend-events.ts`, `recommend-grid.ts`, `/api/recommendations`, `/admin/{store}/recommendations`,
  `RecommendedGrid`, `RecommendTracker`, `RecommendField`): a product content grid with `source.recommend` (`GridRecommend`; keep
  it through `ownProducts()` when a block is copied to another store) shows the page's stand-in (`standInFor()`: for everyone,
  cached under `recommendTag()` and the catalogue, no cookies, no AI) and the browser swaps in the shopper's own. Candidates come
  only from the store's data; every product passes `recommendable()` (SQL) and the code's exclusions (anchors, cart,
  `purchasedProductIds()`, never-with); `classify()`/`chooseMix()` are pure and tested. The model only orders ids from that list
  (`parseRerank()`, `applyRerank()`, `reasonFits()`), through `aiFor(storeId, { feature: "recommendations" })` and `metered()`,
  kept in `search_cache` (`rerank`), under the owner's monthly token cap, never for the held-out arm; the text under a product is
  `m.recommend.*` with a store-held title, never model text. A new money read here needs a euro scenario; a new recommendation
  source is a `Source` with a weight in `SOURCE_WEIGHT`. The tab's session (`kaizen_rec`, `src/lib/recommend-session.ts`) is
  session storage only and set only while the store's recommendations are on; events carry a random tab id and never a person. The
  chat agent calls `recommendForChat()` (no AI re-rank). New store-owned tables here are `never` in `COPY_RULES`. D140: category
  and tag pages are page roles (`category`, `tag`, the parts of the same names draw `TermListing`; `GridPlace.term` makes a grid
  recommend around the term); `compareArms()` (`src/lib/recommend-eval.ts`) judges the AI's ranking against the plain one on tabs,
  never on impressions, and only with 100 tabs in each; `replayOnOrders()` replays past orders leaving the replayed order out
  (`exceptOrder`), so never let a check learn from what it is checking; the AI manager's recommendation tools share
  `settingsProblems()` and `saveRecommendSettingsValues()` with the form.

## A/B tests of pages (D148, `docs/ab-testing.md`, `src/lib/experiments.ts`, `src/server/experiments.ts`, `experiment-admin.ts`,…

- A/B tests of pages (D148, `docs/ab-testing.md`, `src/lib/experiments.ts`, `src/server/experiments.ts`, `experiment-admin.ts`,
  `experiment-results.ts`, `src/proxy.ts`, `/admin/{store}/experiments`): a version is a page of type `variant` (a copy, no
  address, edited in the builder from its test), a test is `commerce.experiments` with a life cycle the database enforces (draft,
  running, stopped, applied or discarded; one running per page, five per store; versions locked once it runs; a page in a running
  test stays published and no change to it is published: `runningTestOf()`). Only visitors who accepted `statistics` are enrolled:
  `/api/ab/assign` sets `kaizen_ab_{storeId}` and the marker `kaizen_ab` (both in `KNOWN_COOKIES`), the proxy matches only the
  marker (its literal name is in `config`, a test keeps it in step) and rewrites to `/s/{store}/{market}/{slug}/ab/{version}`;
  never read a cookie or call the database for a test for a visitor without the marker (the address shape's facts, D181, are read
  once per store every few seconds, not per visitor). Exposure, clicks and carts are recorded once per visitor and only while the
  test runs; an order counts when paid, from a cart tied to an exposed visitor, never a copied or host's order; revenue is without
  VAT in the store's main currency (`convertMinor`), capped; results are computed on read, the verdict only in `verdictOf()`'s
  plain words and only after the minimum. A new goal is an entry in `GOAL_WORDS`, a recorder, and a column in the results; a new
  money read needs a euro scenario. Never let a test change prices, shipping or discounts, or a legal page. A test of a part
  (phase 2: `experiments.target_part`, `src/lib/experiment-parts.ts`, the builder's "A/B test this" through
  `onTestPart`/`context.experimentsHref`) is a page test whose versions may differ in that part only (`partChanges()`, checked at
  every start) and whose apply puts only the part into the page as it is then (`applyPart()`); anything that copies or compares
  page content for a test goes through those. A scheduled start (`status 'scheduled'`, `scheduleExperiment()`, started by
  `runExperimentJobs()` with the same checks, back to a draft with `schedule_problem` when it cannot) keeps nothing served until
  it runs. A test of the header, footer or a product layout (phase 3, `src/lib/ab-site.ts`) is served by the visitor's versions in
  the market param (`no~{token}{version}`: the proxy rewrites, `resolveShop()` strips them into `ab`, and the market layout and
  product page read them through `siteLayoutForVisitor()`/`productLayoutForVisitor()`); so a new reader of the header, footer or a
  product's layout draws it that way, any code taking the market from a store route's params goes through `resolveShop()`, and a
  version of one of these is a `variant` page saved with `variantOf`. The AI manager's A/B tools (phase 4,
  `src/lib/experiment-tools.ts`, `src/server/experiment-tools.ts`): `explain_results` repeats `experimentResults()`'s verdict and
  never makes one, a draft's words pass `findClaims()` and `applyChanges()`, and
  `start_experiment`/`stop_experiment`/`apply_winner` are `public`-gated with `preflightExperimentTool()` and a summary written
  from the test; admin functions refresh caches through `refreshTag()`, never `updateTag` directly, so the cron and the
  assistant's route work. The platform's view (phase 5, `src/lib/platform-experiments.ts`, `src/server/platform-experiments.ts`,
  `/admin/platform/experiments`) is read-only: it reads results through `experimentResults()` like the owner's page and says what
  needs a look only in `flagsOf()`; a platform admin never changes a store's test, and a new kind of trouble is a flag there with
  a test. The guardrail's stop emails the store's owners and the test's maker through `notifyGuardrailStop()`
  (`src/server/experiment-emails.ts`, words in `src/lib/experiment-emails.ts`): after the stop, once each
  (`experiment.guardrail:{test}:{account}`), never for a person's or the planned end's stop, never throwing, and the email says
  what the counted figures say and never why. The guardrails, the goals `signup` and `page`, forms elsewhere and preview links (D712, D715) keep the rules in `docs/ab-testing.md` "Rules of phases 19 and 20". The search test and the recommendations held-out ranking (phase 7) count with the
  engine's arithmetic, never a formula of their own: `callRates()`, `splitP()` and `sayCall()` in `src/lib/experiment-units.ts`
  (the interval rule for search, the pooled two-proportion rule for recommendations, units `search` and `tab`, each with its
  floor), and `experiment-parity.test.ts` holds them to the old formulas in `experiment-legacy.ts` (tests only; never import it in
  the app). They keep their own logs and units and set no cookie: a new test of an anonymous unit is an arm and a rate going
  through `callRates()`, a row in `platformUnitTests()` and a parity case, never visitor tables. The platform AI manager's A/B
  tools (phase 8, `list_ab_tests` and `explain_ab_test` in `PLATFORM_TOOLS`, `src/server/platform-experiment-tools.ts`) are
  read-only and ungated: they repeat the platform view's flags and the owner's own verdicts, advise only through `adviceFor()`
  (what to tell the owner), and a platform tool that starts, stops or changes a store's test is never added; they are not owner
  tools, so the store's MCP server does not serve them. Modals and working pages (phase 9): a modal row is a part like any other,
  with `partChanges()`'s two rules (it keeps its address name and stays a modal; one that opens by itself, `opensByItself()`, may
  be left out of a version, and `applyPart()` then takes it out of the page), and a working page (`WORKING_ROLES` in
  `src/lib/ab-site.ts`: the page chosen for the cart, checkout, order, account, sign-in, wishlist, subscription or deliveries
  role, kind `role`) is tested by a part around the shop's own component only, never as a whole and never the component itself
  (`testablePart()`), served from its own route: `RolePage` draws `rolePageForVisitor()` and its marker, the proxy adds the
  version token only for that route (`ROLE_SEGMENT`), `experimentOfPage()` leaves it out, and a new working page or route goes in
  `WORKING_ROLES`, `ROLE_SEGMENT`, `ROLE_NAMES`, the migration's list and `RolePage`'s caller passing `ab`; the cookies page and
  the content pages are still refused (migration `ab_working_pages`). The front page and the All products page (phase 10,
  `commerce.page_place()`, `OWN_PLACES`/`TESTED_PLACES` in `src/lib/ab-site.ts`, `placePageForVisitor()`, migration
  `ab_front_pages`) are tested whole or by a part, served from their routes like a working page (the front page matches an empty
  `ROLE_SEGMENT`: nothing after the market), held in place while a test runs (`stores_experiment_guard`); anything asking what
  place a page was chosen for asks `page_place()`, never `page_roles` alone, and a part test compares the original as it would be
  saved (`asSaved()`, because saving keeps only the store's own languages). The goal `form` (phase 11, `recordFormSent()` called
  by `submitForm()`, `formsWithin()`/`goalCandidates()`, `BLOCK_CHOICE`, migration `ab_form_goal`) counts a visitor once per form,
  in the version they were shown, when the site has accepted their answer (never a robot's, a refused or repeated one, or one
  outside the test); a goal that counts a block takes `goal_params.block` and a draft's block is checked against the page
  (`goalCandidates()`), so a new goal of that kind is an entry in `GOAL_WORDS` with its `block`, a recorder, the two check
  constraints and a column in the funnel.
- A started test's page reads from one `experimentCard()` (D659, `src/lib/experiment-card.ts`): its stage, next step, progress and
  each version's likely range at the verdict's own level. The page, `explain_results` and anything new that shows a test's figures
  take them from the card, never from a second calculation, and show no change, range or direction before the minimum (the counts
  stay behind *How we worked this out*). One green button per stage; deciding asks first and stops a running test in the same
  press (`decideExperimentAction`). Applying a whole page keeps the page's address and title. How long a test takes is worked out
  from the shop's own traffic (`experimentTraffic()`, D660) with the results' arithmetic (`src/lib/experiment-traffic.ts`), never
  guessed: a goal the store does not count (a click, a form, revenue) has no estimate but the owner's own figures. Whether a
  version differs is read from the pages as drawn (`parsePageContent()`), never their stored JSON. A test is told to its owners
  once, when `answered_at` is first set (D662); what it taught (`experiments.learning`) is the owner's words, shown and returned
  to the AI as such, never as instructions.

## Campaigns (D114, `src/lib/campaigns.ts`, `src/server/campaigns.ts`, `/admin/{store}/campaigns` under Sales)

- Campaigns (D114, `src/lib/campaigns.ts`, `src/server/campaigns.ts`,
  `/admin/{store}/campaigns` under Sales): offers without a code, for a time: a
  percentage off, "buy N pay for M", a free product over an amount, for the
  store, products, or categories and tags. `evaluateCampaigns()` is what the
  cart (`cartSummary()`) and `placeOrder()` both use, so they agree
  (`checkout-kinds.int.test.ts` needs a scenario for a new kind). Campaigns come
  off goods bought once before the group's discount (D108) and codes (D31),
  which count what is left; a free product is an ordinary order line at a full
  discount (`order_lines.gift`), left out of the cart-changed check and of free
  shipping's basket. A new kind of price or line that discounts keeps these
  together. Campaigns may be limited to customer groups, to a number of orders
  (locked in `placeOrder()`) and may stack (D115). They are announced on product
  pages (the `campaigns` product part) and cards from `campaignNotices()`, a
  cached read like the catalogue's: never read them per request there, keep the
  cache's expiry past five minutes, and refresh `campaignsTag` when a campaign
  changes (`updateTag` in an action, `ctx.invalidate` in an AI tool).
  A campaign may also be per customer (signed in, D116), for some countries
  only, and a stacking "buy N pay for M" works on the units still to be paid
  for; the chat agent's cards carry the offers (`offersOn()`), worded by the
  site, never by the model.
