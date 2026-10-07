# Design profiles (D176, D177)

Store templates (D175, `docs/store-templates.md`) are the grunt work of a new store: modules, settings, products, pages. **Design profiles**
are the look only, and any store can apply one: an owner from the store's Design settings, a platform admin from the store's page in the
platform (a store template's included), and people creating a store at `/admin/stores` or asking for one at `/sign-up`, after choosing the
store template. Applying one never touches the store's content, products, menus' links, logo or brand words, and keeps the look from before
so it can be put back.

In code they are **design presets** (`commerce.design_presets`, `src/lib/design-presets.ts`, `src/server/design-presets.ts`), never
"template", "starter" or "theme" alone: those are the page builder's templates (D125) and page layouts (D127), store templates (D175) and a
store's themes (D60). The interface calls them **Design profiles**.

*Deviation from the brief:* the brief named them "design templates" at `/admin/platform/design-templates` with this contract at
`docs/design-templates.md`. The platform owner then asked for **Design profiles**, applicable to any store, not only to store templates; the
route is `/admin/platform/design-profiles` and this file is `docs/design-profiles.md`. The code name `design_presets` stays.

## 1. What a design profile holds

A frozen **snapshot** of a store's look, never its content (`design_presets.snapshot`, `DesignSnapshot`, validated by
`designSnapshotSchema`, version `v: 1`):

| Part | From the store | What is kept |
|---|---|---|
| `theme` | `stores.theme`, as `parseStoreTheme()` reads it | `base` (the D60 template it started from) and every setting: both colour sets, heading and body fonts, headings, buttons, corners, content width, header alignment and background, product cards, the store's light/dark **mode** and the visitor's **switch** (D99). `savedId` is not kept. |
| `header`, `footer` | the chosen `header_id` / `footer_id` page (D80), as last published | its rows, its CSS, a header's place over the page (`everywhere` or `front` only), and each menu component's **role** (`menus`: block id to `header` or `footer`). Null: the standard one. |
| `productLayout` | the store's standard `product_layout_id` page (D79), as last published | its rows and CSS. Null: Kaizen's built-in layout. Layouts chosen for categories, tags or single products are the store's content and are not kept. |
| `css` | `stores.custom_css` (D100) | kept when `cssProblem()` passes and it reaches into no file in Storage; else none. |

**Look and brand** (`LOOK_FIELDS`, `BRAND_FIELDS` in `src/lib/design-presets.ts`). A theme (`ThemeSettings`) holds no brand field at all: a
store's logos and icon live in `stores.navigation` (`StoreNavigation`: `logo`, `logoDark`, `favicon`), outside the theme. So:

* **Look** (read by a snapshot, written by applying): `theme`, `custom_css`, `header_id`, `footer_id`, `product_layout_id` (the last three as
  new pages made in the store).
* **Brand and content** (never read, never written): `name`, `navigation` (logos, icon), `seo`, the business details (`legal_name`,
  `organisation_number`, `contact_email`, `postal_address`, `country`), `header_menu_id`, `footer_menu_id` and every menu's links, the front
  and All products pages, `tracking`, `custom_code`, the languages, and every page, product, category and setting.

A header's or footer's own site components (logo, business details, cookies and withdrawal links, cart …) draw the **applying** store's own
logo and details: they are components, not data.

**Cleaning a layout** (`snapshotLayout()`, when the snapshot is taken), so the snapshot never holds the store's ids, links or private things:

1. custom field and field loop components (D118, D120) are left out: they show the store's own fields by id;
2. each menu component's menu is named by its role: the store's header menu or footer menu; a component showing another menu is kept
   without one (it shows nothing until the store applying it chooses one);
3. then the same cleaning as a template used in another store, `sanitizeTemplate()` (D125/D127): no global marks, no menu, field, group,
   category, tag or plan ids, no link into the store (its `/s/{slug}` addresses and its hosts) or carrying an id, no `mailto:`/`tel:`, no
   social profiles, no form recipients, no other owner's HTML component (emptied), grids of the applying store's own products; CSS kept only
   when clean and free of Storage addresses;
4. a header lying over the pages of some categories or tags is kept above the page (those terms are the store's own); words in other
   languages (`translations`) are not kept (they may hold links the cleaning does not see, and the store applying it has its own languages).

Pictures and videos keep their addresses in the snapshot and are copied when the profile is applied (section 3). The platform admin is told
what a snapshot left out.

**Table `commerce.design_presets`**: `title` (1 to 80), `summary` (to 200), `description` (to 2,000, plain text), `picture_url` (optional;
`https://…` or a path on the site, Kaizen's media library), `snapshot` (an object with `v = 1`, at most 2 MB: **the published look**, what
applying and the public preview use), `source_store_id` (the store whose media library the snapshot's pictures are copied from when applied:
since D177 the profile's workspace), `snapshot_at`, `position`, `published`, `created_by`/`updated_by`/`created_at`/`updated_at`; since D177
`draft` (details saved but not published), `workspace_store_id` (unique, section 2a), `workspace_key` (a SHA-256 of the workspace's look when
it was last published or made, `snapshotKey()`), `published_at`, `archived_at`/`archived_by` (`not (published and archived_at is not null)`).
**Deleted only while unused** (D177, `design_presets_rules()`): refused when a store applied it (`design_presets.used`) or an access request
chose it (`design_presets.requested`); a delete clears it as any store template's recommended profile, published and drafted, so nothing
points at it. Otherwise archived. It has no `store_id` (it is the platform's, not a store's), so it is outside `COPY_RULES` by construction;
see section 6.

**`commerce.store_starters.recommended_design`** (nullable, a profile): a store template's recommended design, offered first when a store is
made from it. **`commerce.access_requests.design_preset_id`** (nullable): a sign-up's choice.

**`commerce.design_preset_uses`** (each time a profile was applied): `store_id`, `preset_id`, `previous` (the look it replaced: the theme as
stored, the chosen header, footer and product layout ids, the CSS), `saved_theme_id` (the saved theme made of the old theme; set null when
the owner deletes it), `applied_by`, `applied_at`, `restored_at`/`restored_by`. History: never deleted, and only the restore fields change,
once (`design_preset_uses_rules()`). It counts *applied to N stores* on the platform's list and makes *Put back the look from before*
possible. `COPY_RULES`: `never`.

## 2. Making one (platform admins)

*D177 replaced "a snapshot of a store, updated from its store" with a profile edited on its own pages; section 2a is the current contract,
and what follows in this section holds where it does not contradict it.*

`/admin/platform/design-profiles` (the Stores section's sidebar, after Store templates: `STORE_ITEMS` in `src/lib/platform-nav.ts`, and
`ADMIN_PAGES`). Platform admins only (`requirePlatformAdmin()` on every page and action, and `admin.platformAdmin` in every server function).

* **List**: picture, title, published or not, position, the store it came from, when the snapshot was taken, *applied to N stores*, which
  store templates recommend it; *Edit details*, *Preview* (on the Standard store, a new window), *Update from its store*, *Publish* /
  *Unpublish*, *Move up* / *Move down*.
* **New design profile from a store**: a title, summary, description and one of the stores the admin **works in** (the default template and
  store templates, which they reach as members through *Open the store's admin*, and any other): `createDesign()` takes the snapshot now and
  adds the profile unpublished, last.
* **Update from its store** (`retakeDesign()`): the snapshot again, as the store looks now. Stores that applied it keep what they got.
* **Edit details** at `/admin/platform/design-profiles/{id}`: title, summary, description, picture (uploaded to Kaizen's media library or
  typed), and a preview link on the Standard store and on every store template (published or not).
* **Recommended design**: on a store template's edit page (`/admin/platform/store-templates/{id}`), `setRecommendedDesign()`. Only the
  default choice at creation, never a restriction.
* Publishing refuses a profile whose snapshot cannot be read.
* Audited: `platform.design_preset_created`, `_retaken`, `_updated`, `_published`, `_unpublished`, `_moved`, `_recommended` (area
  `platform`), with the source store's id where there is one.

## 2a. The profile's own pages, its workspace and its life (D177)

**Making one** (`createDesign(admin, { origin, details })`, `/admin/platform/design-profiles`, *New design profile*): **from scratch**
(Kaizen's standard look: the standard theme `minimal`, no header, footer or product layout chosen, so the standard ones, no CSS) or **from a
store** the admin works in (its look as it is now, as `takeSnapshot()` cleans it). Either way the profile gets a **workspace**: a hidden store
copied by `clone_store(starter_source(null), …)` from the default template (its demo products, pages and menus are what the builders and
previews draw on), marked `starter`, described by no store template (`design_presets_rules()` holds that a workspace is such a store, one per
profile, fixed once set), named like the template, at `design-{8 hex}`. "From a store" writes the store's look into the workspace through
`writeWorkspaceLook()`, which places it exactly as applying does (`placeSnapshot()`: fonts, the store's pictures copied into the workspace's
library, each layout with the workspace's menus by role and checked by `pageInput`/`pageRulesProblem()`), but keeps no saved theme and no use
(a workspace is no store's look to put back, and writing it never makes the profile "used"). The profile's `snapshot` is then the workspace's
look (`takeSnapshot(workspace, { drafts: true })`), unpublished, last in the order. A failure closes the workspace (kept, D171).

**Editing** happens on the profile's pages, never by going to a store: `/admin/platform/design-profiles/{id}` (*Details*, with previews and
*Start again from a store*), `/theme` (the store `ThemeEditor`), `/header`, `/footer`, `/product-layout` (the standard one, or *Build the
profile's own …*: a page in the workspace starting as the standard one, `header-profile` and so on, chosen; edited in `PageEditor` and
`PageBuilder`) and `/css` (a checked textarea; the builder's Custom CSS panel saves the same, *Global*). Each page checks
`requirePlatformAdmin()` itself (`designPage()`/`designWorkspacePage()`); a profile from before D177 gets its workspace the first time a look
tab opens (`ensureWorkspace()`: the published snapshot written into a fresh workspace, its key stored so it does not count as changed; two
admins at once get one, the other is closed). The builder's context (`workspacePageContext()`) binds **the profile's own actions**
(`workspace-actions.ts`): each calls `requirePlatformAdmin()` and `workspaceOf()` (the profile's workspace or nothing) and saves only the
workspace's chosen header, footer or product layout of that kind; never a store's actions (`design-presets.scan.test.ts`). The builder is in
`draftOnly` mode (`PageOwnerContext.draftOnly`): one *Save* (a page draft; `takeSnapshot(…, { drafts: true })` reads drafts), no Publish,
Unpublish, Duplicate, Delete or Save as template, and *Preview the draft*. No custom fields, templates or translations (a profile carries none).
Uploads go to the workspace's library, from where applying copies them. Nobody works in a workspace through the store admin, and it is listed
nowhere (`docs/store-templates.md` section 2, *Starters the platform keeps for itself*).

**Draft until published.** Everything changed on those pages is the profile's draft; stores see and apply the published `snapshot` and
details until **Publish** (`publishDesign()`): the draft details become the columns, and the workspace's look, through the same cleaning as
ever (`takeSnapshot()` → `snapshotLayout()` → `sanitizeTemplate()`), becomes `snapshot` (`source_store_id` = the workspace, `workspace_key`
its key). *Unpublished changes* shows while there is a draft of the details or the workspace's key differs from `workspace_key`
(`designChanged()`). **Unpublish** takes it out of the choices at once and says how many pending access requests chose it; approved, such a
request keeps the store template's own look and the admin's message says which profile gave way (`ApproveResult.fellBack`; the request page
leaves the choice empty with a sentence). **Archive** (`archiveDesign()`): unpublished, hidden from every list and chooser but *Archived*
(`?show=archived`), never applied, and cleared as every store template's recommended profile (published and drafted), whose names the admin is
told. **Restore**: back, unpublished. **Delete** (`deleteDesign()`, only while unused, behind a confirmation): the row goes, its workspace is
closed and kept, and recommendations are cleared (the trigger). *Start again from a store* (`copyStoreLookToDraft()`) replaces the draft look
with a store's. *Update from its store* (`retakeDesign()`) is gone. Audited: `platform.design_preset_created` (with `origin`),
`_workspace`, `_copied`, `_updated`, `_published`, `_unpublished`, `_archived`, `_restored`, `_deleted`, `_moved` (area `platform`). Stores keep
their copy: applying stays a one-time copy, and nothing done to a profile changes a store that applied it.

## 3. Applying one

**`applyDesignPreset(storeId, presetId, accountId, deps?)`** in `src/server/design-presets.ts` is the one writer of a profile's look into a
store (`design-presets.scan.test.ts` holds that only this module writes profiles and uses). Its callers check the person's permission; the
function checks again that the account **works in the store** (an active, unexpired membership) or **runs the platform**, and refuses:

* a store that is not open (suspended or closed, D171): "The store is not open, so its look cannot be changed.";
* a store the platform keeps for itself (a store template's frozen copy or a profile's workspace, D177);
* an archived profile, for everyone;
* an account that neither works in the store nor runs the platform: "You do not work in this store.";
* a profile that is not published, except a platform admin applying it to a **store template** (to try it out before publishing);
* a snapshot that cannot be read, a font not in Google Fonts, a layout that does not fit the store (checked as below).

Then, in this order:

1. **Fonts** (D59): the theme's heading and body fonts and the layouts' blocks' own (`snapshotFonts()`) are installed with
   `installFonts()`; a failure changes nothing.
2. **Pictures and videos**: every Storage address in the layouts (`snapshotStorageUrls()`) that is a file of the source store's media library
   is copied into the applying store's library with `copyToLibrary()`, as D125's `applyTemplate()` copies a template's (at most
   `TEMPLATE_MEDIA_MAX` files and `TEMPLATE_MEDIA_BYTES_MAX` bytes); any other upload, or one that cannot be copied, is left out (a picture
   becomes none, a background goes) and the person is told how many. `mapSnapshotMedia()` puts the copies' addresses in;
   `leftoverStorageUrls()` then refuses any page still pointing at another store's file.
3. **Pages**: each layout becomes a page of the applying store with `layoutForStore()`: each menu component shows the store's **own** header
   or footer menu by its role (`stores.header_menu_id` / `footer_menu_id`; none when the store has none), titled "{profile} header" and so on.
   Each is checked by `pageInput` and `pageRulesProblem()`, the validation the builder's `savePage()` uses. (Not `savePage()` itself: it
   runs its own transaction and global-part spreading; a profile's pages hold no global parts.)
4. **One transaction**, under a lock of the store's row:
   * the look now is kept: its theme as a **saved theme** (D60, `commerce.store_themes`) named "Before {profile} ({date})" (within 60
     characters, a number added when the name is taken: `beforeThemeName()`), and the whole look (theme as stored, chosen layouts, CSS) in
     the use's `previous`;
   * the new pages are inserted, **published**, at free addresses (`header-{profile}`, `footer-{profile}`, `product-layout-{profile}`,
     `designPageSlug()`); the store's own pages are never overwritten and stay, unchosen;
   * `stores.theme` becomes `{ base, savedId: null, settings }` from the snapshot (the store's `navigation` with its logos is not touched),
     `custom_css` the snapshot's CSS after `cssProblem()`, and `header_id`, `footer_id`, `product_layout_id` the new pages; a part the
     snapshot has as null (the standard header, footer or layout) is chosen as null too, so the look is the profile's;
   * the use is recorded.
5. **Audit** `store.design_preset_applied` (area `website`), with the profile, the saved theme's name, the new pages' ids, pictures copied
   and left out, and `byPlatform` when a platform admin who is not a member did it.

The callers refresh `designTags(store)`: `storeTag(slug)` (theme and CSS, read by `getStore()`), `pagesTag(store)` (header and footer,
`siteLayoutFor()`) and `catalogTag(store)` (product layouts, `productLayoutFor()`).

**Putting the look back** (`restoreDesignLook(storeId, accountId)`, *Put back the look from before {profile}*): the newest use not yet
restored is undone in one transaction: `stores.theme` as it was stored, the header, footer and product layout it had chosen (each only while
it still exists in the store and is published, else the standard one), and its CSS; the use is marked restored. Doing it again goes one
profile further back. The pages the profile made and the saved theme stay. Audited `store.design_preset_restored` (area `website`).

## 4. Where a profile is chosen

* **Store owners**: `/admin/{store}/settings/design`, above the theme editor, a *Design profiles* section (`DesignProfilePanel`): a card per
  published profile (picture, title, summary, *Preview* in a new window, `target="_blank" rel="noopener"`) and *Apply…*, a disclosure that
  says exactly what changes (the theme replaced; header, footer and product layout added as new pages and used; the CSS replaced; products,
  pages, menus, logo, name and business details kept) and that the look now is kept as a saved theme "Before {profile}", then *Apply
  {profile}*. After a profile, *Put back the look from before {profile}*. The page needs `website:read` (its place is the Website section, as
  the theme editor's); applying and putting back need **`website:write`** (`checkPermission()` in the page's actions, as the theme's save).
  *Deviation:* the coordinator wrote "owner or `settings:write`"; the permission rules (D158) give a page the key of its navigation section,
  and Design is in Website, as everything a profile changes (theme, headers, footers, product layouts, CSS) is, so it is `website:write`
  (owners hold it). The theme editor remounts on a changed theme.
* **Platform admins**: on any store's page, `/admin/platform/stores/{store}`, the same panel; a store template's page also lists unpublished
  profiles (to try them before publishing). Store templates are reached from All stores like any store.
* **Creating a store** (`/admin/stores`) and **sign-up** (`/sign-up`): after the store-template cards, the design cards (`DesignCards`): "Keep
  the template's own design" first and chosen, then each published profile with its Preview. When the chosen store template recommends a
  published profile, choosing that template chooses the profile (`DesignChoiceSync`, a small client component; it also points each Preview at
  the chosen template); the person may choose another. Without JavaScript the cards still work and nothing is pre-chosen. The cards and the
  recommendations are cached under `DESIGNS_TAG` and `STARTERS_TAG` (`designChoices()`; the sign-up page is prerendered).
* **The server decides**: `createStoreForOwner(..., designPresetId)` refuses, before making anything, a profile that is not published and
  readable (`isOfferedDesign()`); a sign-up keeps it on the request only when it is published (`createAccessRequest()`, dropped without a word
  otherwise, like a referral code or a store template). The platform admin sees the choice on the request and may change it (a select of the
  published profiles, "Keep the template's own design" first) before approving; `approveAccessRequest(..., designPresetId)` checks it the same
  way.
* **When it is applied**: right after the store is made, in application code: `createStoreForOwner()` after `clone_store()`,
  `approveAccessRequest()` after `commerce.approve_access_request()` (its transaction has committed), both through `applyDesignPreset()`
  (fonts and pictures need application code, so it is not in SQL; no SQL function is patched). The owner of a created store is a member, so
  it applies as them; an approval applies as the platform admin. **A failure never loses the store**: it keeps its template's look, and
  * the owner creating a store lands on the new store's Design settings with a notice (`?design=failed`) instead of the setup wizard;
  * the platform admin's approval message says the profile could not be applied and why, and that it can be applied from the store's page.

## 5. Preview

`/admin/account/design-profiles/{profile}/preview?starter={store template}` (`designPreviewPath()`), opened in a new window. It is under the
admin's root layout (chrome-free, `noindex`, as the replica frame of D150) but **outside the gated layout**, because people at sign-up are not
signed in:

* it shows only a **published** profile on a **published** store template, or on the Standard store (the default template) when no template
  is named; anything else is not found (`publicDesignPreview()`, cached per profile and template under `DESIGNS_TAG` and `STARTERS_TAG`).
  The page reads the address, so it streams: a refusal is the not-found page with `noindex` and status 200, as a dynamic miss of the
  storefront's is (D168), never the preview;
* with `as=admin` a signed-in platform admin also sees unpublished and archived profiles and templates (`adminDesignPreview()`, never cached;
  only this branch reads the session), a store template's working store rather than its frozen copy, and with `draft=1` the look in the
  profile's workspace as last saved, with its draft title (D177);
* owners and the sign-up page see a store template as published: its frozen copy (D177);
* `noindex, nofollow`; it sets no cookie and stores nothing; its content is `inert` (nothing can be clicked, focused or submitted);
* it draws the store template's **front page** (its chosen page, else the product grid as the storefront draws it) and **one product** (its
  first) with the profile's look: the store's own `Store` with the profile's theme, fonts and CSS, the header and footer through
  `StoreSiteHeader`/`StoreSiteFooter` (or the standard ones when the profile has none), the product through `ProductLayoutView` with the
  profile's product layout (or Kaizen's built-in one), each layout placed by `layoutForStore()` exactly as applying places it, the theme by
  `themeCss()`/`themeAttributes()` on a `data-theme-canvas` box (which the admin's styles leave alone), the CSS by `ScopedCss` kept inside the
  preview. It never applies the profile to preview it; its pictures are still the source store's public files.

## 6. Rules

* `design_presets` has no `store_id` and is not store-owned, so it is not in `COPY_RULES` (the test requires exactly the tables with a
  `store_id` there); nothing copies it with a store. `design_preset_uses` is `never` in `COPY_RULES`. `duplicate_store()` and `clone_store()`
  are unchanged: a store's look is copied from its source as before, and a design choice is applied afterwards.
* The snapshot never holds personal data, secrets, or another store's ids (only its picture addresses, replaced by copies on apply);
  `NOT_PERSONAL` lists both tables.
* Anything that copies a header, footer or product layout into another store goes through the same cleaning as D125/D127
  (`sanitizeTemplate()`); `design-presets.scan.test.ts` holds that `snapshotLayout()` calls it, that `takeSnapshot()` uses `snapshotLayout()`,
  that `applyDesignPreset()` checks with `pageInput`, `pageRulesProblem()`, `cssProblem()`, `mapSnapshotMedia()` and
  `leftoverStorageUrls()` and copies with `copyToLibrary()`, and that the preview places layouts with `layoutForStore()` and never applies.
* Interface words: the admin and the sign-up page are English (Kaizen's own pages); there are no new shopper-facing words, so nothing in
  `src/lib/i18n.ts`.

## 7. Tests

* `src/lib/design-presets.test.ts`: the snapshot schema (version, unknown keys dropped, bad CSS refused), the look/brand split, cleaning a
  layout (menus by role, no ids, no links into the store or contact details, field components out, CSS and terms overlay dropped), placing
  it in another store (its own menus, a page `pageInput` accepts), pictures listed and swapped, the saved theme's name, page addresses,
  details and choices.
* `src/db/design-presets.test.ts` (PGlite): never deleted, snapshot version and size, limits, recommended design and request choice, a use
  never deleted or changed but marked restored once, its saved theme going empty when the owner deletes it.
* `src/server/design-presets.int.test.ts`: a snapshot of a store with a custom theme, header, footer, product layout and CSS holds no source
  id, menu, page or link; applying it to another store changes the theme, keeps the name and logo, makes and chooses new published pages,
  keeps the store's own header, shows the store's own menus, copies the picture into its library, installs the fonts, saves the old theme and
  the use; putting it back; refusals (unpublished for an owner, a store the account does not work in, a closed store); a platform admin's
  unpublished profile on a store template only; creating a store with a profile; a refused profile before anything is made; a profile that
  cannot be applied keeps the store; sign-up keeps and approval applies the choice (an unpublished one dropped); the admin changing it; the
  recommended default; the public and admin preview reads.
* `src/server/design-presets.scan.test.ts` (section 6), `src/components/admin/design-cards.test.ts` (cards and panel render, Preview
  `target="_blank" rel="noopener"`, the confirmation's words).
* D177: `src/lib/lifecycle.test.ts` (states, buttons, delete blockers); `src/db/design-presets.test.ts` (deleted only while unused, the
  recommendation cleared, archived never published, the workspace's rules); `src/server/design-presets.int.test.ts` (from scratch and from a
  store into a workspace, the workspace listed nowhere and never applied to, draft versus published in the previews and `designChanged()`,
  the lazy workspace of an old profile, *Start again*, unpublish with a pending request falling back at approval, archive clearing
  recommendations, delete refused when used and closing the workspace when not); `src/server/design-workspace.int.test.ts` (the editor's
  actions refuse a non-admin, another store's page, another kind, and save drafts only); the scan test holds that every editor action checks
  the admin and the workspace and imports no store action.
* `e2e/design-profiles.spec.ts`: the public preview of a published profile on a store template is `noindex`, shows the profile's colours and
  fonts on the template's front page, inert, and an unpublished profile (also asked as `as=admin` while signed out) is not shown.

## 8. Not built

* An AI manager tool for design profiles (owners apply them on the Design page).
* Picking which parts of a profile to apply (all or nothing; the look before can be put back).
* A profile's own copy of its pictures: they are copied from its workspace's library when applied (D177), so a picture deleted there is left
  out of later applies. Nobody reaches a workspace's media library page (its store admin is closed to everyone); the builder's upload adds to
  it. Noted for the lead.
* Editing a profile's menus' links or demo content: a workspace's menus and products are the default template's, only to draw on.
* Layouts for categories, tags or single products, menus' links, and words in other languages are never part of a profile.
