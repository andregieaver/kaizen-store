# Platform architecture

Kaizen is a platform that hosts many merchant stores, in the spirit of Shopify.
This note records how. The older single-store decisions in
[`decisions.md`](decisions.md) still hold per store unless this file says
otherwise.

## Decisions

| # | Decision | Date |
|---|---|---|
| P1 | **One database, every row belongs to a store.** A `stores` table; every commerce table carries `store_id`, and child tables reference their parent by `(store_id, id)`, so the database refuses any row that points into another store. | 2026-09-24 |
| P2 | **Stores live on subdomains** of a platform domain (`{store}.{platform domain}`), with custom domains later. Until the platform domain is set up, stores are reachable at `/s/{store}` on the current URL. | 2026-09-24 |
| P3 | **Invite-only beta.** Anyone can request access; the platform operator approves. | 2026-09-24 |
| P4 | **The original store is the demo template.** Its catalogue is what every new store starts with, copied inside the database in one transaction. | 2026-09-24 |
| P5 | **Accounts are platform-wide; roles are per store.** One sign-in (Supabase Auth: password or magic link) per person; `store_members` gives them `owner` or `admin` in each store. | 2026-09-24 |
| P6 | **Routing by host happens in Vercel's routing layer, and only reads the host name.** Host-based rewrites from `{store}.{domain}` to `/s/{store}` are configuration, not code, so they add no function call to a page view and never touch cookies or personal data. They are added once the platform domain exists; until then `storeBase()` in `src/lib/paths.ts` returns `/s/{store}`. | 2026-09-24 |
| P7 | **Stores live on a domain of their own, separate from Kaizen's.** Stores are at `{store}.{store domain}` (`NEXT_PUBLIC_STORE_DOMAIN`: `kaizenstore.site` in production, with `kaizenstore.site` and `*.kaizenstore.site` on the Vercel project and Vercel's name servers, so Vercel issues the wildcard certificate; Vercel then gives the store domain as the project's production URL, being the shortest, so `siteUrl()` never takes it for Kaizen's), not under `kaizenstore.cloud`, as Shopify's are under myshopify.com: a store's pages, and code its owner adds to them, are then a different site from the admin, so they can neither read nor overwrite its session cookies, nor send requests the browser would sign in. `src/lib/store-hosts.ts` builds the routing from the domain at build time (P6): a store's host serves its pages and nothing else of Kaizen's but Next.js's files, the API and `public`; `/s/{store}/…` elsewhere redirects (308) to the store's host; the bare domain and `www.` go to Kaizen. Inside a store, links stay paths (`storeBase()` is empty there); links from anywhere else use `storeHref()`, and full addresses (emails, Stripe, search engines) `storeSiteUrl()`. Without the domain, everything is as before. "Back to admin" and "Edit page" cannot see the admin's session from there, so the admin hands its page over in every link it opens to the store (`#kaizen-admin=…`, taken out of the address and kept in the store's own storage for 12 hours, `src/lib/admin-return.ts`); they lead only to the store's own admin pages, which still ask for a sign-in. | 2026-09-26 |
| P8 | **Stores can use domains of their own, routed as configuration built into each deployment.** Owners add a domain under Store → Domains (`commerce.store_domains`, `src/server/domains.ts`); Kaizen adds it to the Vercel project (`src/server/vercel.ts`) and shows the DNS records it needs. It becomes the store's once its DNS carries our TXT record `_kaizen.{domain}` with the claim's token (so a domain is only ever the store's that proves it holds it, whoever claims it first) and points at Vercel; the first becomes the store's primary address, where its `{store}.{store domain}` host and other domains lead. `next.config.ts` reads the active domains when building (`store-hosts-build.ts`) and builds them into the routing and into the code as `NEXT_PUBLIC_STORE_HOSTS` together, so links (`storeOrigin()`) and routing always agree and a page view still costs no function call (P6). A change asks Vercel for a new deployment through a deploy hook; the Domains page checks waiting domains as the owner opens it and asks again when the running deployment lags. Needs `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` and `VERCEL_DEPLOY_HOOK_URL`. | 2026-09-26 |

## How it fits together

- `commerce.stores` holds each store; `slug` is its subdomain, checked for
  format and against reserved names (`admin`, `www`, …).
- `commerce.countries` is the platform's list of countries (the EU and
  Norway). A store's `markets` are the countries it sells to.
- Creating a store runs `commerce.initialise_store()`, which adds its invoice
  and credit-note series and Stripe (disabled, test mode).
- `supabase/seed.sql` creates the template store, slug `demo`.
- Storefront: `/s/{store}` (country chooser) and `/s/{store}/{market}/…`,
  served at `{store}.{store domain}/` and `…/{market}/…` once the domain is set (P7).
  `src/server/stores.ts` loads a store and its markets (cached per store);
  `src/server/shop.ts` resolves URL params to a store and market.
- Admin: `/admin` lists the account's stores; `/admin/{store}/…` is one store,
  gated by `requireMember()` in `src/server/auth.ts`.

## From sign-up to an open store

1. **Request.** Anyone can ask for a store at `/sign-up` (name, email, store
   name). It is stored in `commerce.access_requests`; repeat requests from the
   same email are merged, and the page never says which emails have asked.
2. **Approval.** Platform admins see waiting requests at `/admin/platform/requests`,
   adjust the store name and address, and approve or decline.
   `commerce.approve_access_request()` creates the account (or reuses one),
   copies the template with `commerce.clone_store()` and records the decision,
   in one transaction: if anything fails, nothing changes. The requester may
   choose a store template (D175, [`store-templates.md`](store-templates.md))
   at sign-up, which the admin may change; `commerce.starter_source()` decides
   what is copied.
3. **Invitation.** The new owner is emailed a sign-in link. It lands on
   `/auth/confirm` and works in any browser (see README for the email
   template this needs).
4. **Setup wizard.** An owner whose store is not open yet is taken to
   `/admin/{store}/setup`: business details, countries, Stripe test keys,
   demo products, then "Open my store". Every step can be skipped; progress is
   read from the store's data (`getSetupProgress()`), so the overview's
   checklist stays right however a setting was changed.
5. **Preview until open.** Before the owner opens it, the storefront works but
   says it is a preview and asks search engines not to index it.

Store templates (D175) are other sources: real stores marked `starter`, made by
the platform, which owners choose when they create a store; a starter's source
adds its operational set-up (`clone_starter_setup()`, [`store-templates.md`](store-templates.md)).

What `clone_store()` copies: markets, payment-method switches, product-safety
contacts, stock locations and the catalogue (not archived products). Current
prices are copied as new prices, so the new store shows no reductions it
never made. It never copies orders, customers, carts, business details or
producer registrations. Copied rows get ids derived from the new store and
the original id (`commerce.clone_id()`), so references line up without a
lookup table.

## Tenant isolation

- Server code reaches store data only through functions that take a `storeId`.
- Composite foreign keys make cross-store references impossible in the
  database, not just unlikely in the code.
- Planned hardening: run storefront queries as a database role without
  `BYPASSRLS`, with row-level security policies keyed on the store, so a
  missing filter returns nothing instead of another store's rows.

## Performance budget

"Under 500 ms" is measured as follows, and each page type has its own budget:

| Page | Budget | How it is met |
|---|---|---|
| Storefront pages (home, product, category) | Server response under 100 ms from cache; **LCP under 500 ms** on desktop broadband at p75 | Prerendered and cached per store; only stock and cart stream in |
| Storefront dynamic parts (stock, cart) | Under 300 ms server time at p95 | One indexed query each, in Dublin next to the database |
| Admin pages and actions | **Under 500 ms** server time at p95 | Indexed queries, no waterfalls, optimistic UI where it helps |

No website loads in 500 ms on a slow mobile connection; there the target is
Google's "good" LCP (2.5 s), and the store should beat it comfortably.
Vercel Speed Insights measures real visitors; CI fails when a page's server
response in the test run exceeds its budget.

## Usability by design

- Every task has one obvious path; defaults are chosen so most merchants never
  need to change them.
- Forms validate as you go, say what is wrong in plain words, and never lose
  input.
- The admin is keyboard-friendly and meets WCAG 2.2 AA, like the storefront.
- New merchants are guided by a setup wizard and a checklist rather than
  documentation.

## As built: templates (D125), server side

Saved rows, columns and components (`commerce.saved_parts`, D46) can be shared as templates. `saved_parts.sharing` is
`private` (this store only, the default), `stores` (the other stores its owner owns) or `marketplace` (every store
owner); Kaizen's own saved parts (`store_id` null) are always `marketplace`, published by "Kaizen" (a check keeps it
so). `hidden_at`/`hidden_by` are set by a platform admin. `commerce.template_activations (store_id, part_id, active)`
holds a store's choice to have a template in the builder's Templates tab; a row goes with its template. Kaizen's parts
are on until a store switches them off (`coalesce(activation.active, saved_part.store_id is null)`, so stores made later
have them too, and `clone_store()` needs nothing); every other template is off until switched on.

- **Who sees what** is one SQL condition, `visibleTo()` in `src/server/templates.ts`, used by list, activate and use:
  never the viewing store's own parts, never a hidden one, the viewing account must work in the viewing store, the
  marketplace's are for every member, and a `stores` template is for an account that is an **owner of both** stores
  (`store_members.role = 'owner'`, not disabled), read on every request so a lost ownership takes it away at once. A
  `stores` template is not in the marketplace list and the other way round; hiding applies to every list and survives
  the publisher changing the sharing.
- **Sharing** is set by owners only: `createSavedPart`/`updateSavedPart` take `sharing` (an update that does not say
  keeps it; an unchanged value from staff is fine, a change is refused) and `setPartSharing()` changes it alone. Both
  write `commerce.audit_log` (`store.part_saved`, `store.part_updated`, `store.part_sharing`).
- **Using is a copy** (`applyTemplate()`, not saved; the builder places it with its own copy functions). Pure rules in
  `src/lib/template-content.ts` (`sanitizeTemplate()`, `mapTemplateMedia()`): global marks and `local` marks, form
  recipients, field bindings and field ids, menu, category, tag and grid store references, links into the source store
  (its `/s/{slug}` paths, its hosts, anything carrying an id, files in Storage), `mailto:`/`tel:` links, social profile
  addresses, and another owner's HTML component (Kaizen's stays) are taken out. Pictures, videos, stills and backgrounds
  the source store's media library holds are copied in Storage into the using store's folder and registered in its
  library (`copyToLibrary()`, `copyStoredFile()`); one that is not in the source's library, or cannot be copied, is left
  out, never left pointing at the source. One use copies at most `TEMPLATE_MEDIA_MAX` (30) files and
  `TEMPLATE_MEDIA_BYTES_MAX` (80 MB). A last check refuses a result that still holds an address in Storage that is not
  one of the new copies, and the result must pass `savedPartInput`. Texts in other languages are not carried.
- **Moderation**: `/admin/platform/templates` lists marketplace templates and any hidden one with Hide / Show again
  (`setTemplateHidden()`, platform admins only, audited as `platform.template_hidden` / `_unhidden`). Copies already made
  stay.
- Nothing here is cached, so there are no tags to update; the media library and saved parts are read fresh.

## As built: page layouts and preview (D127), server side

A whole page's layout is a template too: a saved part (`commerce.saved_parts`) of kind `page` whose content is a
`PageLayout` (`src/lib/page-layout.ts`: `pageType`, the page's `rows` and its own `css`; nothing else of the page comes
with it). It is saved, shared (`sharing`), switched on, hidden and used exactly as rows, columns and components are
(D125), and only ever for pages of its own kind (`layoutFits()`): a header's rows are made of components no article has.
Migration `template_page_layouts` widens `saved_parts_kind` and adds `saved_parts_page_not_global`: a page layout is
never global, so it is left out of the globals machinery (`lockSavedParts()` skips it), counts toward the 200 saved
parts, and has its uses of globals taken out when saved (`plainLayout()`); no texts in other languages.

- **Using** (`applyTemplate()`): `sanitizeTemplate('page', …)` cleans every row as a row is cleaned (site parts and
  product parts stay, since the layout only goes to the same kind of page); the layout's CSS stays only when it passes
  `cssProblem()` and holds no address in Storage, else it is emptied. Pictures of all rows are copied under the same
  caps (30 files, 80 MB), then the same last check and `savedPartInput`.
- **Preview** (`previewTemplate(storeId, account, id)`): the same visibility rule (`visibleTo`) and the same cleaning as
  a use, but nothing is copied, written or audited, so its pictures still point at the publisher's public files. It
  returns a `TemplatePreview` (`src/lib/templates.ts`) whose `rows` are always what is drawn: a page layout's rows, a
  row itself, a column as a row of one column, a block as a single-column row (`preview-row`, `preview-column`).
- **Preview page**: `/admin/account/templates/s/{store}/{templateId}/preview` (`templatePreviewPath()`,
  `src/lib/template-paths.ts`), in the chrome-free `(print)` route group and so not in `ADMIN_PAGES`; `noindex`,
  `requireMember()`, 404 when the template is unavailable. It draws the template with the store's own theme (`[data-theme-canvas]`),
  fonts and CSS through `PageDrawing` (`[store]/pages/drawing.tsx`, also what the draft preview uses) as its kind of
  page: a header or footer in the store's first country, a product layout with one of its products, an article under
  its heading, anything else as rows. A slim bar says "Preview — nothing is saved or copied" with the name, kind and
  publisher; the content is `inert` with `pointer-events: none`, so no link, form or focus does anything. It follows
  the width of its frame, so a 390 px frame shows the phone layout.
- **Lists**: `TemplateItem.pageType` and the moderation list's `pageType` say which kind of page a layout is for (null
  for the rest); the moderation page names it ("Page layout for headers").
