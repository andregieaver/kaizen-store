# Rules: The admin's frame, accounts, security and the platform

Part of the admin's rules (`docs/rules/admin/README.md`), moved verbatim from `docs/rules/admin.md` on 31 October 2026 (PSI CODE-05).
CLAUDE.md names this file in its map; find a rule by searching for the path, component or table you change.

## The admin's three levels (D107, `docs/admin-navigation.md`)

- The admin's three levels (D107, `docs/admin-navigation.md`): platform
  (`/admin/platform`), the store owner's control center (`/admin`,
  `/admin/stores`, `/admin/account/…`) and a store (`/admin/{store}`), all in
  one shell, `AdminFrame`: the level switcher and account menu in the header
  (`LevelSwitcher`, `AdminAccountMenu`), the level's daily sections as `tabs`,
  the rest as sidebar `groups`. A level's layout supplies only those; a new
  page goes in exactly one level's tabs or groups and in `ADMIN_PAGES`. The
  platform's sections (D144) and their sidebars are `src/lib/platform-nav.ts` (a new platform page goes in one section's items, or
  in a section with no sidebar, and in `ADMIN_PAGES`; a test fails otherwise) and the shell takes them as `areas` (`NavArea`) with
  `wide`. The store (D147) and the owner's level are built the same way: `src/lib/store-nav.ts` (Orders, Products, Customers,
  Marketing, Website, Bookings, Settings; a new store page goes in one section's items, or Home's, and in `ADMIN_PAGES`, whose
  `group` follows the section; Website and Settings open on pages of cards) and `src/lib/owner-nav.ts` (Home, Stores, Work,
  Account); pages use the whole width, so no `max-w-*xl` on a page's root. The owner's overview is `controlCenter()`
  (`src/server/control-center.ts`, pure
  parts in `src/lib/control-center.ts`); the platform's is `platformOverview()`.
  What needs attention is one source (ecosystem plan E2.1, D713): every item of `attentionFor()` has a kind (`ATTENTION_KINDS`),
  and the queues E2.1 added (disputes, the AI manager's decisions, leads, the day's activities, blog comments) are counted per store in
  SQL in `src/server/attention.ts`, which `controlCenter()` calls with the member's gates and the briefing reads through
  `storeAttention()` (the team's view, in every admin language). A new queue that waits on people is counted there, gated by the key of
  the page that acts on it, given a kind and words in `home`'s `attention`, and so reaches Home and the briefing at once.
  Owner pages go under `/admin/account/…`, never a new `/admin/{word}`, which
  would take a store address. A layout's auth check does not stop its page
  streaming: every page checks for itself.
- The menu is built by `storeNav()` once per shell render; `permissionOfPath()` is memoised by path and access,
  never by anything of the member.

## The admin's look (D149, D217–D232, `src/app/admin/admin.css`, `docs/admin-style.md`)

- The admin's look (D149, D217–D232, `src/app/admin/admin.css`, `docs/admin-style.md`): admin pages are written in the colour
  roles (`bg-card`, `bg-sunken`, `bg-canvas`, `border-line`, `border-edge`, `text-ink`, `text-ink-2`, `text-muted`, `divide-line`,
  `bg-brand text-brand-ink` for the main action, `bg-inverse text-inverse-ink`, `bg-{signal}-soft`/`-solid`, `text-{signal}-text`,
  `border-{signal}-line` with signals `positive`, `warning`, `danger`, `neutral`, `insight`), never the older names
  (`bg-background`, `bg-surface`, `border-border`, `bg-foreground`, which `admin.css` still maps for what draws a store's look)
  and never a fixed palette colour (D224, `admin-type.scan.test.ts`), so they follow the scheme, in light and dark, for free. The
  main action is a `bg-brand text-brand-ink` pill (lifts on hover); a field is an `input`/`select`/`textarea` (brand ring on
  focus, whatever its border class); a form that works sets `aria-busy` on itself (`ActionForm` does) and its disabled submit
  button shows a spinner; a loading placeholder is `animate-pulse rounded-lg bg-background` (it sweeps). Everything that restyles
  an element carries `:not(:is([data-theme-canvas], [data-theme-preview]) *)`, so a store's page previewed in the admin keeps the
  store's look, and every motion has a `prefers-reduced-motion` stop (`admin-css.test.ts` holds the scoping). Its successor is
  designed in `docs/admin-style.md` (colour schemes as roles, `meadow` first, and named layouts, `rail` first). Step 1 is built
  (D217): a scheme is `src/app/admin/schemes/{id}.css` setting every role of `ADMIN_ROLES` (`src/lib/admin-schemes.ts`) in light
  and dark, imported by the admin's root layout before `admin.css`, which reads roles only (never a colour; the old token names
  map onto roles) and `admin-schemes.test.ts` holds each scheme to `CONTRAST_RULES`; new admin code may use the role names
  (`bg-canvas`, `bg-card`, `bg-sunken`, `text-ink`, `text-ink-2`, `border-edge`, `bg-brand text-brand-ink`,
  `bg-{signal}-soft text-{signal}-text`). A new role goes in `ADMIN_ROLES`, every scheme and the `@theme`. Step 2 (D218): the
  admin's components are `src/components/admin/ui/` (`Button`/`ButtonLink`, `Chip`, `TrendChip`, `CountBadge`, `Card`, `KpiTile`,
  `ShareBar`, `ScoreBar`, `InsightPanel`, `List`/`ListRow`, `PageHeader`) with the type scale and shapes as Tailwind names
  (`text-display`, `text-title`, `text-body-strong`, `text-caption`, `text-eyebrow`, `rounded-card`, `rounded-pill`, …); a new
  admin page uses them, and they stay in the roles only (`ui.test.ts`). Step 3 (D219): layouts are `ADMIN_LAYOUTS`
  (`src/lib/admin-layouts.ts`, `classic` and `rail`) chosen per level by `LEVEL_LAYOUTS` and drawn by `AdminFrame`'s `layout`,
  which renders only a layout's regions; a store's admin, the platform (`platformTabs()`) and the owner's level (`ownerTabs()`)
  are `rail` (`AdminRail`: the sections as icon tiles, Settings or Account at the foot by `foot`; D220), hosting `classic`; a new
  level's sections are its tabs, which the rail draws. Step 5 (D221): the schemes are `meadow` (default) and `indigo`, chosen per
  account on Your account (`SchemeField`, `accounts.admin_scheme`, `kaizen_admin_scheme` in the browser, `adminSchemeScript()`
  before paint, `AdminSchemeSync`); a new scheme is a file, an `ADMIN_SCHEMES` entry, an import in the admin's root layout and the
  `accounts_admin_scheme` check widened in a migration. Pages are moving to the components (D223): the admin uses no
  `font-semibold`/`font-bold`, a page's title is `text-display text-ink` (better: `PageHeader`), a section's card `rounded-card`,
  buttons pills (every `button`, `Link` and `a`, D231), section titles `text-title text-ink`, figures `text-metric`, labels
  `text-eyebrow`, boxes within a card `rounded-panel` and a white box on the canvas a card (`CARD_CLASS`, D232)
  (`admin-type.scan.test.ts`; the builder's stand-ins, the theme editor's preview, store previews, packing slips and print routes
  keep their own look); `Stat`/`Attention`/`Section` in `overview-parts.tsx` are drawn with the components. A signed-in page is
  titled by `PageHeader` (`back`, `title`, `status`, `meta` for facts, `description` for a sentence, `actions`; D225, the scan
  test refuses a page's own `h1`) and a section is a `Card` (`title`, `description`, `aside` for its action; D226: a box named
  another way keeps its element with `CARD_CLASS`, never `rounded-card border border-line bg-card`); a list of records (things you
  open, a few facts each, nothing edited or compared down a column) is a `List` in a `Card` with `ListRow`, `RowLead`, `RowFact`,
  `RowActions`, a `Chip` for status and `RowAmount` (D227), and a table stays for figures compared, rows edited or selected, a
  document's lines and values to copy. A page before a person is let in (sign-in, two-step, forgotten password, OAuth consent) is
  drawn by `FocusFrame` (the `focus` layout, D228: Kaizen's mark and one card, `FocusHeading` where the title depends on what the
  page finds), never a `main` or `h1` of its own. A signed-in page that is one task on its own is drawn in `focus` within its
  level by `AdminFrame`'s `focus` (D229: addresses as a pattern, a way back, a title; no rail, sidebar, menu or actions), as the
  store's setup wizard is. A tool with columns of its own (a page editor, the media library, a support inbox) is drawn in
  `workspace` by the level's `fullWidth` pattern (D230: the rail narrowed to 64 px, no sidebar, the whole width), or
  `workspaceLinks` when its section's pages must stay in reach (the inbox: they become links in the top bar, `AreaLinks`). The
  scheme preview page is `/admin/account/appearance` (D222, `SchemePreview`): a scheme's file also styles
  `[data-scheme-preview="{id}"]` (and `[data-preview-mode="dark"]`), so look at a new scheme there before offering it. A new link
  in the admin's frame or a list row is an `AdminLink`, not `next/link`'s `Link`; a raw `Link` there is fetched on sight and
  breaks `e2e/signed-in/prefetch.spec.ts`.

## The admin's links say what they may fetch ahead (bloat review step 2.6)

An admin link is an `AdminLink` (`src/components/admin/ui/link.tsx`: on top of `PolicyLink`, fetched on intent unless a policy is given),
and a new file may not import `next/link` (the ratchet count `directLinks` only falls). The table of policies is in `docs/performance.md`
under *What the router fetches ahead*.

## The admin kit: fields, empty states, confirms, pagers and searches (code review 1.12, D818, `src/components/admin/ui`)

- A field is `Field` (label, hint and the problem under it, tied by `aria-describedby`/`aria-invalid`; `required` marks it) around
  `TextInput`, `Select` or `TextArea` (`fieldClass()` for a box drawn another way); an empty list is `EmptyState` (title, a line, one next
  step); a list's pages are `Pager` (by number or by cursor, links that work without script) and its search `ListSearch` (a GET form,
  `keep` for the list's other values, `tools` in the bar, `aside` beside it).
- Anything that asks first is `ConfirmButton`: the admin's `Modal` with the action's own words (the question's first sentence its title,
  the confirm word, *Cancel* focused), then its `action`, or its form submitted with it as the submitter; `ask={false}` where nothing needs
  asking, `cancel` where *Cancel* would read as the action's own. Never `window.confirm`.
- All but `ConfirmButton` hold no state, so server pages and client parts draw them; its dialog loads on the first hover, focus or press.
  Their words are the server area `kit` handed as props, and `common.form.cancel`. Import `ConfirmButton` from `ui/confirm-button`: the
  kit's index is reached by every route's server code, the storefront's included, so it names no client part but the link (`ui.test.ts`).
- The ratchet (`src/server/ratchet.scan.test.ts`) lists hand-written field boxes and pill links per file (`adminFiles`) and counts the
  files calling `confirm(` (`confirmFiles`) in `src/app/admin`, the platform's and the owner's pages included, and `src/components/admin`;
  none may rise. `docs/admin-style.md` 5.10 has the look.

## Basic and Advanced views (D454, `src/lib/admin-view.ts`, `docs/audits/admin-usability-2026-11.md`)

- Basic and Advanced views (D454, `src/lib/admin-view.ts`, `docs/audits/admin-usability-2026-11.md`): a store's admin lists each section's everyday pages in **Basic**, the default for every account, and every page in
  **Advanced**. The choice is the account's (`accounts.admin_view`, saved by `adminViewAction()` from the switch in a store's top bar, the
  phone's menu and Your account) and is held for the page by `AdminViewProvider` in the store's layout, so the sidebar (`StoreSidebar`,
  `AreaLinks`), the phone's menu and the pages of cards (`HubCards`) follow it at once without a reload. A store page is in Basic when its
  `StoreItem` says `basic: true` or it is where its section's tab leads (`advancedIn()`). Basic hides links, never pages: an address, Home,
  the setup checklist or the AI manager still open any page, and its sidebar then shows it (`shownIn()`). While Basic is on, each
  sidebar's foot, each page of cards and Home say how many pages Advanced adds and that it is where to look when something is missing,
  with one press to switch (`BasicViewHint`). A new store page chooses: `basic: true` only for what most owners use every week
  (`store-nav.test.ts` keeps Basic under half the pages and at most 12 a section). Every page in a sidebar or on a page of cards, at all
  three levels, has an `icon` that `NavIcon` draws (the test refuses a name the set lacks; a new icon is a key in `nav-icons.tsx`, lucide
  at the sections' stroke). The platform and the owner's level have no views. The rail shows its sections' names on screens
  `RAIL_NAMES_WIDE` and wider until the person narrows it, which is kept.

## Dates in the admin (code review 1.14, D786, `src/lib/admin-date.ts`)

- An instant (a `timestamptz`) is shown with `adminDate(zone, at, style, lang)`: the store's zone on a store's screens (`adminDate(store, …)`),
  each row's own store where a screen spans stores (the control center's latest orders, the platform's lists of stores, an account's
  stores), and `PLATFORM_TIME_ZONE` for Kaizena Flow's own figures and records and an account's own. Styles: `day`, `long`, `short`,
  `dayMonth`, `dayTime`, `time`, `iso`.
- A calendar day (a `date` column, or a `YYYY-MM-DD` already worked out in its zone) is shown with `adminDay(day, style, lang)` and never
  moved; `adminDate` shows a bare day as that day too.
- Norway-only features whose days the law or the partner sets (Tripletex, Fiken, Kaizena Flow's own books) use `NORWAY_TIME_ZONE`.
- A store's today for a field or a file name is `todayIn(store.timeZone)` (`src/lib/work-dates.ts`); a typed `datetime-local` is read on
  the store's clock (`storeLocalTime()`, `src/server/discounts.ts`) and written back with `wallClock()`.
- Admin code writes no zone and cuts no date from a UTC string: `src/lib/admin-dates.scan.test.ts`.

## `/admin` has its own root layout

- `/admin` has its own root layout. People sign in with email and password, or
  with a Supabase magic link (`/admin/sign-in` → email → `/auth/callback` or
  `/auth/confirm`); only accounts (`commerce.accounts`) that belong to a store
  or run the platform are admitted (`admit()` in `src/server/sign-in.ts`), and
  every reply is the same whether or not the email has access. A password is
  set or changed at `/admin/account`; `/admin/forgot-password` emails a link
  that signs in and lands there (`next`, checked by `safeNext()`). Password
  rules are in `src/lib/password.ts`.
  There is no proxy: `getAccount()` verifies the session on each request,
  `SessionKeeper` refreshes tokens in the browser (it uses Supabase's auth client alone, `src/lib/supabase/auth-client.ts`, loaded with import() once the page is idle, at most 2 s after it; uploads load the full client on the press through `uploadToSignedUrl()`, `src/lib/supabase/signed-upload.ts`; no admin client module imports the full client statically, bloat review steps 0.9 and 2.31, `admin-bundle.scan.test.ts`), and `SessionRecovery`
  handles an expired token.

## `/admin` lists the account's stores; `/admin/{store}/…` is one store

- `/admin` lists the account's stores; `/admin/{store}/…` is one store. Pages
  and server actions call `requirePermission(storeSlug, key)` (D158; it 404s for stores the
  account is not a member of and for a member whose role lacks the key), never a bare
  `requireMember()`. Actions take the store slug as a bound first
  argument. Owners manage staff and payment keys. Changes are written to
  `commerce.audit_log` with the store id.

## Sign-up and setup (`docs/platform.md`)

- Sign-up and setup (`docs/platform.md`): `/sign-up` stores an access request,
  asked for in three steps of one form (D456, `SignUpWizard`: the store, its
  look, the person; a new field goes in its step, and the page still works
  without scripts);
  platform admins approve at `/admin/platform`, which calls
  `commerce.approve_access_request()` (account + `clone_store()` + decision in
  one transaction) and emails a sign-in link. Owners of a store that is not
  open yet land in the setup wizard, `/admin/{store}/setup/{step}`; progress is
  derived from data in `src/server/setup.ts`, never stored separately.

## `src/server/*.int.test.ts` are integration tests against a real database (`pnpm test:int`, after `scripts/db-setup.mjs --seed`); CI runs them

- `src/server/*.int.test.ts` are integration tests against a real database
  (`pnpm test:int`, after `scripts/db-setup.mjs --seed`); CI runs them. Pass
  inputs through the same validation the app uses.

## Forms use `ActionForm`, which keeps what was typed when validation fails

- Forms use `ActionForm`, which keeps what was typed when validation fails.
  Server actions that change a store call `updateTag()` for its store and
  catalogue tags.

## Unsaved work: one leave guard, and drafts kept in the browser (code review 1.16, D787)

- An editor that holds changes until Save asks before they are left with `useLeaveGuard(dirty)` (`src/components/admin/leave-guard.tsx`,
  listeners in `leave-listeners.ts`, decisions in `src/lib/leave-guard.ts`), never a `beforeunload` listener or `window.confirm` of
  its own. It covers the browser's own leaving (`beforeunload`), a click on any link in the admin (a capture-phase click listener on
  the window, before Next's link) and Back and Forward (the Navigation API's `navigate` event, cancelled before anything moves; else
  a `popstate` listener the admin's first script adds before the router's, `leavePopScript()`, as a window's listeners run in the
  order added), and asks in the
  admin's dialog (`leave-dialogs.tsx`, loaded once the editor is dirty). Draw its `dialog`; an editor's own `router.push` goes through
  `leave(go)`; a link that says it leaves without saving carries `data-leave-anyway`. An editor that saves by itself passes `links`
  (only a failed save asks).
- The page builder and the product editor also keep their unsaved changes in `localStorage` (`useBrowserDraft`,
  `src/lib/browser-draft.ts`): per owner and page, or store and product, written a moment after each change, offered back with
  *Restore unsaved changes* only onto the saved version they were made from (a page's `updatedAt`; a product's stamp without its stock,
  `src/lib/product-draft.ts`, and a restore takes the stock as it is now), removed by a save, by *Leave without saving*, after two
  weeks and at sign-out. Every read and write is tried. The other six editors keep no draft: menus, content types and field groups are
  short work; content entries may hold people's details, kept out of the browser; invoice drafts save themselves and hold a client's;
  the AI page studio's page is kept by the server.
- *Saved* gives way to *Not saved* (or the editor's word for it) on the first change, wherever an editor shows a save state.

## Server actions run through `storeAction()` / `platformAction()` (code review 1.4, `src/server/store-action.ts`): guard, language, one logged failure as a plain line

- A server action runs through `storeAction({ store, key, action, answer }, handler)` (or, on the platform,
  `platformAction({ area, access, action, answer }, handler)`; `src/server/store-action.ts`, code review 1.4): the key is checked
  (a member without it gets *You do not have access to this.* in their language, never a 404), the handler runs in the person's
  language, and anything it throws that nobody planned for is logged once (`action.failed`, the action's name and the store) and
  answered with a plain line in the form, never Next's error page; `redirect()`, `notFound()` and `refresh()` pass through.
  `answer` turns a message into the action's own result shape. The orders, returns and books actions use it; other `actions.ts`
  files move onto it when touched; the ratchet holds the number of files still off the wrapper
  (`adminRepeats.unwrappedActionFiles`).

- The action refreshes; a client part does not. An action that changes what the route shows calls `refresh()` (or `redirect()`),
  and its answer already carries the route drawn again, so the client never calls `router.refresh()` after it (that draws every
  layout and the page a second time). `router.refresh()` stays only where no action refreshed: a poll, a fetch to a route handler,
  an action that by design does not refresh. `src/components/admin/router-refresh.scan.test.ts` holds the count per file, which
  may only fall.

## Plans and billing (`src/server/billing.ts`, decision D18)

- Plans and billing (`src/server/billing.ts`, decision D18): `plans` and
  `plan_prices` (never edited in place: a new amount is a new row) are
  copied to Stripe by `syncPlans(mode)`, which records Stripe ids in
  `stripe_sync`. `assignPlan()` creates a `send_invoice` subscription on
  Kaizen's account with the store's connected account as `customer_account`;
  `applySubscription()` (from actions and `/api/stripe/billing/{mode}`) keeps
  `store_billing` current. Checkout takes `storeFeeBps()`: the store's own
  fee, else its plan's while on it, else `platform_settings.sale_fee_bps`.
  The platform admin lives under `/admin/platform` (requests, stores, plans,
  Stripe). Owners choose and change plans at `/admin/{store}/billing`
  (`choosePlan()`: Stripe Checkout for the first plan, an instant prorated
  change after; `completePlanCheckout()` records it on return), and create
  more stores at `/admin/stores` (`createStoreForOwner()`, decision D19).

## Accounts that own stores (D748, `docs/extensions.md`)

- **Accounts (E1)**: plans, billing and paid extensions belong to the account that owns a store, `commerce.organisations` (steps E1 to E11;
  E1 to E5 built). `stores.organisation_id` is set by the database at commit (`commerce.place_store()`): Kaizena Flow's own stores in the
  one `platform` organisation, every other in its creator's (`commerce.account_organisation()`, named after the store, never a person). No
  code writes it by hand; screens say "account", never "organisation". `src/db/organisations.test.ts` holds the rules.
- **The catalogue (E2, `src/lib/extensions.ts`, `src/server/extensions.ts`, Platform → Plans → Extensions)**: ids are fixed in
  `EXTENSION_IDS`; words, sizes, prices, bundles and grants are rows, a price never changed in place (`replacePrices()`). An account's
  standing is `extensionState()`: the platform always; every account until `platform_settings.extensions_launched_at`; then its plan's
  grants (the account's plan once billed through it, else its stores'), then its own `organisation_extensions` row. The store read carries
  the facts, read against the clock (`storeExtensionsOn()`).
- **The gates (E3)**: an extension's page, item or tool carries `extension`; its pages call `requireExtension()`, its actions and routes
  pass the extension to `checkPermission()`, `requirePermission()` or `storeAction()` (`extension-gates.scan.test.ts`); a job asks
  `commerce.extension_on()`; a writer of extension rows, grants or the launch date calls `refreshExtensionFacts()`. Deals elsewhere are
  `dealsOn(store)`, never `featureOn(store, "sales")`; `store.workOn` includes the Work extension; a desk without its extension is `off`.
- **Billed through the account (E4)**: an account with a row in `commerce.organisation_billing` has one plan, subscription and trial for
  all its stores; one without is billed store by store (`store_billing`). A store's plan, price, status, trial and fee are read from the
  view `commerce.store_plans`, never from either table alone (a budgeted job that already holds the store's row writes the view's rule out
  beside it, as `house-customers.ts` does); revenue counts one line per subscription; limits are the account's plan against its stores'
  use together. A store billed through its account refuses its own plan actions (`ACCOUNT_BILLED`). The account's subscription is
  `src/server/account-billing.ts` (`applyAccountSubscription()` alone writes the account's row and bought extensions from Stripe; metadata
  `kaizen_organisation_id` routes the webhook there). The move to one plan is `moveAccount()` (`src/server/account-move.ts`) alone, under
  `accountLock()`; it alone sets `commerce.billing_move`, which the plan's history and events skip.
- **Trials, markers and read-only (E5)**: a trial starts only through `startExtensionTrial()` (the owner, once per account per extension).
  An absent extension's pages show its marker; one in its grace period or read-only opens them under the store frame's banner, matched by
  `EXTENSION_PATHS` (one list, which `extension-gates.scan.test.ts` reads too); its writes still refuse. Account → Extensions adds or ends
  one through `setAccountExtension()`.
- **The launch (E5)**: `launchExtensions()` (`src/server/extension-launch.ts`) alone sets `extensions_launched_at`, once: every account
  moved or given its row (one made later gets it from `organisation_billed_after_launch`), and a 60-day trial of each extension an account's
  records show it uses (`USED`) and its plan lacks. After it no account is billed store by store: a trial goes on the account's row
  (`writeTrial()`), the platform's plan buttons on a store act on its account, and `daily.extension-trials` emails at 30, 14 and 3 days.

## Free trials and their end (D420, `src/server/store-trial.ts`)

- **Free trials and their end (D420, `src/server/store-trial.ts`)**: self-serve sign-up and every Dream Factory run give a store
  `TRIAL_DAYS` (14) days (`grantTrial()`, once a store: a store that had a trial or is on a plan keeps what it has; after the extensions'
  launch, on its account's row). On the trial the owner
  may look, change and open the store without a plan; a plan chosen before the end is free until then. When it ends with no plan
  (Stripe's status not trialing, active or past due), the dispatcher's `trials` job (`settleTrials()`) makes an open store private through
  `pauseAfterTrial()` in `src/server/private-mode.ts` (the only writer of `private_mode`) and keeps `store_billing.trial_paused_at`; while it
  is set the owner cannot make the store public (`trial_ended`) and opening is refused (`TRIAL_OVER`), and the store's admin says why with
  a link to the Plan page. Once a plan starts the job makes it public again (`reopenAfterPlan()`), and only a store it made private. A store
  template or demo store is never touched.

## Usage and limits (D314, `docs/capacity.md`; the cells of phase 5 are a proposal in `docs/cells.md`)

- **Usage and limits (D314, `docs/capacity.md`; the cells of phase 5 are a proposal in `docs/cells.md`)**: what each store used per UTC
  day and metric (`USAGE_METRICS` in `src/lib/usage-metrics.ts`) is `commerce.store_usage_daily`, written only by `measureDay()`
  (`src/server/usage-meter.ts`, the daily `/api/cron/usage`) and, for requests and server errors, by Vercel's log drain
  (`/api/usage/drain`, `src/lib/usage-drain.ts`, `src/server/usage-traffic.ts`), which keeps no IP address, user agent, path or query;
  a metric no source wrote is *not measured*, never zero (bandwidth today). The counts behind gauges and checks are written once in
  `src/server/usage-sql.ts`. A limit (`LIMITS` in `src/lib/limits.ts`; numbers are only rows of `plan_limits` and `limit_overrides`,
  written only by `src/server/limits-admin.ts`) is the store's override, else its plan's while on it (`ON_PLAN_STATUSES`), else the
  platform default (`plan_id` null), else unlimited, read only through `storeLimits()`/`limitFor()`/`ownerLimitFor()` (a one-minute
  memo; a writer calls `forgetLimits()`); templates and demo stores are never limited. Hard limits refuse only a person's costly action
  through `checkLimit()`/`checkOwnerStores()`/`storageRefusal()` with `limitRefusal()`'s words: uploads, a new product, an invitation,
  a domain, another store, a broadcast or automation past the month's marketing emails, and AI on Kaizena Flow's key (`aiFor()` gives
  no AI); the platform's own copies (templates, themes, demo content, store copies, Compress) are never refused, transactional and
  legal emails are never limited, and traffic is a soft limit that only warns: never take a storefront offline for it. A new costly
  action that a plan should limit is a key in `LIMITS` (and the checks of both tables, by `sqlList()`), its count in `usage-sql.ts`, a
  check at its writer with a test in `limits-enforce.int.test.ts`, and words in the `capacity` catalogue. The read replica
  (`replicaDb()`, `setBasedReplica()`, off without `READ_DATABASE_URL`) is only for the modules `replica-readers.scan.test.ts` lists:
  never a read after a write, a cache refill, checkout, stock, payments or tax reports. Budgets on costly public endpoints are
  `takeBudget()` (`src/server/request-budget.ts`), never on a page load, the cart, checkout, payment or a webhook.
  The scheduler is watched from outside by `/api/cron/watchdog` (Vercel's one cron, every 15 minutes: it emails the platform's admins when
  the dispatcher's ledger row is over 15 minutes old), and the status page's jobs check fails on a late watcher or a late daily job
  (`jobsCheck()`, `src/lib/cron-health.ts`); pg_cron's SQL jobs are kept as `pgcron.*` (`src/server/pg-cron-jobs.ts`).
  The screen also shows the day's difference of the stored daily reading of production and eight flags (`src/lib/platform-flags.ts`, read
  from the stored rows by `src/server/platform-flags.ts`, never from a statistics view); the two written exception lists live in that
  file with a reason per entry, at most five and three; and a flag is also a line in the platform's morning briefing (`database_flag`).
  The page's *Style text owners add* card is a reading taken on demand (`?reading=styles`, `styleReading()` in `src/server/style-reading.ts`,
  pure parts in `src/lib/style-reading.ts`): one statement, no page document leaves the database; its lines (10 KB median, 20 KB a store,
  half of pages with motion) are in `docs/performance.md`.
  Each server instance stores its cold start once in `commerce.instance_starts` (`src/lib/instance-start.ts`, `src/server/instance-start.ts`,
  step 1.16: kind, times, memory, bytes of translated text; nothing of the request), kept 30 days by the daily job; the screen's *Cold
  starts* card (`#cold-starts`) shows cold starts a day with the median and the 95th percentile by kind.

## The parity tracker (D154, `docs/parity/README.md`, `docs/parity-plan.md`)

- The parity tracker (D154, `docs/parity/README.md`, `docs/parity-plan.md`): the gap to Shopify is `docs/parity/rows/*.json`, and
  `docs/shopify-parity.md`'s tables are generated from it (`pnpm parity:write`; never edit between the `parity:generated`
  markers). A row is Full only with existing evidence files and a test (or `untested: true`, counted as debt), a rating change
  needs a `history` entry, a claim about Shopify is `fetched: true` only when the page was read (with its date), and a new Shopify
  feature is one row, never repeated in two domains. A finished feature updates its rows in the same change and runs
  `pnpm parity:write`; `pnpm parity:check` and `src/lib/parity.test.ts` hold it. Waves start from
  `.claude/workflows/parity-wave.js`.

## Accessibility (D158)

- **Accessibility (D158)**: `pageIssues()` (`src/lib/page-a11y.ts`) is the one checker (it reads the colours the site's and the
  page's CSS give class names, `classColours()`, so a caller passes `siteCss`, D390); text over a solid gradient is held to each
  of its colours under its overlay (`contrast`, blocking) and text over a picture or a video to the darkest and lightest the
  picture could be under its overlay (`text_on_picture`, a warning only, PSI ACC-04: a picture's colours are not known to it);
  `savePage()` re-runs it and publishing with a blocking issue needs `acknowledgedIssues` and writes `page.published_with_issues`.
  The statement (`src/lib/a11y-statement.ts`) never says "conforms" without an audit entry; `ENFORCEMENT_BODIES` entries carry
  `verified`. CI: `e2e/a11y.spec.ts` (axe, tags up to `wcag22aa`, fails on serious and critical; signed-out admin pages only); the
  Stripe form and signed-in admin are checked by hand. An audit is the company's, never counted by code.

## Staff security (D158)

- **Staff security (D158)**: `getAccount()` is the *assured* account (null for an enrolled `aal1` session and for a platform admin
  without `aal2`); `getSessionAccount()` is for the sign-in and two-step pages only. Enrolment is read from the signed `aal` claim
  or a server-side `getUser()` for `aal1`, **never the cookie's `user`**; `accounts.two_step_since` is a display mirror. Recovery
  codes are `account_recovery_codes` (HMAC, single use, ten per set); using one deletes the account's factors with
  `SUPABASE_SECRET_KEY`. A try is reserved under a per-account advisory lock before a code is checked (`reserveAttempt()`).
  `ADMIN_TWO_STEP=off` is the break-glass. Password sign-in has the admin's own limit per email (PSI SEC-02,
  `src/server/sign-in-limit.ts`: `SIGN_IN_TRIES` wrong tries per `SIGN_IN_WINDOW_MINUTES`, `chat_usage` rows with no store keyed
  by a keyed hash of the address, never the address; every address counted alike so the answer never says which have access).
  Two-step pages live under `/admin/sign-in/two-step` and `/admin/account`.

## Permissions (D158)

- **Permissions (D158)**: every store admin page, action, route and helper asks `requirePermission(slug, key)`, `checkPermission`,
  `requireOwnerRole`, `requireAnyPermission`/`checkAnyPermission` or `requirePageTypeAccess`/`checkPageTypeAccess`
  (`src/server/permissions.ts`, names in `src/lib/permission-guards.ts`); Work's screens ask `settings:*`; nothing else compares
  `role` with `"owner"` or calls `requireMember`/`getMembership` (`permissions.scan.test.ts`, against
  `permissions.baseline.json`). A page's key is its navigation section (`sectionOf`), `/staff…` is `staff`, `/billing` is
  `billing`; owner-only pages need `owner`; `staff:write` and `billing:write` are owner-held. Roles are `store_roles` made by
  `ensureStoreRoles()`; a custom-role member has the enum `admin` and a `role_id`. A new page: one nav item, `ADMIN_PAGES`, a
  guard with its area. A new owner tool: a row in `TOOL_PERMISSIONS`. Collaborators are members with `kind = 'collaborator'` and
  `expires_at`: any reader of `commerce.store_members` ignores an expired one (`store-members-expiry.test.ts`), and Home and the
  control center show only the figures a member's role may read (`StoreFigures.hides`).

## The platform's team and its roles (C1, D471, D510, `src/lib/platform-access.ts`, `src/server/platform-team.ts`)

- **The platform's team and its roles (C1, D471, D510, `src/lib/platform-access.ts`, `src/server/platform-team.ts`)**: an owner of the
  platform is `accounts.platform_admin` (everything, as before roles); the other roles (`support`, `content`, `finance`, `read_only`) are
  `accounts.platform_role`, never held with `platform_admin`. Every role reads every platform page (`requirePlatformReader()`); a role
  changes only its own area (`ROLE_WRITES`: support the desk, the chat assistant and store requests; content the website and themes; finance
  the plans, discounts, referrals, reminders and the books). Settings, the team, the AI manager and drastic store actions (suspend, close,
  limits, two-step resets) stay `requirePlatformAdmin()`. A platform action or route asks `requirePlatform(area)`, its area written in code
  for the folder it sits in, never read from the request's address (a server action can be posted to any page's); a server module asks
  `platformCan(account, area, access)`, never `account.platformAdmin` for something a role may do; `platform-access.scan.test.ts` holds the
  areas to their folders and keeps `requirePlatformReader()` out of anything that changes something. Everyone on the team is held at
  two-step sign-in. Only an owner changes the team (`addPlatformAdmin()`, `setPlatformRole()`, `removePlatformAdmin()`), never their own
  place, and the platform keeps an owner; a member is an admin of Kaizena Flow's own store in the store role of their work
  (`HOUSE_ROLE_TEMPLATE`), set in the same transaction, never its owner (`store_members_house()`).

## The platform's figures, targets and morning briefing (C2, D513, `src/lib/platform-briefing.ts`, `src/server/platform-briefing.ts`)

- **The platform's figures, targets and morning briefing (C2, D513, `src/lib/platform-briefing.ts`, `src/server/platform-briefing.ts`)**:
  the platform home's month (recurring revenue and how it moved, paying and trying stores, sales against last month to the same day,
  sign-ups today) is only `platformSnapshot()`, live payments only, in Oslo's day. A target is a month's (`platform_targets`: recurring
  revenue and sales in a currency, paying and new stores as counts), set only by `savePlatformTarget()` (the plans area: an owner or the
  finance role), its progress only `targetProgress()`. What the figures raise is only `platformAlertsFor()`, worked out in code, never a
  model's. The briefing is off until turned on (offered once on the home), daily or weekly at seven in Oslo, and goes only from
  `sendPlatformBriefing()` (the dispatcher's `platformBriefing` job), claimed in `platform_settings.briefing_last_period` first so a period
  goes once, to the owners and the finance role, each in their language.
  It also says when a kind of admin screen with 100 loads or more is not 'good' on largest paint or interaction time (`adminSpeedAlerts()`).
  The home and the briefing (`platformSnapshot(now, { house: true })`, nothing else) carry what Kaizena Flow's own site raises (E5.2,
  D757): its store's `page-frustration`, `page-slow` and `domain-problem` by the store's own rules (`signalAlertsFor()` over
  `signalSnapshotFor()`), with kaizenaflow.com itself among its domains from `platform_settings.domain_watch` (written only by
  `watchDomains()`), as `house_signal` alerts in each admin language (`houseSignalAlerts()`), linked to the store's page that fixes each,
  or for kaizenaflow.com to the status page. The home's attention counts the platform's open questions (`questionsOpen`, in the figures'
  one statement) for those who read support.


## Where Kaizena Flow's owners come from (C2, D522, `src/lib/platform-channels.ts`, `src/server/platform-channels.ts`)

- **Where Kaizena Flow's owners come from (C2, D522, `src/lib/platform-channels.ts`, `src/server/platform-channels.ts`)**: a request for a
  store keeps its first touch only through `signupFirstTouch()` (the house store's first-touch cookie, which exists only with statistics
  consent, classified by the stores' `classifyChannel()`), in `access_requests.first_channel`, `first_source` and `first_campaign`, never a
  visit or a click id. Plans → Analytics reads owners by the month their store was made with what they paid only from `platform_sales`
  (live, plans, net of VAT and of credit notes) through `platformOwnerCohorts()`, and channels against spend through `platformChannels()`;
  `commerce.platform_marketing_spend` is written only by `savePlatformSpend()` and `removePlatformSpend()`, for the plans area (D510). Never a
  demo store, a template, a sandbox or Kaizena Flow's own.

## Kaizena Flow's sign-ups and paid plans as ad conversions (C2, D523, `src/lib/platform-ad-conversions.ts`, `src/server/platform-ad-conversions.ts`)

- **Kaizena Flow's sign-ups and paid plans as ad conversions (C2, D523, `src/lib/platform-ad-conversions.ts`, `src/server/platform-ad-conversions.ts`)**:
  a request keeps `access_requests.ad_consent_at` and `ad_signals` only through `signupAdSignals()` (the house store's consent cookie
  allowing marketing, asked with marketing among its choices; the ad platforms' own cookies, each id by its shape), never otherwise, and the
  database refuses ids without consent. `commerce.platform_ad_conversions` is written only by `src/server/platform-ad-conversions.ts`: a
  sign-up within 7 days, and the first live plan its store paid within 7 days of paying and 90 of the request, once per connection of
  Kaizena Flow's store that is on (its Ads and conversions page, D303, the only place they are connected), sent with the store's
  `adRequest()` builders to the platform's own host only; an email leaves only as a SHA-256 hash at the *Enhanced* level, never raw. The
  consent and the ids leave the request after 90 days (`prunePlatformAdSignals()`, daily) and with the person (erasure, retention). A new
  platform event that becomes a conversion goes through the same consent and table, never around them.

## Timed plan prices (C5, D524, `src/lib/plan-campaigns.ts`, `src/server/platform-discounts.ts`)

- **Timed plan prices (C5, D524, `src/lib/plan-campaigns.ts`, `src/server/platform-discounts.ts`)**: a campaign is a row of
  `commerce.platform_discount_codes` with `campaign_name`, `starts_at`, `expires_at` and `plan_ids` (every plan when empty; the database
  holds a campaign to a start before its end), written only by the discount service, which makes its code (never typed), refuses unknown
  plans rather than widening the campaign, and refuses a second campaign whose time and plans meet an active one's. Its coupon reaches a
  plan only through `waitingDiscount()` in `src/server/billing.ts`, for a new plan chosen while it runs and only when the owner saved no
  code of their own (theirs wins); a typed campaign code works only while it runs. What visitors see comes from `getPublicPlans()`
  (`PublicPlans.campaign`, never the code; read again within the hour a campaign starts or ends) and the owner's Billing page; prices
  under it are worked out only by `campaignPrice()`. A change to a discount refreshes `PLANS_TAG`.

## Audit log (D158)

- **Audit log (D158)**: `audit()` keeps its signature and takes an optional `{ area, target, changes }`; `auditChange()` writes allowlisted diffs (`ALLOWED_FIELDS`), never secrets; a new action needs an area in `AUDIT_AREAS` (a scan test). The log is append-only, deletable only after 24 months by `pruneAuditLog()` (`commerce.guard_audit_log()`); `/admin/{store}/activity` shows an owner everything and others their readable areas; the CSV is owners'.

## Personal data (D162, `docs/wave-1g-gdpr.md`)

- **Personal data (D162, `docs/wave-1g-gdpr.md`)**: every table that can hold a person's data is in `PERSONAL_DATA`
  (`src/lib/personal-data.ts`) with how it links to them, the export section that carries it and what erasure does (`delete`,
  `anonymise`, `restrict`, `keep`), or in `NOT_PERSONAL` with a reason; `src/db/privacy.test.ts` fails for a table with
  `customer_id`, `email`, `phone`, `address`, `*_name` or postal-code columns, a foreign key to a shopper anchor, or a free-text
  or payload column that is in neither, and a new kind of `sendEmail()` must be in `EMAIL_KINDS`. A new table of shopper data
  therefore needs a register entry, an export section in `exportCustomerData()`, an erasure step in `eraseSubject()`, a retention
  rule if it grows, and a `COPY_RULES` decision. The export (`src/server/privacy-export.ts`) is one JSON file by `store_id`, never
  emailed, amounts in the order's own currency; staff need `customers:write` (a POST, same site), the shopper a fresh sign-in
  (`customer_sessions.verified_at`, 10 minutes) and at most `EXPORTS_PER_HOUR`; both are audit-logged with ids and counts and
  never an email or a name. `resolveSubject()` gives a shopper only the account's own proven email: never match emails, forms,
  codes or carts by an address a person typed. Erasure (`src/server/privacy-erasure.ts`) never deletes an order (D141): a sale is
  restricted (`orders.restricted_at`, `customer_id` null) and anonymised by `commerce.anonymise_order()` when the seller's
  country's period ends (`commerce.retention_rules`, read only through `retentionRule()`, written only by `set_retention_rule()`);
  unpaid orders are cancelled through `cancel_unpaid_order()` after `closeSession()` and then anonymised; every query that matches
  orders to a person by email adds `restricted_at is null` (`restricted-orders.scan.test.ts`), and `sendEmail()` refuses an email
  for a restricted or anonymised order; late writers (`saveCustomer()`, `updateOrderContact()`) skip an anonymised order. The
  anonymising SQL functions contain no `DELETE`; deletions are application code (`runRetention()` in the daily cron,
  `src/server/retention.ts`). The one-month request clock is `privacyDeadline()`. Consumer wording is `src/lib/privacy-text.ts`
  (hand-written nb, sv, da, en, needs legal review, never in `i18n.ts`). An audit entry for any of this never holds personal data.

## Closing a store (D171, `docs/store-closure.md`)

- **Closing a store (D171, `docs/store-closure.md`)**: `stores.status` is `active`, `suspended` or `closed`; the steps are the
  database's (`stores_status_rules()`), and a store that is not open takes no order (`orders_store_open()`, even a renewal) and is
  a 404 on the storefront. Nothing is deleted (orders, invoices and the audit log cannot be, almost no foreign key cascades): a
  closed store stays for its members, and `memberCan()` is the one place that limits every role there to `orders`, `customers`,
  `analytics`, `billing:read`, `staff:read` and the owner's key (`allowedWhenNotOpen()`), so a new key a closed store may use is
  added to that list on purpose. The owner closes from `/admin/{store}/settings/close` (`closeStore()`: a sign-in from the last
  ten minutes, `signedInRecently()`; the address typed in; blocked by paid unsent goods, subscriptions and weekly deliveries,
  `closureBlockers()`), reopens for 30 days (`ownerMayReopen()`); the platform suspends, closes (forced) and reopens at
  `/admin/platform/stores/{store}`. Closing ends the plan at period end *first*, cancels orders waiting for payment, releases the
  domains and emails the owners (`store.status`). A new job that emails shoppers, calls a model or syncs something per store skips
  a store that is not open with `commerce.store_is_active()`. Counts of what is open are only `storeObligations()`.

## Store features (D178, `docs/store-features.md`, `src/lib/store-features.ts`, `src/server/store-features.ts`, `/admin/{store}/settings/features`)

- **Store features (D178, `docs/store-features.md`, `src/lib/store-features.ts`, `src/server/store-features.ts`,
  `/admin/{store}/settings/features`)**: a master switch for the online shop (`shop`; off, the store is a website) and a switch
  per feature (the ids are `FEATURE_IDS` in `src/lib/store-features.ts`). `stores.features` holds what the owner keeps on; what is
  *on* is only `featureOn(store, id)` (kept, with everything in its `needs`; SQL `commerce.feature_on()`), so a feature's switch is
  remembered while the shop is off; never test
  `store.features.includes()` for "on". `store.bookingsOn`/`deliveriesOn` are derived from it. Bookings and
  subscription boxes are switched in `stores.features` alone; `stores.modules` holds only `work` (the twin for older code was
  removed in bloat review step 0.37), and `stores_features_sync()` only keeps the features list distinct and sorted. Only owners switch, through
  `setFeature()` (needs enforced, `featureBlockers()` refuse where customers would be hit, `featureWarnings()` need `confirmed`,
  audited `store.feature`); nothing is deleted, history and shoppers' after-sale links stay. Off means hidden in the admin (a
  `feature` on its `STORE_SECTIONS` item and `ADMIN_PAGES` entry, held equal by `store-nav.test.ts`;
  `requireFeature(member, feature)` from `components/admin/feature-off.tsx` after a gated page's permission check; `TOOL_FEATURES`
  for AI manager tools, refused in `runOwnerTool()` and listed per store over MCP), and, from later steps, in the storefront and
  refused by the server. A new feature is an id in `FEATURE_IDS` and an entry in `STORE_FEATURES` (needs transitively complete),
  the `stores_features` check and `commerce.feature_needs()` in a migration, a backfill for stores that use it, its counts in
  `FeatureFacts`/`featureFacts()` with its blockers, warnings and `featureInUse()`, and `feature` tags on its pages and tools. The
  Selling group (step 3, `docs/store-features.md` 4c): a product is offered to shoppers only while its kind's feature is on (an
  appointment Appointments, a stay or rental Stays and rentals, one sold only as a subscription Subscriptions), asked only through
  `OFFERED` (`commerce.kind_offered()`, `kindOffered()`), and a purchase option only through `plansOffered()`
  (`selling-readers.scan.test.ts`); a booking's times only while its feature is on (`loadOffer()`, `loadRange()`), a resource's
  changes and calendars by its kind's feature (`resourceFeatureOn()`); `saveProduct()` refuses making a product of a kind that is
  off and keeps purchase options as stored while Subscriptions is off; a shop component that serves shoppers' links to what they
  already have is `afterSale` (still drawn, left out of the palette). Never read `stores.modules` for bookings or boxes: ask the
  feature. Hiding a feature's parts (step 2, `docs/store-features.md` 4a): admin parts ask `featureOn()` and show
  `FeatureOffNote`, storefront routes resolve with `resolveFeatureShop()` (404 while off), builder parts carry a `feature` tag
  (`STORE_PARTS`/`STORE_PIECES`, `SITE_PART_FEATURES`, `PRODUCT_PART_FEATURES`, read by `partFeatureOn()`: not drawn, not in the
  palette, "Switched off" on the canvas), and a `KNOWN_COOKIES` entry may carry `feature`. The Customers group (4b): who a store
  sells to is only `effectiveAudience()` (`store.audience`; the owner's choice is `chosenAudience`, edited on the Company page)
  and `commerce.store_audience()`/`STORE_AUDIENCE` in SQL (`audience-readers.scan.test.ts`): with `business` off the store sells
  to consumers; a product for one kind of buyer is offered only where the store sells to that kind
  (`OFFERED`/`commerce.product_offered()` on every shopper-facing product read, the cart and `placeOrder()`); switching it off
  clears open carts' company and VAT number. The bonus program works when the feature and `bonus_settings.enabled` are on
  (`commerce.bonus_program_on()`, `BonusProgram.on`); expiry pauses while it is off (`bonus_settings.paused_at`, `bonus_resume()`
  moves the dates that passed). The referral program works when its feature, its switch and the bonus program are on
  (`affiliate_program_on()`); an order attributed while it was on is still rewarded when paid. The Countries and languages group
  (step 4, 4d): the store's own country is `homeMarket(store)` (`store.markets[0]`, SQL `commerce.home_market()`); `store.markets`
  is the countries *offered* (`offeredMarkets()`: its own alone with `countries` off), `keptMarkets` every active one,
  `allMarkets` every one it had; `store.localization` follows `languages` and `currencies` (`languageChoice`/`currencyChoice`,
  `languageChoices()`, `marketChoices()`; `locales` in use, `keptLocales` all kept, `rates` every kept currency's, for history). A
  save writes only what its editor shows and keeps the rest (hidden countries' prices, fees and amounts, hidden languages' texts):
  a new per-country or per-language save does the same. Storefront pages resolve with `resolveShop()` and, finding none, call
  `marketMoved()` (308 to `movedMarketSlug()`; a page that streams calls `pageShopOrMoved()` before its `<Suspense>`); after-sale
  routes use `resolveAfterSaleShop()` (a new after-sale route too), pay and change links stay strict; carts, `placeOrder()` and
  drafts ask `commerce.market_offered()`; WordPress uses `offeredMarketIn()`, page parts `marketIn()`. Website mode (step 5, 4e):
  with `shop` off nothing is offered (`OFFERED` asks `feature_on(store, 'shop')`; the database refuses new orders,
  `orders.shop_off`), the shop's pages call `sellingPageOr404()` (the 404 or a manual redirect) and its actions and routes resolve
  with `resolveSellingShop()`, and the admin's selling pages carry `feature: "shop"`; the pages of what was sold
  (`AFTER_SALE_ADMIN_PATHS`) ask `requireShopOrAfterSale()`, and the withdrawal link and the checkout's legal pages
  (`LEGAL_ROLE_NEEDS`, `legalRoleNeeded()`) stay while `afterSaleOf()` (`src/server/after-sale.ts`, judged by `lineEligibility()`)
  says an order can still be withdrawn from or a return is open; a new selling page, action or route does the same, and a new
  place that draws products, a cart or a price asks the shop. Onboarding (step 6, 4f): the setup wizard asks "What will you sell?"
  first; answers become features only through `featuresForAnswers()` (`src/lib/onboarding.ts`) and `setFeatures()` (a whole set,
  with `setFeature()`'s rules, used by the wizard and store templates' pages), the answer is known from a `store.features_chosen`
  activity entry, and the wizard's steps are `setupStepsFor(features)` (`src/lib/setup-steps.ts`: a new step that needs a feature
  says so in `stepApplies()`); the AI manager's `list_features` and `set_feature` (gated, warnings kept with the approval as
  `approved_warnings`) switch as the page does.

## Live drills (D406, `docs/consolidation.md`, `src/lib/live-drills.ts`, `src/server/live-drills.ts`)

- **Live drills (D406, `docs/consolidation.md`, `src/lib/live-drills.ts`, `src/server/live-drills.ts`)**: the platform runs a
  test-mode store's money paths for real (`commerce.live_drills`, requested by `requestDrills()`, run only by `runLiveDrills()` in
  the five-minute dispatcher) through the screens' own functions, only on orders paid on a test account to `DRILL_EMAIL_DOMAIN`; a
  new drill is a kind in `DRILL_KINDS` with its words and a case in `runOne()`, and never touches a payment `testPayment()` does
  not call a test. Whether a payment was a test is `testPayment()` (`src/server/payment-mode-sql.ts`): a Stripe payment's
  `test_mode` is always false (closing a store and switching off selling abroad still ask the flag, counting test orders as
  obligations on the safe side). Kaizena Flow's Stripe endpoints follow the site's address (`keepStripeWebhooksCurrent()`).

## Self-serve sign-up (wave 9 unit F, D359, `src/server/self-signup.ts`)

- **Self-serve sign-up (wave 9 unit F, D359, `src/server/self-signup.ts`)**: while `platform_settings.self_serve_signup` is on (written only by
  `setSelfServe()`), a sign-up is counted by `takeSignupSlot()` (keyed hashes only), kept by `createAccessRequest()` and marked `self_serve`
  with a link kept as its hash; a store is made only by `confirmSelfSignup()` from the press on `/sign-up/confirm/{token}` (never by opening
  the link), through `approveAccessRequest(null, …)`, and starts `store_billing.trial_ends_at`, which `choosePlan()` passes to Stripe as
  `trial_end` (`trialEndFor()`). A new way to make a store without an admin goes through the same path and audits `store.self_signup`.

## Notices of illegal content (D411, `docs/dsa.md`, `src/lib/content-reports.ts`, `src/server/content-reports.ts`, `src/server/content-moderation.ts`)

- **Notices of illegal content (D411, `docs/dsa.md`, `src/lib/content-reports.ts`, `src/server/content-reports.ts`, `src/server/content-moderation.ts`)**: the DSA's notice
  mechanism for content on stores. The public form is `/report` (`ReportRoute`), linked from every footer by `ReportContentLink`; a new
  footer keeps it. `commerce.content_reports` is written only by `src/server/content-reports.ts`; a platform admin decides each notice at
  `/admin/platform/reports` with a reason, and the sender is told (art. 16(5)); the store's owners get the statement of reasons when content
  was restricted (art. 17), never the sender's name. An AI reads and drafts (part 2, `src/server/content-moderation.ts`, prompts in
  `src/lib/content-moderation.ts`) and checks new and changed listings (source `screening`, switch `platform_settings.content_screening`),
  but never decides, restricts or emails a store or a sender by itself; when it took part `ai_used` is set and the emails say so. Its answer
  is kept only in the checked shape of `AiReading` and drawn as text; a new kind of AI action on content keeps a person deciding.

## The status page (wave 9 unit G, D360, `src/lib/status.ts`, `src/server/status.ts`)

- **The status page (wave 9 unit G, D360, `src/lib/status.ts`, `src/server/status.ts`)**: `/status` and `/no/status` read only
  `statusOverview()` (cached under `STATUS_TAG`); checks are written only by `runStatusChecks()` (the five-minute dispatcher), one row per part
  of `STATUS_COMPONENTS` its probe could measure (a probe with nothing to measure returns null: *Not measured*, never up), incidents and
  updates only by `postIncident()`/`updateIncident()`, subscribers only by that module. A new part is an id in `STATUS_COMPONENTS` (and the
  tables' checks), a probe in `PROBES` and its words in the `status` catalogue of both platform languages; a missing check is never drawn as passed. The `ai` part (PSI AST-10)
  is `testAi()` on the platform's own text model, asked once a day and an hour after a failed check (`aiCheckDue()`), never every five
  minutes: each check is a paid call. A failed one stands for `AI_RETRY_MINUTES` in its objective (95 %).

## The installable admin and push (wave 9 unit H, D361, `src/lib/admin-sw.ts`, `src/lib/push.ts`, `src/server/push.ts`)

- **The installable admin and push (wave 9 unit H, D361, `src/lib/admin-sw.ts`, `src/lib/push.ts`, `src/server/push.ts`)**: the
  service worker is Since D672 `sendPlatformPush()` pages the platform admins: each endpoint any of them turned on once, whichever
  store it was for, urgency high, only for what must reach a person at once (a challenge store's stall, with the day's first email
  in `sendChallengeStallAlerts()`); the outside heartbeat `/api/health/cron` answers 503 when a scheduled route is late
  (`cronHeartbeat()`), counts only.
  only `adminServiceWorker()` at `/admin/sw.js` (scoped to `/admin/`): it caches the offline page and the icon only, never a signed-in page or
  data, and opens only admin addresses on its own site. A device's push subscription is written only by `src/server/push.ts`, for a member with
  `orders:read`, on a push service's host (`isPushEndpoint()`; the server POSTs there); a push carries no customer's data. A new notification
  is a sender there that reads the membership again before each device and removes a device gone (404, 410).

## Sign in with Google (wave 10 unit L, D375, `src/lib/google-sign-in.ts`, `src/server/google-sign-in.ts`)

- **Sign in with Google (wave 10 unit L, D375, `src/lib/google-sign-in.ts`, `src/server/google-sign-in.ts`)**: customers sign in with Google
  only through Kaizena Flow's own client on the platform's host (`/api/auth/google/start`, `/callback`) and a one-time hand-over on the store's
  host (`/api/shop/google/enter`); only an account the store already has, by Google's verified email (`checkIdToken()`), signs in, and nothing
  of the Google account is kept. Google's endpoints are constants, never configuration; a new provider follows the same shape.

## Leaving (wave 10 unit P, D377)

- **Leaving (wave 10 unit P, D377)**: an owner's or staff member's own account is erased only by `eraseOwnAccount()`
  (`src/server/account-erasure.ts`): the row is made anonymous in place (never deleted, many tables name it), what is only theirs is deleted,
  and it is refused for a platform admin, a store's last current owner, a host or a domain's holder; a new table of an account's own data
  (keyed by `account_id`) gets a line there and a register entry. The whole store as one file is only `storeExport()`
  (`src/server/store-export.ts`): a new store-owned table of site or settings goes in `STORE_EXPORT_TABLES`, and a secret column is named so
  `SECRET_COLUMN` leaves it out (a column naming a person, `PERSON_COLUMN`); any other store table is left out with its reason in
  `STORE_EXPORT_LEFT_OUT` (`src/lib/store-export-scope.ts`), and `store-export.scan.test.ts` fails on a table in neither.

## Content packs (D257, `docs/theme-showcase-phase-1.md` step 2)

- **Content packs (D257, `docs/theme-showcase-phase-1.md` step 2)**: demo stores per trade written as data (`CONTENT_PACKS`,
  `src/lib/content-packs.ts`; change one by raising its `version`), each a store template (D175) marked by
  `store_starters.pack_key` at `/s/pack-{key}`, written by `syncContentPacks()` (`src/server/content-packs.ts`) and nothing else:
  English only, the template's products archived, the pack's categories, its products through `saveProduct()` (never SQL: prices
  go through the editor's save with their entry), menus, and its pages (`packHomePage()` as the front page, `packAboutPage()`,
  `packProductsPage()`, in the core section styles) through `savePage()`. Pictures are `makeNextPackPicture()` only, one at a time
  (Kaizena Flow's picture model, feature `content_pack`, `packPicturePrompt()`: no words, logos or faces; a photograph marked
  `people` shows invented models' faces, `PEOPLE_RULES`, D282; every other shows no people, `PICTURE_RULES`, D283), placed before
  `pack_pictures` records them, and made by the job (D271: *Make the pictures* only asks, `askForPackPictures()`;
  `runPackPictures()` from `/api/cron/pack-pictures` every minute and `after()` the press, in the asker's name, one per pack and
  two packs at once, held by `picture_claimed_until`, stopping after `PICTURE_TRIES` failures with `picture_problem`), never by a
  page waiting for each; `publishStarter()` refuses a pack with pictures to make (`picturesMissing()`). A new pack is a key in
  `PACK_KEYS` with its data, free of claims (`content-packs.test.ts`).

## Hosts (D71, `src/server/hosts.ts`)

- Hosts (D71, `src/server/hosts.ts`): a store lists stays and rentals for
  outside hosts (`commerce.hosts`, added by owners at `/admin/{store}/hosts`
  with a commission). Hosts are never store members: store pages keep
  `requireMember()`, and the host area `/admin/hosting/{store}` uses
  `requireHost()` and shows only the host's listings (`products.host_id`),
  rooms and items (`booking_resources.host_id`) and their bookings
  (`listBookings(..., hostId)`). Host actions check the resource is the
  host's (`hostOwnsResource()`). Shared panels such as `ResourceCalendar`
  take their actions as props (`CalendarActions`, and `ConnectActions` for
  `StripeConnect`). A host not VAT registered sells without VAT (trigger
  `products_host_vat`). Paying hosts (`src/server/host-payments.ts`): an
  order is for one seller (`orders.host_id`; `placeOrder` refuses a mix as
  `host_mix`); `startCheckout` charges a host's order on the host's account
  (`hostCheckoutAccount()`) with Kaizen's fee plus `commissionOf()` as the
  application fee; `applySession` records the commission
  (`recordHostCommission()`; a no-show fee's through
  `recordNoShowCommission()` from `markNoShow()`), one per payment, sent by
  `payHostCommissions()` (also from the five-minute cron) and reduced by
  `reverseHostCommission()` after a refund of that payment.
  Queries joining a payment's `provider_account` to its store and mode use
  `commerce.connected_accounts` (stores' and hosts' accounts), never
  `stripe_accounts` alone.
  DAC7 (`src/server/dac7.ts`, `src/lib/dac7.ts`): hosts give their tax
  details (`host_tax_details`) and homes' addresses in their area; the
  store's report (`dac7Report()`, `/admin/{store}/hosts/dac7`, CSV for
  owners only) counts orders by the quarter of their `order.paid` event in
  the store's time zone. Text for spreadsheets goes through `toCsv()`.

## Profile pictures (D97, `src/server/avatars.ts`, `src/lib/avatar.ts`, `src/lib/gravatar.ts`)

- Profile pictures (D97, `src/server/avatars.ts`, `src/lib/avatar.ts`,
  `src/lib/gravatar.ts`): accounts and customers have `avatar_path` in the
  public `avatars` bucket, set with `AvatarPicker`. Draw anyone with
  `<Avatar avatar={avatarFor(person)} />`: their picture, else their
  Gravatar through the signed `/api/gravatar/{hash}` proxy (never link to
  Gravatar from a page), else their initials.

## Secrets in the database (Kaizen's webhook secrets, old per-store keys) are encrypted with `SETTINGS_ENCRYPTION_KEY` (`src/lib/secret-box.ts`) and…

- Secrets in the database (Kaizen's webhook secrets, old per-store keys) are
  encrypted with `SETTINGS_ENCRYPTION_KEY` (`src/lib/secret-box.ts`) and never
  sent to the browser.
