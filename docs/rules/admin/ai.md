# Rules: The AI manager, the autopilot and AI that builds

Part of the admin's rules (`docs/rules/admin/README.md`), moved verbatim from `docs/rules/admin.md` on 31 October 2026 (PSI CODE-05).
CLAUDE.md keeps one line per rule pointing here; each rule is under that line as its heading.

## The AI manager (D94, D103; `src/server/owner-assistant.ts`, `AiManagerChat`, `AiManagerLauncher`)

- The AI manager (D94, D103; `src/server/owner-assistant.ts`, `AiManagerChat`,
  `AiManagerLauncher`): the admin's assistant for a store's owners
  (`/admin/{store}/assistant`) and platform admins (`/admin/platform/assistant`,
  conversations with a null `store_id`), opened from the headers' button or
  ⌘K as a panel beside the page. `runTurn()` takes a `Principal`
  (`{ account, store | null }`) and the page's `path`; turns go through
  `assistantTurn()` (`src/server/assistant-route.ts`). Tools: the store's
  `OWNER_TOOLS` (`src/lib/owner-tools.ts`, `HANDLERS` in
  `src/server/owner-tools.ts`) or `PLATFORM_TOOLS`, plus `MANAGER_TOOLS`
  (`src/lib/manager-tools.ts`, `src/server/manager-tools.ts`: find and open
  admin pages, skills, memory). A round sends at most `TOOLS_PER_TURN` tools (D333, `chooseTools()`
  in `src/lib/tool-budget.ts`; providers refuse more than 128): the rest are one `load_tools` call away by area, so a new
  store tool needs a permission key (its area) and nothing else; a new tool that most questions need goes in `CORE_TOOLS`. A new tool has zod arguments and a
  description, answers from the site's own data with amounts written by
  `formatMoney` and sums done in code, a line in `TOOL_WORDS`, and a `gate`
  (`send`, `public`, `spend`) if it emails, changes a site or costs money:
  gated calls are only kept (`assistant_approvals`, `approvalSummary()`) and
  run on the person's yes. A new admin page goes in `ADMIN_PAGES`
  (`src/lib/admin-map.ts`; its test fails otherwise); a playbook in
  `ASSISTANT_SKILLS` (`src/lib/assistant-skills.ts`). Memory
  (`commerce.assistant_memories`, SQL only, `src/server/assistant-memory.ts`)
  is per account: `remember`/`forget`, `learnFromTurn()` after each turn and
  thumb (`readLearned()` refuses personal details and secrets),
  `memoriesFor()` each turn, `fadeMemories()` daily; people see and change
  it on the Memory tab and can turn learning off. It never depends on Kaizen
  Life. Analyses (D104, `src/server/owner-insights.ts`) count in code from
  paid orders (a captured payment); AI text for customers (`email_customer`)
  passes `findClaims()`. Voice mode (D104, `useVoice` in
  `src/components/admin/voice-mode.ts`, pure text rules in
  `src/lib/speech-text.ts`): hands-free listening by loudness, the site's
  speech-to-text, the answer spoken sentence by sentence through
  `assistantSpeech()` (`…/assistant/speak`), barge-in; turns carry `voice`.
  A kept change is approved in words only through `decide_approval`, whose
  handler checks `saysYes()` on the person's own message and that the
  change was kept before it.
  Live voice (D105, `src/server/live-voice.ts`, `useLiveVoice` in
  `src/components/admin/live-voice.ts`): with a live model in the AI
  settings (`AiConnection.live`), voice mode is a WebRTC call made by
  `…/assistant/live` (the key stays on the server); the voice has no tools
  and delegates to `…/live/delegate`, which runs the request as a `runTurn()`
  in voice mode (`live`), and the transcript is kept by `…/live/transcript`.
  AI usage (D106, `src/server/ai-usage.ts`, `src/lib/ai-usage.ts`,
  `commerce.ai_usage`): every model call in `src/server/ai.ts` goes through
  `metered()`, which records it for the store its connection was made for:
  get connections with `aiFor(storeId, { feature, accountId })` and name what
  the call is for (`AI_FEATURES`; a new feature is added there). A new kind of
  call is wrapped in `metered()` with the provider's own token figures
  (`tokensOrEstimate()`). Reports: `/admin/platform/ai/usage` and
  `/admin/account/usage` (`UsageReport`); sums are worked out in
  `src/lib/ai-usage.ts`. Cost (D145, `src/lib/ai-cost.ts`, `src/server/ai-prices.ts`, `commerce.ai_model_prices`, `/admin/platform/ai/prices`): prices per model are data the platform's admin keeps, a call is priced by the price in force when it was made (`priceFor`, `costMicrosSql`, `unpricedSql` in `src/server/ai-price-sql.ts`, the one place SQL reads a price; `matchPrice()` and `callCost()` in code). D146: pictures, speech and live calls are priced too (`per_image`, `per_audio_minute`, `per_million_characters`, null = no price); a new kind of use gets its own unit price there, never a new SQL copy. Any new page that shows tokens or other usage shows `costWords()` beside it, and a model with no price shows as such ("No price", a "+" on totals), never as free. Never a price in code.

## The AI manager's marketing tools (PSI AGT-01, D318, `src/server/marketing-tools.ts`)

- **The AI manager's marketing tools (PSI AGT-01, D318, `src/server/marketing-tools.ts`)**: broadcasts, segments, customer tags and email automations, only through the screens' functions (`suggestBroadcast()` then `saveBroadcast()` as a draft; `startBroadcast()`/`scheduleBroadcast()` behind the `send` gate, checked by `preflightSendBroadcast()` and described by `broadcastApprovalSummary()`; `addTag()`/`removeTag()`; `switchAutomation()` behind the `send` gate; `issue_gift_card` through `issueGiftCard()` behind the `spend` gate, always emailed, its code never in an answer). Answers carry counts, never who is on a list. Review moderation has no tool: a review's words never reach a model.

## The AI manager's team and plan tools (PSI AGT-01, D318, `src/server/staff-tools.ts`, `src/server/billing-tools.ts`)

- **The AI manager's team and plan tools (PSI AGT-01, D318, `src/server/staff-tools.ts`, `src/server/billing-tools.ts`)**: `list_staff`, `billing_overview` and the changes `invite_staff`, `change_staff_role`, `remove_staff` (gate `access`: who works in the store and what they may do) and `change_plan`, `end_plan` (gate `spend`) are the owner's (`TOOL_PERMISSIONS` `owner`, as the pages' `requireOwnerRole`), go only through the Staff and Billing pages' own functions (`inviteStaff()`, `inviteCollaborator()`, `assignRole()`, `disableStaff()`, `choosePlan()` for a running plan only, `cancelPlan()` at the period's end or undone, never at once) and read the membership again when they run (`passMembership()`), so a yes never outlives the person's ownership. The first plan is never chosen by a tool: it is paid by card on Stripe's page. A new gate category is a value of `GateCategory`, the `assistant_approvals_category` check widened in a migration and its words in the `assistant` catalogues' `gates`.

## The AI manager's order changes and exchanges (PSI AGT-01, D318, `src/server/order-change-tools.ts`, `src/server/exchange-tools.ts`)

- **The AI manager's order changes and exchanges (PSI AGT-01, D318, `src/server/order-change-tools.ts`, `src/server/exchange-tools.ts`)**: `preview_order_change` and `change_order` (gate `spend`) go only through `previewOrderEdit()`, `applyOrderEdit()` (a lower or equal total, refunded) and `sendOrderEdit()` (a higher total, the pay link emailed to the order's own address); the order's state the owner was shown is kept with the approval (`approved_base`, written by `keepForApproval()`, never the model's) and the change refuses as changed when the order moved. `preview_exchange`, `propose_exchange` (gate `send`: emailed only, never a link, as a withdrawal requires) and `process_exchange` (gate `spend`) go only through `previewExchange()`, `proposeExchange()` and `processExchange()`, replacements at their list price as the order's market shows it (read from the builder's own preview, never priced by the tool) to the order's delivery address; a lower price stays the builder's, by a person.

## The AI manager's Work tools (PSI AGT-01, D318, `src/server/work-tools.ts`)

- **The AI manager's Work tools (PSI AGT-01, D318, `src/server/work-tools.ts`)**: `work_overview`, `list_work_clients`, `list_work_assignments` (`settings:read`), `log_time` and `issue_work_invoice` (`settings:write`, gate `send`) work only while the store has Work on (`store.workOn`) and go only through Work's own functions (`getWorkOverview()`, `logTime()`, `issueInvoice()`, which issues through `commerce.issue_work_invoice()`, and `sendInvoiceEmail()`), with the membership read again; an unready draft is refused before the owner is asked, and amounts stay per currency.

## The AI manager's follow-ups (PSI AGT-04, D318, `src/lib/follow-ups.ts`, `src/server/follow-ups.ts`, `src/server/follow-up-runner.ts`)

- **The AI manager's follow-ups (PSI AGT-04, D318, `src/lib/follow-ups.ts`, `src/server/follow-ups.ts`, `src/server/follow-up-runner.ts`)**: `follow_up` keeps a task in `commerce.assistant_follow_ups` (written only by those two modules); `runFollowUps()` in the five-minute dispatcher gives it back at its time as a `runTurn({ scheduled: true })` in the conversation it was asked in, in the person's name with what their role may do that day (gone member: cancelled; store not open: a day later). A scheduled turn sets no further follow-up and decides nothing in words (`ManagerContext.scheduled`); gated calls are kept as ever. The email (`assistant.follow_up`, `followUpEmail()`) says where the answer is, never the answer. A time from a tool is the store's wall clock through `localInstant()`, never a bare UTC string. An order rule's `ask` action is a follow-up too (`askAiManager()`, `origin = 'rule'`, the order's id): queued in the rule's transaction in the name of whoever last saved the rule while an owner (`saveRule()` refuses it from anyone else, `ASK_OWNER_ONLY`), at most `RULE_LIMITS.asksPerDay` a store in 24 hours.

## The AI manager's notices and saved skills (wave 8 unit F, D350)

- **The AI manager's notices and saved skills (wave 8 unit F, D350)**: what it finished or waits on while the person was away is
  `commerce.assistant_notices`, written only by `addNotice()` in `src/server/assistant-notices.ts` (once per account, kind and reference, never
  throwing; the field is `notice`, so the email-kind scan never takes it for an email), so a new background job that finishes work for a person
  calls it with a kind of `NOTICE_KINDS` (and the table's check) and words in the `assistant` catalogues' `notices.kinds`; a gated call kept in a
  turn nobody is in calls `noticeApproval()`. Counts and lists are only `/admin/account/notices/feed` (`useNoticeCount()`, polling, never a
  socket). A person's saved skills are `commerce.assistant_skills`, written only by `src/server/assistant-saved-skills.ts` after
  `skillProblem()` (`src/lib/saved-skills.ts`); `use_skill` loads one as words only, after the built-ins, so a skill never grants a tool or
  skips a gate.

## AI in the builder and a store from one description (wave 8 unit G, D351)

- **AI in the builder and a store from one description (wave 8 unit G, D351)**: *Change with AI* in the page builder is only
  `changePageWithAi()` (`src/server/page-change-ai.ts`, routes `pages/change` through `src/server/page-change-route.ts`): the model answers a
  plan of `edit_page` changes only (`readChangePlan()`), tried by `dryRunEdits()` and made by `applyPageEdits()` on the editor's copy, which
  the editor takes unsaved as one Undo step; never CSS, script or a link outside `SiteFacts.links`, a new section's pictures left to the person.
  A drafted header or footer is only `draftedLayout()` (the standard parts, never without the footer's legal parts) through
  `draft_header_footer`, shown only through the gated `use_header_footer`. A store drafted from a description is `commerce.store_drafts`,
  written only by `src/server/store-drafts.ts` (`draftStore()`: pages as `build_page` jobs, a theme by id, `readThemeChoice()` for the model's
  choice, installed not live), published only by `publishDraft()` on the owner's press (each page through `savePage()`, the front page, the
  header's menu, `switchToInstall()`); a new part of a drafted store is added there, published by the same press, never before it.

## The autopilot's goals, plans and loop (D309, `docs/ai-autopilot.md` 7; built)

- **The autopilot's goals, plans and loop (D309, `docs/ai-autopilot.md` 7; built)**: goals (`commerce.assistant_goals`, written only by `src/server/autopilot-goals.ts`) are the owner's vision and up to five targets of `GOAL_TARGETS`, measured only by `goalFigures()`/`targetProgress()` from the store's own figures (`periodTotals()`, the catalogue, the pages; not measured, never 0, when a figure cannot be known), and marked met by code. Plans (`commerce.assistant_plans`, `assistant_plan_steps`, written only by `src/server/autopilot-plans.ts` and the loop) are steps of `STEP_KINDS` checked by `checkPlan()` against `offeredTools()` (`src/server/offered-tools.ts`, the tools the turn offers) before anything is written, run in the name of whoever made them, in a conversation of their own; the database holds both life cycles. A plan starts or resumes only on its maker's yes (gate `plan`, `approved_version` kept by `keepForApproval()`, run by `decideApproval()` through `startPlanNow()`); stopping is never gated; a plan's question is answered only in a turn the person is in. The tools are manager tools named `*_autopilot_plan`, `set_goal`, `list_goals`, `drop_goal`. Who acted is `audit_log.acted_by` (`person`, `ai_manager`, `autopilot`), written by `audit()` from `actingAs()` (`src/server/actor.ts`): the AI manager's tool calls and approved calls run as `ai_manager`; a new audit writer in SQL of its own adds `acted_by` with `currentActor()`. The loop (B2, `src/server/autopilot-runner.ts`, `/api/cron/autopilot` every minute): one step per store under its advisory lock, in the plan maker's name read again (`passMembership()`; gone pauses the plan, a closed store stops it); a tool step runs by code, a task step is `runTurn({ scheduled: true, autopilot })` inside `actingAs("autopilot")` with only its tools; every gated call there goes through `autopilotDecision()` (`src/server/autopilot-gate.ts`, `autonomyDecision()` in `src/lib/autopilot-autonomy.ts`: the owner's level per area in `commerce.autopilot_settings`, written only by `saveAutonomy()`, and the budgets) and is run or kept for a yes with `plan_step_id`, which `decideApproval()` settles through `settleStepApproval()`; what worked is only `checkStep()`; three failed tries are a question. A new gated tool is in `TOOL_AREAS` or `NEVER_AUTOMATIC` (a test fails otherwise); a new budget is read as a fact before `autonomyDecision()`. The AI budget counts every call the autopilot made (`ai_usage.acted_by` from `currentActor()`, D334): a background job a turn queues keeps who asked (`acted_by`) and runs inside `actingAs()` as them, and a call no price covers stops the autopilot (`aiBudgetProblem()`); broadcasts are never automatic and emails to one customer are capped a week (`CUSTOMER_EMAIL_TOOLS`, `customerEmailsPerWeek`). The Autopilot page (B3a, `/admin/{store}/assistant/autopilot`, owners; `/admin/platform/assistant/autopilot`) is `AutopilotPage` over `autopilotOverview()`, its buttons `src/server/autopilot-actions.ts` (Start and Resume there are the person's yes for the version shown). The digest and weekly report (B3b) are only `sendAutopilotReports()` (`src/server/autopilot-reports.ts`, the only writer of `commerce.autopilot_reports`, in the five-minute dispatcher): each person read again before sending, a period's row claimed before its email, facts gathered by code (`ReportFacts`, figures from `periodTotals()`), the model's note kept only through `checkedNote()` (no digit, no claim); never a customer or a step's result in them.

## The AI manager's design tools (D308, `docs/ai-autopilot.md` 6.1, `src/lib/design-tools.ts` pure, `src/server/design-tools.ts`)

- **The AI manager's design tools (D308, `docs/ai-autopilot.md` 6.1, `src/lib/design-tools.ts` pure, `src/server/design-tools.ts`)**: `list_themes`, `add_theme` (`installDesignPreset()`, at once: visitors see nothing), `try_theme` (the install's preview) and `make_theme_live` (`switchToInstall()` or `applyDesignPreset()`, always on the owner's yes) go only through Design settings' own functions. The charge the owner was shown is kept with the approval (`approved_charge`, `chargeKey()`, written by `liveApprovalDetails()`, never the model), the approval is a `spend` when the theme costs money (`chargeCosts()`), and the yes is refused when the charge read again differs (`CHARGE_CHANGED`); the autopilot never makes a theme that costs money live (`costsMoney` before `autonomyDecision()`). A new way a tool makes a theme live does the same.

## The agent's eyes (D310, `docs/ai-autopilot.md` 9, `src/lib/page-look.ts` pure, `src/lib/page-look-shoot.ts`, `src/server/page-looks.ts`)

- **The agent's eyes (D310, `docs/ai-autopilot.md` 9, `src/lib/page-look.ts` pure, `src/lib/page-look-shoot.ts`, `src/server/page-looks.ts`)**: `look_at_page` (a page's draft through `/admin/account/look/{page}?t=`, a token for that page only, ten minutes), `look_at_store` (home, a product page, the cart, live) and `get_page_look` are read-only owner tools. A look is a row of `commerce.page_looks` (written only by `page-looks.ts`), taken by `/api/cron/page-looks` alone (asked at once by `triggerLook()`, else every minute), the only route that loads Chromium for it (`page-look-runner.ts`, one browser per width inside `looking()`); its findings are code's (`codeFindings()`), the model's through `seeing()` (feature `page_look`, `UNTRUSTED_TEXT`, read only by `readLookAnswer()` against `LOOK_CHECKS`) and, for a draft, `pageIssues()`'s blocking issues and claims; no photograph is kept, findings 30 days. At most `LOOKS_PER_PAGE` looks of a page an hour; the autopilot's page check with `looks` fails a try on a blocking finding, and the next try is told why. A new check the model may report is a key in `LOOK_CHECKS` with its words.

## Legal pages by AI (D311 unit L, `docs/ai-autopilot.md` 8; L1 sources, L2 writer and L3 upkeep built)

- **Legal pages by AI (D311 unit L, `docs/ai-autopilot.md` 8; L1 sources, L2 writer and L3 upkeep built)**: the official texts a legal page may rest on are the register `LEGAL_SOURCES` (`src/lib/legal-sources.ts`: EU law from Cellar, Swedish from Riksdagen, Danish from Retsinformation, Norwegian from Lovdata's open data), each topic's articles or sections in `TOPIC_REFS`, complaint bodies and authorities as data; which law a store's pages rest on is only `jurisdictionsFor()`/`refsFor()`, never the model. Texts are fetched only from `LEGAL_SOURCE_HOSTS` through `officialFetch()` (`safeFetch()`), cut by `src/lib/legal-passages.ts` and kept only by `src/server/legal-sources.ts` (`legal_source_reads`, `legal_source_texts`, append-only; `readDueLegalSources()` in the five-minute dispatcher); a read that lacks a passage the register names fails and never replaces a good one, so a new reference is a passage the text as read holds. Never cite from a model's memory or a person's typing: pages read `currentLegalTexts()`. The writer (`src/lib/legal-writer.ts` pure, `src/server/legal-writer.ts`, the only writer of `commerce.legal_ai_writes`) plans a page's topics and passages in code, the model writes sentences only with tokens for every fact, link and body, `checkLegalDraft()` refuses a quote not word for word, a number in no cited quote, an address written out, a missing needed token, the ODR platform and claims, and code fills the tokens from `starterFactWords()` (the starters' own words), copies the model form from the law and adds Sources; a page is saved only by `savePageOf()` without the review notice (L3, 8.12): into the kind's page only while it is the AI's and unchanged since (`saved_hash`) or handed back, else a draft beside it (`kept`), never over a person's page; published only with the owner's `auto`, nothing missing and no running test. The owner turns it on once on the Legal page (`commerce.legal_ai_settings`, written only by that module); `runLegalUpkeep()` (five-minute dispatcher, daily per store, in the owner's name read again) queues `first`, `facts_changed` (`factsHash()`) and `source_changed` (`passageHash()` of each cited passage), at most `LEGAL_WRITES_PER_DAY`; a new fact a page uses goes in `legalFacts()` so its hash follows it. A new topic is a brief in `TOPIC_BRIEFS`, its passages in `TOPIC_REFS` and its tokens in `TOPIC_NEEDS`. The hand-written starters and `LEGAL_WORDING_NB` stay as they are.

## The autopilot (D309, D328, `docs/ai-autopilot.md` 7 and 12)

- **The autopilot (D309, D328, `docs/ai-autopilot.md` 7 and 12)**: goals (`src/server/autopilot-goals.ts`, progress only from `goalProgress()`), plans of fixed step kinds checked by `checkPlan()` (`src/server/autopilot-plans.ts`, the only writer of plans and steps besides the loop's runs), the loop `runAutopilot()` and the reviews `runGoalReviews()` in `/api/cron/autopilot`, within the owner's levels and budgets (`autonomyDecision()`, `NEVER_AUTOMATIC`). A goal's review (D328, only with *Keep working toward my goals*) may only read and make one plan; whether it starts is `startDecision()` by code, never the model, and `start_autopilot_plan` stays never automatic as a tool. Reviews are written only by `src/server/autopilot-reviews.ts`. Reacting to events (D331, `docs/ai-autopilot.md` 15, `src/lib/autopilot-events.ts`, `src/server/autopilot-events.ts`): with `planning.reacts` on, a customer waiting for a person, an A/B test that ended by itself and an urgent alert are rows of `commerce.autopilot_events` (written only by that module, once per store, kind and reference) answered by one headless turn with only `EVENT_TOOLS[kind]` and `EVENT_LINES[kind]`; a support event only leaves a staff note (never a word to the customer), a gated call meets `autopilotDecision()`, and an alert's plan starts only by `startDecision()`. A new kind of event is a kind in `EVENT_KINDS` (and the table's check), its finder in `detectEvents()`, its tools and lines, its facts in `eventMessage()`, its still-open check in `stillOpen()` and words in the `assistant` catalogues' `events`.

## Web research (D329, `docs/ai-autopilot.md` 13, `src/lib/web-search.ts`, `src/lib/web-page-text.ts`, `src/lib/research.ts`, `src/server/research.ts`)

- **Web research (D329, `docs/ai-autopilot.md` 13, `src/lib/web-search.ts`, `src/lib/web-page-text.ts`, `src/lib/research.ts`, `src/server/research.ts`)**: searches go only through `searchWeb()` to a `SEARCH_APIS` service at its one host (`searchHostOk()`), with the platform's key from `searchConnection()` (`commerce.search_settings`, written only by `src/server/web-search-settings.ts`), each recorded as `ai_usage` of kind `search` and priced only by `per_thousand_searches`; pages are read only through `readWebPage()` (`safeFetch()`, never a plain `fetch` of an address a model chose); a note cites only addresses in `research_sources` from the last 30 days; a comparison's totals are only `compareOptions()`. A new search service is an entry of `SEARCH_APIS` (request and reader), the `search_settings_provider` check widened, and its host in `SEARCH_HOSTS`.

## Brand and look (D330, `docs/ai-autopilot.md` 14, `src/lib/brand.ts`, `src/lib/brand-design.ts`, `src/server/brand.ts`, `src/server/brand-tools.ts`)

- **Brand and look (D330, `docs/ai-autopilot.md` 14, `src/lib/brand.ts`, `src/lib/brand-design.ts`, `src/server/brand.ts`, `src/server/brand-tools.ts`)**: the brand in words is `commerce.brand_profiles`, written only by `setBrand()` (the tagline through `findClaims()`); a look of the store's own is made only by `designedTheme()` (every colour worked out in code, each pair `themeWarnings()` reads at 4.5:1, so never set a palette from a model's colours directly) and added only by `addOwnLook()` as an install that is not live; it reaches visitors only through `switchToInstall()`. A new named choice a designed look may set is a field of `designLookInput` laid over the base in `designedTheme()`. The logo and icon (F2a, `src/lib/brand-marks.ts`, `src/server/brand-marks.ts`, `src/server/font-outlines.ts`) are drawn by code from the font's outlines, never by a picture model: only `fontOutlines()` fetches a font file (`fonts.gstatic.com` alone), a mark's SVG holds only paths and fills (`pathOk()`), and it reaches visitors only through `set_header_footer`. The brand reaches the writers (F2b) only as `brandGuide()` (the chat's tone as `brandVoiceGuide()`), below each prompt's rules and never as facts, and its words to avoid are found only by `findAvoided()` beside the claims filter; a new AI writer of customer-facing words takes both.

## The AI manager's catalogue tools (D308, `docs/ai-autopilot.md` 3, `src/lib/product-tools.ts` pure, `src/server/product-tools.ts`)

- **The AI manager's catalogue tools (D308, `docs/ai-autopilot.md` 3, `src/lib/product-tools.ts` pure, `src/server/product-tools.ts`)**: `create_product`, `update_product`, `set_prices`, `set_product_status` and `write_product_texts` build `ProductInput` on the editor's own blank product or its own read (`emptyProduct()`, `getProductForEdit()`) and save only through `saveProduct()` with the person as actor; never write a product another way from a tool. A change lays only the fields given over what is there (variants by SKU, never deleted); an existing variant's stock is never written from them (`set_stock`), and a save passes the stock it read (`StockMode.loaded`, source `ai_manager`). New products are drafts; a tool in `GATED_WHEN_LIVE` waits for a yes only while its product is live (`gateNeeded()`, asked by the assistant and the MCP server), `set_product_status` always does, each checked first by `preflightProductTool()` and described by `productApprovalWords()`. Nothing is made (a term, a picture) before everything else is checked; pictures come from the store's own library or `makeSitePicture()`; texts from D76's writer with the product's own facts, through `findClaims()`. A new catalogue tool follows the same shape.

## The AI manager's website tools (D308, `docs/ai-autopilot.md` 4.1, `src/lib/site-tools.ts` pure, `src/server/site-tools.ts`)

- **The AI manager's website tools (D308, `docs/ai-autopilot.md` 4.1, `src/lib/site-tools.ts` pure, `src/server/site-tools.ts`)**: pages, places, menus and the standard header and footer, for a store (`OWNER_TOOLS`) and Kaizena Flow's own site (`PLATFORM_TOOLS`) with the same handlers. A page is saved only by `savePage()`, as a draft unless `publish_page` (gated, never past a blocking accessibility issue or in a running test); changes go through the builder's own functions (`mapTexts()`, `replaceInPage()`, the row edits), tried first by `dryRunEdits()`, never inside a global part (`sharedTextKeys()`); sections are the page studio's (`sectionForPage()`, `buildDraft()`). A build and every picture run after the answer as rows of `commerce.page_ai_jobs` (`runPageJobs()`: `after()` and `/api/cron/page-jobs`), in the name of who asked, who must still be allowed to change the site, never for a store that is not open; never make a page or a picture from a tool inside the turn. Places, menus and the header go through `setFrontPage()`/`setProductsPage()`/`setPageRole()` (`setPlatformPageRole()`), `saveStoreMenu()`/`savePlatformMenu()` and `saveNavigation()`/`savePlatformNavigation()`; a store's menu never links into another store (`otherStoreAddress()`, other stores' domains), a menu waits for a yes only while shown (`menuGateNeeded()`), and the platform's gated calls are checked and gated by `preflightPlatformTool()`/`platformGateNeeded()`. A new site tool is a handler in both catalogues where it makes sense, with its approval words.

## The AI manager's setup tools (D308, `docs/ai-autopilot.md` 5.1, `src/lib/setup-tools.ts` pure, `src/server/setup-tools.ts`)

- **The AI manager's setup tools (D308, `docs/ai-autopilot.md` 5.1, `src/lib/setup-tools.ts` pure, `src/server/setup-tools.ts`)**: `set_store_details`, `set_countries`, `set_languages`, `set_currencies`, `set_flat_shipping`, `save_shipping_method` and `open_store` save only through their screens' savers (`saveStoreDetails()`, `setMarkets()`, `saveLanguages()` with `languagesProblems()`, `saveCurrencies()`, `saveShippingSettings()`, `saveShippingMethod()`, `completeSetup()`), laying what is given over the store as it is, read with `currentStore()` (never the cached `getStore()` inside a turn that changes the store). They run at once while the store is being set up and wait for a yes once it is open (`GATED_WHEN_OPEN`, `setupGateNeeded()`); `open_store` always waits. `setup_progress` says each step's tool or the one thing only the owner can do (payments onboarding, the plan, DNS, a carrier's agreement): never try those. A new setup tool follows the same shape.

## Shopping agents (wave 8 unit I, D353, `src/lib/shopping-agents.ts`, `src/server/shopping-agents.ts`)

- **Shopping agents (wave 8 unit I, D353, `src/lib/shopping-agents.ts`, `src/server/shopping-agents.ts`)**: a store's UCP profile
  (`/.well-known/ucp`), `agents.md` and public MCP endpoint (`/api/ucp/{store}/mcp`, never `/api/mcp`) answer only while `agentProblem()`
  finds nothing (open, real, shop on, not private, AI assistants allowed, `stores.shopping_agents` on, written only by
  `src/server/shopping-agent-settings.ts`); its tools answer only from the storefront's own reads (`getProduct()`, `getVariantStock()`,
  `quoteCart()`) and a cart only through `createHandoffCart()` with `source = 'agent'`; nothing is ordered or paid there, no cookie is set and
  nothing of a person is kept; every call is counted by `takeBudget()` (`agent`). A new tool is an entry of `AGENT_TOOLS` with its capability
  in `TOOL_CAPABILITY` and a case in `runAgentTool()`. An AI channel's feed (`AGENT_FEED_CHANNELS`) is served only while its own switch in
  `feed_settings.channels` is on; a new one is read from its programme's spec first. The `ai_agent` channel is a visit from an AI host or tag,
  or an order from an agent's cart.

## The Dream Factory (D409, `docs/dream-factory.md`, `src/lib/dream-factory.ts`, `src/server/dream-factory.ts`)

- **The Dream Factory (D409, `docs/dream-factory.md`, `src/lib/dream-factory.ts`, `src/server/dream-factory.ts`)**: a run from an owner's
  description to a store ready to open, in `commerce.dream_runs` (one in progress a store) written only by `src/server/dream-factory.ts`. The
  steps, their needs and lanes are `DREAM_STEPS`; a new step goes there with its check in the conductor, and every step ends on a check of
  the store's rows, never the model's word. The brief keeps business details only where the owner's words hold them (`ownBusiness()`): a run
  never sets a company name, number, address or email the owner did not write. The AI's steps are AI manager turns limited to `STEP_TOOLS`
  at *Just do it* for catalogue, website, design and setup only (a store being set up is not open); money, messages and `NEVER_AUTOMATIC`
  keep asking, and `open_store` is never a step's tool: opening is the owner's. A run whose owner is at the drills' test address is a test:
  it stays private, pays in test mode and ends ready to open. `/api/cron/dream-factory` moves runs on every minute, one AI turn a run a
  minute. Started by *Build my store with AI* at self-serve sign-up (`access_requests.dream`), on Your stores (`startDreamStore()`: a new
  store for an owner within their plan's stores or a platform admin, made as *Create a store* makes one, its run in their name; Platform →
  Stores and Platform → AI link there) or on `/admin/{store}/dream-factory`; scored
  on Platform → AI (`scoreOf()`); the live drill `dream_factory` signs up through the real path with `DRILL_PROMPT`.

## A custom app's tools (wave 9 unit J, D363, `src/lib/custom-apps.ts`, `src/server/custom-apps.ts`)

- **A custom app's tools (wave 9 unit J, D363, `src/lib/custom-apps.ts`, `src/server/custom-apps.ts`)**: an owner's MCP apps are written only by
  that module (endpoint and token encrypted, every request through `safeFetch()`); the AI manager offers only `appToolsFor()`'s tools, to owners,
  never in an autopilot step, runs a `read` one through `callAppTool()` and keeps any other for the person's yes (`keepForApproval()`, run by
  `decideApproval()` after the owner and the switch are read again). An app's answer is data, text only, beside `UNTRUSTED_TEXT`; never let an
  app's words choose a tool, a gate or a price.

## Pictures by prompt (D283, `src/lib/picture-direction.ts`, `src/server/picture-maker.ts`, `src/server/picture-route.ts`, `picture-maker.tsx`)

- **Pictures by prompt (D283, `src/lib/picture-direction.ts`, `src/server/picture-maker.ts`, `src/server/picture-route.ts`, `picture-maker.tsx`)**: every
  `ImageUploadButton` under the page editor's `PictureMakerProvider` (`PageOwnerContext.pictures`, set in both `pages/context.ts` while the
  site's AI has a picture model) offers *Make with AI*; a field that must not get a made picture passes `make={false}` (a logo), one with a
  picture passes `current` (making again keeps its shape and words), and the made picture's alt text comes as `onUploaded`'s second
  argument. It is made only through the routes `/admin/{store}/media/make` (`website:write`) and `/admin/platform/media/make`
  (`maxDuration` 300) by `makeSitePicture()` (feature `page_pictures`): the person's words, then the site's look from `pictureDirection()`
  (the live Kaizena Flow theme's pack `look`, the colours as shown, what the site is about; never a model or a fixed style in code), then
  `MADE_PICTURE_RULES`, kept in the media library by `makePicture()`. A theme content's pictures are made again one by one from its Content
  tab (`PackSlotPictures`): only by the pack job (`askToRemakePackPicture()`, a slot's `again`), put in place by `swapPackPicture()` through
  `rewriteAddresses()` with the one before kept (`putBackPackPicture()`); never re-save a pack's pages to place a remade picture.

## Pictures made and edited in the library (wave 8 unit E, D349, `src/lib/picture-edit.ts`, `src/server/picture-editor.ts`)

- **Pictures made and edited in the library (wave 8 unit E, D349, `src/lib/picture-edit.ts`, `src/server/picture-editor.ts`)**: the media library
  and the product editor offer *Make with AI* through the same `makeSitePicture()` (`place`: `library` or `product`, metered `library_pictures`;
  the product editor's route asks `products:write`); a library item's maker is `media.made_by` (`person`, `ai_made`, `ai_edited`), so a new way the
  site's AI keeps a picture passes `madeBy` to `storePicture()`, and a made picture's alt text from a request goes through `checkedAlt()`
  (`findClaims()`). A picture is edited only by `editLibraryPicture()` through `editImage()` (`/images/edits`, the AI settings' *Model that edits
  pictures*, `ai_providers.image_edit_model`, feature `picture_edit`), from the library's own file read by its row, never an address typed; the
  result is a new item with `edited_from`, never over the original. A new edit is a key in `EDIT_ACTIONS` with its prompt in `editPrompt()`.
