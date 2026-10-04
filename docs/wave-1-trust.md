# Wave 1, trust lane: legal starters, accessibility, PCI and staff security (units 1e and 1f)

This is the contract for units **1e** (legal starters, terms at checkout, accessibility, PCI hardening) and **1f** (staff security: two-step
sign-in, roles, activity log) of `docs/wave-1.md`. Those two sections, the *Standing rules*, the *Decisions taken with defaults* and the
*Risks* there are the agreed frame; this file elaborates them and does not contradict them. Where reading the code or the law showed
something the frame did not know, it is said under *Findings that change the picture* and, where it needs a decision, in section 9.
Code, tests and texts follow this file; a disagreement is settled here first.

**Nothing here is legal advice.** Every consumer-facing text this wave adds is hand-written in Norwegian (nb), Swedish (sv), Danish (da)
and English (en), is never machine-translated, carries a visible *draft: needs legal review* notice until the owner removes it, and is
listed in section 8. Every rule that comes from a law is written with its source and the date it was read (section 4); a source that
was **not** read in this run says so.

Date of this spec and of every "read" below: **2026-10-03**.

## Findings that change the picture

Read in the code and the sources while writing this spec. Each is handled in the section named.

1. **A page with a page role and no address is a 404 today** (`StorePageView`: `roleAddress()` is null, so `notFound()`). The legal roles
   must keep their page at its own address, in the sitemap once published. So the legal roles are a second kind of role, *linked* roles
   (section 3.1), not more entries in `PAGE_ROLES`.
2. **The audit log already refuses DELETE** (`audit_log_append_only`, `commerce.forbid_change()`, migration `20260923235847`). The frame
   says pruning lives in application code; that cannot work until the trigger lets an *old enough* row go. Section 3.3.
3. **`audit()` has no coverage of products, prices or pages beyond publish**: `saveProduct()` writes no audit entry at all, and
   `commerce.set_price` is called without one. The criterion "product, price, page, discount, shipping, staff and payment-setting changes
   each write an entry" needs new writes, not only a screen.
4. **Enrolment state must not be read from the session cookie.** `auth.mfa.getAuthenticatorAssuranceLevel()` takes `nextLevel` from the
   user object stored in the browser's cookie, which the person controls: someone with only the first factor could edit `factors` out of
   it and look "not enrolled" at `aal1`. The trusted sources are the signed `aal` claim (already read by `getClaims()`) and, for an `aal1`
   session only, a server-side `getUser()` call (section 2.8).
5. **Supabase now has experimental native MFA recovery codes and WebAuthn as a second factor** (client `@supabase/supabase-js` 2.117.1:
   `auth.mfa.recoveryCodes.*` behind `experimental.recoveryCodes`, factor type `webauthn`; the public docs pages read today still say
   "TOTP only" and "Supabase does not return recovery codes"). The frame decides *own recovery codes* and *no passkeys in wave 1*; this
   spec keeps both (the native features are flagged experimental and the docs disagree with the client), and lists the question in
   section 9 so the decision can be revisited with the facts.
6. **The card form is only on `/checkout`.** The Stripe Payment Element (`CheckoutForm`) is not on the order page, so the payment-page
   script risk is the checkout route; cart and order get the same policy and the same "no third-party-capable scripts" rule as the frame asks.
7. **A nonce-based CSP cannot be used on the prerendered store shell** (Next.js's own guide: nonces need dynamic rendering and are
   incompatible with static shells; `cacheComponents` is on). The policy is therefore hash- or allowlist-based (section 4.4), and its
   strength is stated honestly.
8. **The extras must come off the pay routes and still stay across the store's other pages.** `StoreChat`, `SiteConsent` (with the owner's custom code), `StoreAffiliate` and `BuyerQuestion` are mounted in the market layout, which every page shares. The first design (a parallel slot `@extras` like `@drawer`, empty on the three routes) was built and **failed its own end-to-end test**: a slot remounts when its page changes, so an open chat closed and the consent manager would have loaded its tools again on every navigation. Built instead: the layout draws them inside `OffPayRoutes` (`src/components/off-pay-routes.tsx`), a client component that reads the address (`usePathname()`, known on the server for a page loaded afresh) and draws nothing on a pay route; the layout stays mounted across the other pages, so nothing remounts, and children that are not drawn are never hydrated.
9. **There is no signed-in admin in CI** (no Supabase there; `getAccount()` returns null). Axe over signed-in admin screens cannot run in
   CI; the contract covers the admin's signed-out entry pages and says so (section 6).
10. **The Stripe payment form cannot be reached by e2e** (the demo store takes no payments, `payments off`). Terms-at-checkout and CSP
    behaviour that needs a live Stripe session are held by component, header and integration tests plus a manual test-mode payment the
    lead does before pushing (section 9).
11. **`platform.staff-accounts-and-roles` and `international.staff-roles-and-permissions` are the same Shopify feature in two domains**,
    which `docs/parity/README.md` rule 8 forbids; the wave frame already says one unit closes both. The lead should merge them (section 9).
12. **The EU's ODR platform no longer exists** (Regulation (EU) 2024/3228): no starter may link to it (section 4.1).


## Deviations from the frame (each keeps its intent; the lead may veto any)

| Frame says | This spec does | Why |
|---|---|---|
| The terms acceptance is recorded "on the order `terms_accepted_at`" | A one-to-one side table `order_terms` keyed by the order (3.1) | `orders` is the money lane's hottest table and both lanes would alter it; a side table also gets its own immutability trigger |
| Role templates are "seeded per store by `clone_store()`" | `ensureStoreRoles()` in application code makes them when the Team or roles page loads | the money lane re-creates `clone_store()` and `duplicate_store()` in its migration; two `CREATE OR REPLACE` of the same function drop each other's additions |
| New page roles `terms`, `privacy`, `returns_policy`, `shipping_policy`, `imprint` "(D112 mechanism)" | The same names plus `withdrawal_info` and `accessibility`, as **linked** roles outside `PAGE_ROLES` (3.1) | a D112 role with no address is a 404 (finding 1); the row asks for withdrawal information and a statement |
| `getAccount()` "exposes the assurance level" | `getAccount()` is **fail-closed** (null while a second step is due) and still carries `assurance`; `getSessionAccount()` is the raw one | about sixty existing callers become safe with no edit |
| Pruning the audit log "lives in the cron's application code" | Same, plus the trigger lets a row older than 24 months be deleted (3.3) | the existing trigger refuses every delete (finding 2) |
| "A recovery code ... forces re-enrolment at the next sign-in" | Same, through `accounts.two_step_reenrol_at` (3.2), for everyone, not only where two-step is required | the frame's wording |
| Templates, once deleted, "stay deleted" (the frame says nothing) | a new column `stores.role_templates_offered text[]` (migration `store_role_templates`) keeps which templates were offered | `ensureStoreRoles()` would otherwise bring a deleted template back on every visit |
| `member.can(key)` on the membership | `memberCan(member, key)` in `src/server/permissions.ts` | `Membership` is built by hand in about twenty existing tests; a required method would break them all |
| Audit action `page.published_with_issues` | `store.page_published_with_issues` / `platform.page_published_with_issues` (the existing `{owner}.page_…` names) | the other page actions already carry those prefixes; the area is `website`/`platform` either way |
| The sentence "By ordering you accept {terms} and {privacy}" | "By ordering you accept {terms} and confirm that you have read {privacy}." (nb, sv, da with the same meaning) | one does not accept a privacy statement, one reads it; the wording is for the lawyer (section 8) either way |
| Permissions "`{section}:{read\|write}`" for all ten sections | The same keys, but `staff:write`, `billing:write` and the owner-only pages are held by the owner role only in this wave | a role must not be able to grant the power to change roles or the plan |
| The guards are `requirePermission`, `checkPermission` and `requireOwnerRole` | Four more in `GUARDS` (`src/lib/permission-guards.ts`): `requireAnyPermission`/`checkAnyPermission` (any of a list of keys) and `requirePageTypeAccess`/`checkPageTypeAccess` (the key of a kind of page, `PAGE_TYPE_AREA`) | the page builder serves five kinds of page that live in three areas (website, products' layouts, marketing's A/B versions) and calls pictures, saved rows, templates and grid previews on the side; one key for all would either lock a Products role out of product layouts or let a Content role into them. The scan still checks each literal key against the page's own area |
| Work's screens are in the sweep, with no key named | `settings:read` for its pages and read-only actions, `settings:write` for its actions, `owner` for its settings and credit notes (as before); the combined view (`workStoresFor()`) offers a store only to a member whose role holds `settings:read` | the audit's own area map puts `work.` under `settings`, and a Work screen has no page of its own in the store navigation |
| Pages marked `needs: "owner"` are "guarded by anything but `owner`" never | Also the routes beneath them (`assistant/*`, `billing/resume`, `hosts/dac7` downloads), by the nearest ancestor page in the map | a route handler belongs to the page it serves; `billing/resume` was the plan's owner-only link already |
| `runOwnerTool()` checks "the principal's permission" | `OwnerToolContext.holder?: PermissionHolder`; a run with none given is an owner's | `runOwnerTool()` has about two hundred call sites in tests that pass no member; production callers (the assistant, the MCP server) always pass one, and the assistant is the owner's alone in this wave |

---

## 1. Purpose and scope

### 1.1 Rows this spec closes (or moves)

| Row | Weight | Bucket | Honest rating after this run |
|---|---|---|---|
| `international.legal-page-templates-and-policy-generator` | 4 | A | **partial**: every criterion is met in code and tests, but `docs/parity/WAVES.md` step 4 says a row resting on hand-written legal texts is not Full until a person has read them. Full when the owner or a lawyer has. |
| `international.accessibility-wcag-eaa-and-statement` | 4 | A (criterion 4 outside code) | **partial**: CI check, statement generator and contrast refusal built; an independent audit is outside the row and never counted by code. |
| `storefront.accessibility-and-theme-quality-guarantees` | 3 | A | **partial**: the four criteria are built; without the independent audit it is not Full (the brief says so; same evidence as the row above). |
| `international.pci-dss` | 5 | A | **partial**: strict CSP and script exclusion built and tested at header and import level; the SAQ A attestation is the company's, and a live Stripe session cannot run in CI. |
| `international.staff-two-step-authentication` | 4 | A | **full**, conditional on one manual check the lead records (the platform admin enrols in production). All four criteria are covered by tests with an injected Supabase client; nothing in CI talks to a real Supabase Auth. If that check is not done the row stays partial. |
| `international.staff-roles-and-permissions` | 3 | A | **full**: criteria 1, 2 and 4 are tested; criterion 3 is held with synthetic non-owner principals (the assistant stays owner-only, section 7). |
| `platform.staff-accounts-and-roles` | 4 | A | **partial** until the lead accepts the two criteria changes in section 6 (passkeys out; collaborators are invited by the owner, for an agency's account); **full** with them. |
| `international.audit-log-of-admin-changes` | 2 | A | **full**: every criterion is testable and tested. |

No row of this wave is in bucket B, C or D, but three of them cannot reach Full by code alone (the two accessibility rows need the
independent audit, PCI needs the SAQ), and one rests on legal review. Those four keep `partial` until the evidence exists.

### 1.2 What Shopify does (read)

| Area | What Shopify does | Source (read) |
|---|---|---|
| Legal pages | Policy generators for six policies (return, privacy, terms of service, shipping, legal notice, subscription). "Policy templates can be generated only in English and for checkouts that are set to English. Some policy generators are available in French, Italian, and Spanish." Policies are linked automatically in the checkout footer; no terms checkbox is mentioned. "Although Shopify can generate templates, you're responsible for following your published policies"; for other languages "you need to create your own store policies. Contact a local law expert." | https://help.shopify.com/en/manual/checkout-settings/refund-privacy-tos (read 2026-10-03) |
| Accessibility | Theme Store themes need an average Lighthouse accessibility score of at least 90 over home, product, collection and cart; no merchant-facing checker is described. | https://www.shopify.com/partners/blog/theme-store-accessibility-requirements (row, read 2026-10-03); https://shopify.com/accessibility (row) |
| PCI | Level 1 PCI DSS certified; merchants can see the attestation of compliance. | https://www.shopify.com/security (row, read 2026-10-03) |
| Two-step sign-in | Staff set up two-step authentication and passkeys for themselves; the owner cannot switch it on for others; only Plus can require a secure sign-in for all users. | https://help.shopify.com/en/manual/your-account/staff-accounts/two-step-authentication (row, read 2026-10-03) |
| Staff accounts | Permissions per user; users only on Grow and up (Grow 5, Advanced 15, Plus unlimited). | https://help.shopify.com/en/manual/your-account/users/users-plan-requirements (row, read 2026-10-03) |
| Activity log | Recent actions by owner or staff, up to 250 results, view only, not exportable; no plan restriction named. | https://help.shopify.com/en/manual/shopify-admin/activity-logs (row, read 2026-10-03) |

Where Kaizen goes **beyond** Shopify's native: legal starters in four languages with the store's own facts merged and a record of what
the shopper accepted; an optional terms checkbox; two-step required per store by an owner and for platform admins; a CSV export of the
activity log; permissions per section for every plan.

### 1.3 Out of scope here (taken by others or later)

The money lane (VAT engine, invoices, reports, unit price), GDPR export/erasure/retention (1g), anything in `checkout.ts`,
`cart-summary.ts`, order views, the product editor or tax settings beyond the small additive edits named in section 5. Section 7 lists what
is deliberately not done.

---

## 2. Behaviour

### 2.1 Legal starter pages (shopper-neutral, owner side)

**Where:** `/admin/{store}/settings/legal` (Settings, group *Selling*, owners only): "Legal pages".

- A table of the seven kinds: *Terms of sale*, *Privacy statement*, *Returns policy*, *Shipping policy*, *Withdrawal information*,
  *Imprint*, *Accessibility statement* (the last one is made on its own page, 2.3). For each: the page chosen for it (a select of the store's
  published pages, or "none"), its state (none / draft starter / published), **Create a starter draft** and, once one exists, **Create a
  new draft** (never overwrites).
- **Create a starter draft** builds a page of type `page` from `legalStarter(kind, language, facts)` and saves it with `savePage()` as a
  **draft**, never published. Title and address come from the kind's title in the page's language (`Kjøpsvilkår` → `kjopsvilkar`; if
  taken, `-2`, `-3`, as `createRolePage()` does). Regenerating always makes another draft; the old page is never touched.
- The language is the store's main language when it is one of nb, sv, da, en; the texts in the store's **other** languages among those
  four are written into the page's `translations` (D55, `mapTexts()`), so a Norwegian store that also offers English gets both. For any
  other main language the starter is made in English with the notice extended ("not available in your language: have it translated and
  reviewed"), and the page carries no machine translation of it. The store-wide AI translation (D110) keeps treating these pages as legal
  (unticked, shown apart): `isLegalPage()` is true for a page chosen for a legal role and the regex gains shipping words (3.1).
- The starter is **filled from the store's own facts** (`legalFacts(store)`): legal name, organisation number, VAT number (hook, 2.1.1),
  postal address, contact email, country, markets and their currencies, the shipping rate per market and free-above amount, the
  connected carriers' names, the return settings of D153 (window, who pays return shipping, when refunds are made, instructions, return
  address, companies), payments (Stripe: the methods are chosen in each store's own Stripe Dashboard, so the text names Stripe and no method), whether bookings or subscription boxes are on, whether visits are counted or tracking tools are set up, whether the
  chat agent is on, and the audience (consumers, businesses, both). A fact the store does not hold becomes a visible placeholder
  `[[Add: delivery time]]` (double square brackets), never an invented sentence.
- The first row of every starter is a rich-text block with `className: "legal-review-notice"` carrying the notice (2.1.2). The builder's
  checker (2.2) flags it, and any `[[…]]` placeholder, as **blocking** issues until the owner has removed them.
- **Choosing the page for a role**: the select on this screen, and the role selects of the Pages list (the existing `PageRoleForm`
  pattern). A page must be published to be chosen (as `setPageRole()` does for every role). A page can hold one role only (the existing
  `page_roles_store_page_key`), so terms and privacy are two pages; this is said on the screen.
- A page chosen for a legal role is **served at its own address** (`/s/{store}/{market}/{slug}`), is in the sitemap once published, is
  never redirected, and is never an A/B test target (CLAUDE.md: tests never change a legal page). The standard footer lists the published
  legal pages in a `<nav aria-label="Legal">` (additive to `StoreFooter`); a footer built in the builder links to them as any page.
- Starters are **out of the sitemap while drafts** because drafts are not published pages (the existing rule), and out of search,
  `llms.txt` and the chat agent's knowledge for the same reason.

#### 2.1.1 The VAT number hook

Unit 1a adds `commerce.store_tax_profile` in the other lane. This lane does not depend on its schema: `legalFacts()` takes `vatNumber`
from one function, `taxFactsOf(storeId)` in `src/server/legal-facts.ts`, which returns `null` here. The lead replaces its body with the
read of `store_tax_profile` at merge (one query; listed in section 9). Until then the imprint and the terms show `[[Add: VAT number]]`
when the store is not known to be unregistered.

#### 2.1.2 The notice (English text; nb, sv, da hand-written to the same meaning)

> DRAFT: needs legal review before use. Kaizen Store made this text from your store's details as a starting point. It is not legal advice
> and no lawyer has checked it. Read every sentence, fill in the [[bracketed]] parts, and delete this notice when you have.

### 2.2 The page builder's accessibility checker, and publishing

A pure checker, `pageIssues(content, context)`, lists problems in the **draft** being edited and the builder shows them in a *Checks*
tab of its sidebar, each with a link that selects the block.

| Rule id | Finds | Severity |
|---|---|---|
| `image_alt` | An image block with a picture and no alt text (`image.alt` empty) | blocking |
| `empty_link` | A button block with no label or no address; a rich-text link with no text; a menu or social link with no label | blocking |
| `contrast` | Text with an explicit colour over a row or column background with an explicit solid colour (opacity 100) whose WCAG ratio is under 4.5:1 (`contrastRatio()`, `src/lib/theme.ts`); with `theme` in the context, the theme's text colour is the text colour where none is set | blocking |
| `heading_order` | A heading level that skips (h2 then h4), or a second level-1 heading, reading rows in order, rich-text headings included | warning |
| `heading_empty` | A heading block with no text | blocking |
| `alt_long` | Alt text over 125 characters | warning |
| `link_text_generic` | A link or button reading only "click here", "read more", "her", "mer", "här", "läs mer", "klik her" and the like | warning |
| `placeholder` | Text containing `[[…]]` | blocking |
| `legal_notice` | A block with class `legal-review-notice` | blocking |
| `pay_page_block` | On the page chosen for the checkout: an `html` block or a video block that embeds another site (3.5) | blocking |

- **Blocking** means the publish button asks first. In the browser: a dialog lists the blocking issues, "Publish anyway" and "Fix first".
  On the server: `savePage(..., { publish: true })` re-runs the checker; with blocking issues and no acknowledgement it returns the
  problem `needs_confirmation` with the list (built: `{ ok: false, code: "needs_confirmation", problems: [a sentence], issues: PageIssue[] }`), writes nothing and publishes nothing. With `acknowledgedIssues: string[]` (rule ids and
  block ids the owner saw) it publishes and writes an audit entry `page.published_with_issues` with `{ page, issues: [{ rule, count }] }`.
  The owner's choice is therefore on the server, not only in the dialog. `pay_page_block` is **refused**, not asked about (below).
- A page saved as a draft is never held back.
- The checker reads only the page's own content. It cannot know the final colour of a block over a picture (an image background is not
  checked) and says so in the tab ("pictures behind text are not checked").
- Articles, headers, footers and product layouts use the same checker; `pay_page_block` applies to the checkout page only.

### 2.3 The accessibility statement generator

**Where:** `/admin/{store}/settings/accessibility` (Settings, group *Site*, owners only).

- Inputs the owner gives (`accessibility_settings`, 3.1): conformance status (`not_assessed`, `partial`, `full`), and for `partial` or
  `full` the audit evidence (who assessed, on what date, a link or a note): **`full` cannot be saved without an audit date and a name**;
  the microenterprise exemption (a tick that the business has fewer than 10 staff and a turnover or balance sheet of at most EUR 2
  million, EAA Art. 4(5)); known issues (free text, a list); the date the text was prepared and last reviewed; the feedback contact
  (defaults to the store's contact email).
- Facts the generator reads from the site (never from the owner): the site's address(es), the languages, the number of theme colour
  pairs below 4.5:1 (`themeWarnings()`), the share of media with no alt text (D89), the number of published pages with blocking checker
  issues, and the third-party parts it cannot vouch for (Stripe's payment form).
- **The conformance status defaults to "has not been assessed"** and the text then says exactly that. The generator never writes
  "conforms" without an audit entry, and never claims anything about Kaizen's own tests on the store's pages.
- The enforcement body per country comes from data (`ENFORCEMENT_BODIES`, section 4.3) with its source and date, and an
  `unverified` flag; an unverified entry is printed with "check with the authority" and listed in section 8.
- **Create a draft statement** builds a draft page (nb, sv, da, en as for the starters) with the `accessibility` linked role available;
  the same review notice, the same never-published rule, the same checker.

### 2.4 Terms at checkout (shopper side)

A store setting `terms_at_checkout` (`link` default, `checkbox`, `off`), edited on `/admin/{store}/settings/legal`.

- **`link`**: next to the pay button the shopper sees "By ordering you accept {the terms} and {the privacy statement}." with the two
  pages as links (the store's published pages for the roles `terms` and `privacy`, in the shopper's market language, opening in a new
  tab). No checkbox. If only one of the two is set, only that one is named; if neither is set the sentence is not drawn and nothing is
  recorded.
- **`checkbox`**: the same sentence with a required checkbox; the pay button is disabled while it is unticked, and says why to a screen
  reader (`aria-describedby`). The setting cannot be saved while no published terms page is chosen.
- **`off`**: nothing is drawn and nothing is recorded (the owner has said they show the terms another way).
- The text is a checkout *piece*, `checkout_terms` (D117, route `checkout`), available to a store's own checkout page in the builder like
  the other pieces and put directly above the payment piece in the starter page. **Built differently:** the standard checkout and a page
  with no such piece draw the sentence inside the payment form, right above the pay button (`CheckoutForm`'s `termsSlot`), which is what
  "next to the pay button" asks for and keeps a tick box beside the button it holds; the piece draws it where the owner put it. A store whose checkout page was built before this
  wave has no such piece: the piece is **also drawn by `CheckoutPayment` itself when the page has no `checkout_terms` block**, so the
  setting works for every store; a page that holds the piece draws it there instead (never twice).
- **When the shopper presses pay** (both `link` and `checkbox`), before Stripe's `confirm()` the browser calls a server action,
  `recordTermsAcceptance`, which finds the open checkout from the cart cookie, reads the two pages as they are published **now**, stores
  one snapshot of each (2.4.1), and writes `order_terms`. The action is idempotent per order (a second press, a retry or a changed card
  writes nothing new). If the action fails, in `checkbox` mode payment does not start and the shopper sees the message; in `link` mode
  payment goes on and the order simply has no record (staff see "terms not recorded").
- **What this does and does not prove.** The shopper's press of the pay button is the act; the server action is the record. A client that
  skips the action can still pay (Stripe's `confirm` is not ours to stop), so `checkbox` is a guard and a record, not an enforcement.
  The order page for staff says "Terms accepted {date} as shown", "Terms link shown, not recorded", or nothing.
- **Order of text**: the sentence is not a substitute for the button wording CRD Art. 8(2) asks for; the existing button reads "Pay {amount}"
  (`checkoutLabels.pay`); whether that is an acceptable "corresponding unambiguous formulation" is a question for the lawyer
  (section 8), not changed here.
- **No cookie, no storage.** The tick lives in memory (a tiny client store keyed by the page, `terms-choice.ts`, read by the payment
  form); nothing is added to `KNOWN_COOKIES`.
- **Subscriptions and standing deliveries**: renewals and delivery orders have no checkout; they have no record. The first order of a
  subscription has one. **Host orders** (D71) have one (the store's terms are what the shopper accepted). **Copied orders** (`C-…`) never
  have one (database refusal). **Appointments and bookings paid wholly at the venue** (D66) are confirmed from the cart by `confirmAtVenue()` and never reach the
checkout page, so in this wave they have **no sentence and no record** (the function is in `checkout.ts`, the money lane's file; section 7
lists it). An order with a part due online does reach the page and records.
- **Languages and currencies**: the sentence is in `i18n.ts` in nb, sv, da, en (other languages through the catalogue, as every English
  message); the snapshot is of the page **as localised to the shopper's market** (`localizePage()`), with its locale. No amount is involved.
- **Seeing it**: the order page for the shopper shows a short block "Terms you accepted" (piece `order_terms`, route `order`, drawn only
  when a record exists) with a read-only page for each snapshot (`/s/{store}/{market}/order/{orderId}/terms/{role}?session_id=`, the order
  page's own key, never another store's); staff see the same on the order page (`/admin/{store}/orders/{orderId}`). Whether the order
  confirmation email must carry the texts is a lawyer question (section 8); the snapshots exist, so either answer is possible. The one
  line that links them from the confirmation email is added by the lead at merge to avoid two lanes editing that email (section 9).

#### 2.4.1 The snapshot

`legal_snapshots` stores the **localised published page** (title and rows, as `PageContent` JSON) with its role, locale and
`content_hash` (SHA-256 of a canonical JSON of title and rows). One row per `(store, role, locale, hash)`: ten thousand orders under one
unchanged terms page share one row; a changed page makes a new row. Snapshots are never changed or deleted (database refusal).

### 2.5 Pay routes: policy, and what is not drawn

- **Content-Security-Policy on `cart`, `checkout` and `order`** routes of every store, on `/s/{store}/{market}/…` and on a store's own
  host (`/{market}/…`), for any market token including A/B tokens (`no~…`). Section 4.4 has the policy.
- **Not drawn on those three routes** (by `OffPayRoutes`, finding 8): `SiteConsent` (the consent banner, `ConsentManager` and `StoreCustomCode`, so no tracking tool and no
  owner script), `StoreChat` (the chat widget), `StoreAffiliate` and `BuyerQuestion`. **Still drawn** (the app's own bundle, no other
  origin): the header and footer, `StoreVisits` (its checkout-reached count feeds the analytics funnel), `StoreExperiments` and
  `AbMarker` (tests of the checkout page, D148), `BackToAdmin`, the cart drawer.
- **Every entry into a pay route is a full page load**, because a script that `ConsentManager` or the chat widget added to the document on
  an earlier page stays there after a client-side navigation. The cart's checkout button, the drawer's, and any redirect that ends on
  `/checkout` use a full navigation (`window.location.assign`); a client guard on the pay pages (`PayRouteGuard`) reloads the document
  once if it has been on any other page of the store. **Built differently from the first draft** (which read the navigation entry's name,
  and so missed cart, product, back to the cart): the market layout's `PayDocumentWatcher` notes in a module variable that the document has
  left the pay routes, and the guard on the cart, checkout and order pages reloads when it has (no storage; a reload starts clean).
- **The checkout page may not hold an `html` block or a video that embeds another site** (the policy would block them and they are exactly
  the owner-script risk the policy is there for): `savePage()` refuses to save such a block on the page chosen for the checkout, and
  `setPageRole()` refuses to choose a page that holds one. An uploaded video is allowed (`media-src` has the storage host).
- **A page that the policy breaks fails closed**: a blocked frame or script shows nothing and the payment form (`js.stripe.com`) is
  allowed; the owner is not told by the browser, so the builder's `pay_page_block` rule and the docs (`docs/pci.md`) are where they learn.

### 2.6 Two-step sign-in (staff)

- **Enrolling** (`/admin/account`, section *Two-step sign-in*; or forced, 2.6.2): the person scans a QR code (or types the secret) into an
  authenticator app, types a code, and the factor becomes active. **Ten recovery codes** are shown once, in a layout to copy or print,
  and the person must tick "I have saved these codes" to continue. Codes look like `K7QM2-9WXDB` (10 characters of the Crockford base-32
  alphabet, 50 bits).
- **Signing in** with a password, a magic link, a password-reset link or Kaizen Life reaches `aal1`. An account with a verified factor is
  then taken to `/admin/sign-in/two-step`, where it types the 6-digit code (or chooses *Use a recovery code*). Until the second step is
  passed, **no admin page, action or route works** (2.8: fail closed).
- **Recovery code**: a code is checked against the account's unused codes, marked used in the same statement (single use), and then the
  account's factors are removed through the Supabase admin API (all its sessions end), an email "A recovery code was used on your
  account" goes to the account's address, and everything is audit-logged. The person signs in again and is held at enrolment (2.6.2: `two_step_reenrol_at` forces it even where nothing requires two-step). The other recovery codes are revoked.
- **Removing a factor** or **regenerating the recovery codes** needs an `aal2` session (Supabase's own rule for unenrolling a verified
  factor); regenerating revokes the old set.
- **Wrong codes**: five failures by one account in 15 minutes pause second-step attempts for that account for 15 minutes ("Too many
  attempts. Wait 15 minutes."). The count is kept from the audit log (`account.two_step_failed`), no new table, no IP address. Supabase
  has its own limit on top.
- **Lockout cases**: no authenticator and no recovery code: a platform admin removes the factor from `/admin/platform/customers/{account}`
  (audit-logged); a platform admin who is locked out is recovered by the company through Supabase's dashboard (said in `docs/pci.md`'s
  runbook section). An environment switch `ADMIN_TWO_STEP=off` turns the whole requirement off if Supabase's MFA is misconfigured; it is not in
  the admin and is audit-logged at the next sign-in as `account.two_step_switch_off`.

#### 2.6.1 Who must

- **Platform admins: always.** A platform admin without a verified factor is held at enrolment before any admin page, store admin
  included, and cannot reach `/admin/platform`.
- **A store's owner can require it for the store** (`stores.require_two_step`, a switch on `/admin/{store}/staff`): every member of the
  store without a factor is held at enrolment before reaching that store's admin; other stores of the same person are not affected. The
  owner can switch it on only when they themselves have a verified factor and an `aal2` session (so they cannot lock themselves out), and
  the screen says how many members have none yet (from the mirror, 3.2). Switching it off is audit-logged.
- **Everyone else with a factor** is challenged at sign-in whatever the store says (a factor that exists is used).
- **Hosts** (D71): an enrolled host account is challenged like anyone; two-step is not *required* of hosts.

#### 2.6.2 The held state

A required person without a factor is sent to `/admin/sign-in/two-step/set-up?next=…` (outside the gated area, so there is no loop), sees
why ("{Store} requires two-step sign-in" or "Platform admins must use two-step sign-in"), enrols, saves the codes, and continues to `next`
(checked by `safeNext()`).

### 2.7 Roles and permissions

- **Permission keys**: `{area}:{read|write}` for the areas `orders`, `products`, `customers`, `marketing`, `analytics`, `website`,
  `bookings`, `settings`, `billing`, `staff`. `write` includes `read`. Pages need `read`; server actions and mutating routes need `write`.
  The area of a page is **derived from its place in the store navigation** (`sectionOf(path)`, the `group` of `ADMIN_PAGES`), with two
  overrides: `/staff…` is `staff` and `/billing` is `billing` (both live in the Settings sidebar). A test fails when a store page has no
  area.
- **System roles**: `owner` holds everything. `admin` (the enum value, unchanged) holds, with no role row, the **default admin set**: every
  `read` and `write` of orders, products, customers, marketing, analytics, website, bookings and settings, plus `staff:read` and
  `billing:read`, and **not** the keys marked owner-only below. This is exactly what an admin can do today (the sweep proves it, 2.7.2).
- **Owner-only stays owner-only.** Pages marked `needs: "owner"` in `ADMIN_PAGES` (the AI manager, return rules, payments, analytics
  settings, Google reviews, AI settings, features, billing, staff, the cart-reminder editor and shipping where marked) and every action
  that checks `role !== "owner"` today require the **owner** role whatever a custom role holds: one special key, `owner`, held by the
  owner role only. `staff:write` and `billing:write` are likewise **held by owners only in this wave**: a custom role cannot contain them
  (the role editor greys them, a database check refuses them). So a role can never grant the power to invite people, change roles or
  change the plan: no escalation.
- **Custom roles** (`store_roles`): the owner makes roles from the Team page (`/admin/{store}/staff/roles`): a name and, for each area, *no
  access*, *can view* or *can change*. A template set is offered on first visit and can be edited or deleted: *Orders*, *Products*,
  *Marketing*, *Content* (website), *Analytics*, *Read-only* (view everything but billing and staff). They are made by
  `ensureStoreRoles(store)` (idempotent, run when the Team or roles page loads and before a member is given a role; a template an owner
  deleted is remembered in `stores.role_templates_offered` and never made again), not by
  `clone_store()`, so this lane does not edit that function (section 5). A role in use cannot be deleted (the database restricts it; the
  screen says who holds it).
- **Assigning**: the Team page shows each member's role; an owner changes it (a select of *Owner*, *Admin* and the custom roles). A member
  with a custom role has the enum role `admin` and a `role_id`: any code that still only looks at the enum treats them as a non-owner admin,
  and the guards narrow them to their role. The store always keeps one active owner (the existing trigger and test).
- **What a member sees**: the navigation (tabs, sidebars, the Settings and Website hubs' cards, Home's shortcuts, the account menu) and the
  AI map (`findPages`, `pagesFor`) are filtered by what the member can use (`storeSections(flags, can)`); a page or action they cannot use
  gives a 404 (pages, routes) or a refusal "You do not have access to this." (actions). Home (`/admin/{store}`), Your account and the
  activity log need membership only.
- **Collaborators**: the owner invites an email as a *collaborator* with a role and an expiry (1 to 365 days, default 30); it is the
  invitation of an agency's account (it can be an account that is a member of other stores). The staff list shows them with a
  *Collaborator* badge and the end date. A collaborator is never an owner, never holds `staff:*` or `billing:*`, and loses access at the
  expiry: `getMembership()` is changed to ignore a member whose `expires_at` has passed (its query gains `and (m.expires_at is null or m.expires_at > now())`), and the daily job marks it ended (`disabled_at`, audit
  `staff.collaborator_expired`). The owner can end it earlier with *Remove access*, or extend it.
- **The AI manager and the store's MCP server** (2.7.3).

#### 2.7.1 Guards (the one place the rule lives)

`src/server/permissions.ts`: `requirePermission(storeSlug, key)` for pages and route handlers (sign in, held at two-step, or 404),
`checkPermission(storeSlug, key)` for actions (returns the membership or `null`; the action returns its refusal), `requireOwnerRole(storeSlug)`
for the `owner` key, `requireAnyPermission`/`checkAnyPermission` for what any of several keys opens (the page builder's side actions: pictures, saved rows, templates, a grid's preview, which a website editor, a product-layout editor and an A/B version editor all call) and `requirePageTypeAccess`/`checkPageTypeAccess` for the kinds of page (`PAGE_TYPE_AREA`: pages, articles, headers and footers are the website's, product layouts the products', an A/B test's versions marketing's). All replace every call of `requireMember()` in admin pages, actions, routes and helpers; `requireMember()` stays
exported for `src/server/auth.ts`'s own internals and the Home/membership-only pages through `requireMemberAny()`. After the sweep, **no
file outside `src/server/auth.ts` and `src/server/permissions.ts` compares `role` with `"owner"`**; they ask `memberCan(member, "owner")` (server build: `Membership` is a plain object that tests build by hand, so the check is a function of it, `memberCan()` in `src/server/permissions.ts`, not a method).

#### 2.7.2 The sweep: mechanical and complete

1. **Before editing**, a one-off script reads every admin page, action file, route handler and helper and writes
   `src/lib/permissions.baseline.json`: for each, its legacy requirement (`member`, or `owner` where it checks the role) and its area. The
   file is committed; it is the oracle.
2. **The sweep** gives each entry point its guard by directory ownership (section 5.4).
3. **Scan tests** (`src/lib/permissions.scan.test.ts`) fail the build when: a `page.tsx`, `route.ts` or `*actions*.ts` under the store
   admin, the Work screens under `(owner)/account/work/s/[store]`, the assistant and replicate routes, or `src/app/api/**` using
   `getMembership` calls no guard from `GUARDS` (directly or through a wrapper listed in `DELEGATED_GUARDS`, which the test checks itself calls
   one); a bare `requireMember(` or `getMembership(` appears outside the two files; `role === "owner"` or `role !== "owner"` appears outside
   them; an `ADMIN_PAGES` store page has no area; a page marked `needs: "owner"` is guarded by anything but `owner`; the guard's key does not match
   the page's derived area.

   *As built* (`permissions.scan.test.ts`, 10 tests): the scan reads the comment-stripped source of every entry point (the store admin's pages,
   routes, layouts and `"use server"` files, the Work screens in both route groups, the duplicate-a-store page and the template preview) and
   holds each guard call to a **literal** key: a page asks `read` of its own area, an action or a mutating route `write` (an action named in
   `READ_ONLY_ACTIONS` asks `read`), a page the map marks owner-only (or a route beneath it) asks `owner` and nothing else, and `owner` is
   asked elsewhere only where the baseline says the file asked for the owner role before roles (or the file is listed in `OWNER_ONLY_EXTRA`
   with its reason). A route handler takes the key of the nearest ancestor page in the map (`/assistant/turn` is the assistant's: owner). The
   page builder's views are delegated guards: the scan compares the area of the `type="…"` each page passes with the page's own area. Every
   exported action of a file that takes a store must call a guard itself or a helper of its file that does (mutation-tested). Two things are
   not matched by the pattern and are listed in the test with their reason: the baseline marks two company-account pages `owner` for a
   *company* role comparison (`BASELINE_FALSE_OWNER`), and a few lines compare a role that is not a member's (`NOT_A_MEMBERS_ROLE`: the
   account's list of stores, a company's role, the platform's list of a store's people).
4. **The matrix test** (`permissions.matrix.test.ts`) runs the pure `can()` for `owner`, the default `admin` and each seeded template
   against every page of `ADMIN_PAGES` and a sample of actions per area, and compares the owner and admin columns to the baseline (no
   page gained or lost).

#### 2.7.3 The assistant and the MCP server

- Every owner tool gets a permission in one exhaustive table, `TOOL_PERMISSIONS: Record<OwnerToolName, PermissionKey>`
  (`src/lib/owner-tool-permissions.ts`): adding a tool without one is a compile error, and a test checks that read tools need `:read`,
  changing tools `:write`, gated tools the `:write` of their area, and tools of an owner-only page the `owner` key.
- `runOwnerTool()` checks the principal's permission before the handler; a refusal is "I can't do that for you: your role has no access to
  {area}." `find_pages` and `open_page` offer only pages the member can open.
  *As built*: `OwnerToolContext.holder` carries the member (a missing one is an owner's, see the deviations); `preflightOwnerTool()` refuses a
  change the role may not make before it is kept for a yes; `runTurn()` offers the model only the tools the role may use
  (`holderOfPrincipal()`, `Principal` now carries `kind` and `permissions`); `siteFlags()` gives the admin map `canOpen`, built from
  `canOpenPath()`, so `find_admin_page` and the pages listed in the prompt are the role's own. Tests: `owner-tool-permissions.test.ts`
  (exhaustive both ways) and `owner-tool-permissions.int.test.ts` (synthetic principals: refusals in words, gated changes refused before being
  kept, the offered tools and pages).
- **The assistant stays owner-only in this wave** (it is still reached through `/assistant`, `needs: "owner"`), so in production the check
  always passes; the criterion is held with synthetic non-owner principals (section 6).
- The store's MCP server (`/api/mcp`) accepts only owners (unchanged) and now also refuses a token whose `aal` claim is not `aal2` for a
  store that requires two-step, and for a platform admin.

### 2.8 The two-step gate (how it fails)

- `getAccount()` returns the account **only when the session is allowed to use the admin**: it is null for an enrolled account at `aal1`
  and for a platform admin without `aal2`, and so **every one of its roughly sixty existing callers fails closed** with no edit (platform
  routes, consent page, hosts, assistant routes). A new `getSessionAccount()` returns the account regardless, for the sign-in and
  two-step pages only. Both return an `Account` that carries `assurance: { level: "aal1" | "aal2", enrolled: boolean }`.
- The *held* state has a reason: `assuranceOf(session)` returns `ok`, `challenge` (a factor exists, session at `aal1`), `enrol` (required,
  no factor) or `off` (the kill switch). `Gate` in the gated layout sends `challenge` to `/admin/sign-in/two-step` and `enrol` to
  `/admin/sign-in/two-step/set-up`. A store's requirement is checked where the store is known (`requirePermission`, `getMembership`):
  `getMembership()` returns `null` for a member held by their store's requirement, so route handlers answer 401/404 and pages redirect.
- **Trusted sources** (finding 4): the `aal` claim of the verified JWT (`getClaims()`), and for `aal1` only one `supabase.auth.getUser()`
  per request (cached) whose `factors` list is the server's. The cookie's own `user` object is never trusted for this. An `aal2` session
  costs no extra call.
- After the second step Supabase ends the person's **other** sessions (its documented behaviour on verifying a factor); the screen says so.
- The sign-in actions and routes (password, `/auth/callback`, `/auth/confirm`, the Kaizen Life callback) end at the two-step page when
  the account is enrolled; the gate would catch them anyway, the redirect is for the person's benefit.

### 2.9 The activity log

**Where:** `/admin/{store}/activity` (Settings, group *Account*, next to Team); `/admin/platform/activity` for platform events (store
null), platform admins only.

- Lists who did what, when: time (store time zone, with the date), person (name or email, avatar), area, a sentence made by code from the
  action and its target ("Changed the price of *Demo: Lampe*", "Invited anna@… as Orders"), and, expanded, the changed fields as
  *from → to*. Filters: **person** (any member, past members included), **area**, **period** (from and to, in the store's days), and an
  **action** select. Paged by 50 with a cursor (`?before={id}`), newest first. The page says "Entries are kept for 24 months."
- **What a viewer sees**: an owner sees every entry of the store. Anyone else sees the entries of the areas they can **read**, plus their
  own entries; `staff` entries need `staff:read`. Platform entries (store null) are never shown here. Another store's entries never appear
  (every query takes the store id).
- **Export**: owners get *Download CSV* (period required, at most 50,000 rows, `toCsv()` so a cell that starts `=`, `+`, `-`, `@` is made
  harmless): time (UTC ISO), time (store zone), person email, area, action, target type, target id, summary, changes. The export is itself
  audit-logged (`activity.exported`).
- **Account security events** (enrolled, removed, failed second step, recovery code used, reset by a platform admin) are written once with
  store null (the platform's view) and once per store the person is an active member of with area `staff`, so each owner sees their own
  staff's security events.

### 2.10 What gets audited (the writes)

`audit()` keeps its signature (224 callers) and gains an optional fifth argument `{ area?, target?: { type, id }, changes? }`;
`area` defaults from the action prefix by `areaOfAction()`. `auditChange(member, action, target, before, after, kind)` computes the diff
with a **per-kind field allowlist** and writes it. Written entries the criteria name:

| Change | Action | Where it is written |
|---|---|---|
| Product created, edited, archived | `product.created`, `product.updated`, `product.archived` (new) | `saveProduct()` after its transaction; fields: title, status, handle, kind, vat category, category/tag ids, variant count; stock not (it has its own history) |
| Price | `product.price_changed` (new), one entry per variant and market with `{ sku, market, currency, from, to }` | next to each `commerce.set_price` call in `saveProduct()` (minor units, with currency) |
| Page | `page.saved`, `page.published`, `page.unpublished`, `page.deleted` (existing prefixes, now with `target`) and `page.published_with_issues` | `savePage()`, `unpublishPage()`, `deletePage()`; fields: title, address, state, row and block counts (never the text) |
| Discount | `discount.created/updated/deleted` (existing) | `discounts.ts`; fields: code, kind, value, limits, dates, active |
| Shipping | `shipping.updated` (existing, its `rates` become a before/after) | `saveShippingSettings()` |
| Staff and roles | `staff.invited`, `staff.disabled` (existing), `staff.role_assigned`, `staff.collaborator_invited`, `staff.collaborator_expired`, `role.created/updated/deleted` (new) | `settings.ts`, `store-roles.ts` |
| Payment settings | `payments.provider_updated` (existing; fields: enabled, mode, orderInvoices) | `setStripeProvider()` |
| Two-step and security | `account.two_step_enrolled/removed/passed/failed/reset`, `account.recovery_codes_generated`, `account.recovery_code_used`, `store.two_step_required/optional` | `two-step.ts` |
| Terms and legal | `store.terms_mode_changed`, `store.legal_starter_made`, `store.legal_role_changed` | `legal-starters.ts` |

- **Never secrets**: `changes` holds only fields in the allowlist of its kind; a field outside it is recorded as `{ changed: true }`
  with no value; and `auditChange()` refuses (throws in tests, drops in production with a log) any key matching
  `/secret|token|password|key|iban|authorization|cookie/i` or any value longer than 300 characters (truncated with `…`).
- **A test scans** every `audit(` call literal in `src` and fails when its action has no area in `AUDIT_AREAS` (a new action forces a
  decision), and every `commerce.set_price` caller for a matching `product.price_changed` write.

### 2.11 Failure behaviour (summary)

| Failure | Behaviour |
|---|---|
| Supabase Auth unreachable at the gate | `aal1` sessions cannot be assessed: held at an error page "We could not check your two-step status. Try again."; `aal2` sessions (signed claim) are unaffected. Never fails open. |
| `SUPABASE_SECRET_KEY` missing when a recovery code is used | The code is **not** consumed; "Recovery is not available on this server. Ask a platform admin to reset your two-step." |
| Email provider down for the recovery-code notice | Recovery stands (the factor is gone); the failure is in the email log; never undoes it. |
| Checker throws on odd content | Publishing proceeds as without it, the error is logged; the builder tab says "Checks are not available". |
| Terms action fails | `checkbox`: no payment, message; `link`: payment continues, no record. |
| A legal page is unpublished or deleted | The role row goes with a deleted page (cascade, as page roles do); the checkout sentence drops that page; staff Settings shows "No terms page chosen". |
| Audit write fails | The change still stands (as today: `audit()` is after the change); `auditChange` never throws into the request. The failure is logged. |

### 2.12 Edge cases that need an owner's eye

- A store that switches `checkbox` on and later unpublishes its terms page falls back to no sentence and no record, and Settings says so.
- A duplicated store (D129) copies `page_roles` (including legal roles, mapped to the copied pages) but not `order_terms` or `legal_snapshots`;
  the copied legal pages carry the original's company details, so the duplication screen's note says "legal pages are copied as written:
  check the company details" (one sentence added to `docs/store-copy.md`).
- A starter regenerated after the owner changed their company details is a new draft with the new details; published pages are not touched.
- Two-step is per Supabase auth user; an agency account that is a collaborator in several stores has one factor for all.

---

## 3. Data

Every new table is in the `commerce` schema, has row-level security **enabled with no policies** (the pattern of every table here), is
reached only from server code, and is classified in `COPY_RULES` (3.5). Migrations are generated from `src/db/schema.ts`
(`pnpm db:generate`) and the rules Drizzle cannot express go in custom migrations (`--custom`). Names below are the intended ones; the
foundation agent may adjust a column name to fit Drizzle's conventions but not the meaning.

### 3.1 Unit 1e

**Linked legal roles** (`src/lib/legal-roles.ts`). `PAGE_ROLES` (D112) is unchanged. A new `LEGAL_ROLES` constant holds the seven linked
roles: `terms`, `privacy`, `returns_policy`, `shipping_policy`, `withdrawal_info`, `imprint`, `accessibility`. (The frame lists the first
five plus `imprint`; `withdrawal_info` and `accessibility` are added because the row asks for withdrawal information and a statement as
pages a store can point to.) They are stored in the **same table**, `commerce.page_roles`, whose check constraint `page_roles_role` is
replaced (drop and re-add, as `category_tag_roles` did) to allow them; the one-role-per-page key stays.

| Piece | Change |
|---|---|
| `store.pageRoles` (`stores.ts`) | unchanged: `isPageRole()` already drops unknown roles |
| `store.legalPages: Partial<Record<LegalRole, string>>` | new; read by the same cached query (`loadStore`, one more aggregate over the legal roles) |
| `setPageRole(account, store, role, page)` | role type widened to `PageRole \| LegalRole`; copy for a legal role's name from `LEGAL_ROLE_COPY`; same refusals (published, not front, not products, not another role); `audit` action `store.legal_role_changed` for legal roles |
| `StorePageView` | **no change**: it finds a role with `PAGE_ROLES.find`, so a legal page is served at its own address |
| `listPublicStores()` (`role_pages`) | already counts every row of `page_roles`; it gains `and r.role <> all (legal roles)` so published legal pages stay **in** the sitemap (the roles of D112 stay out) |
| `isLegalPage(slug, title, legalPageIds?)` (`store-translate.ts`) | true for a page whose id is a legal role's; the regex gains `shipping\|frakt\|levering\|leverans\|fragt\|forsendelse\|tilgjengelig\|tillg[aä]nglighet\|tilg[aæ]ngelighed\|accessib` |
| `experiments_guard()` (A/B) | refuses a target page that holds a legal role (`experiments.target_legal`), re-created from its live definition; `experiment-admin.ts` refuses it before the database does and the A/B tools say "legal pages are never tested" |
| `pageRulesProblem()` (`pages.ts`) | refuses an `html` block, or a video block that embeds another site, on a page chosen for the checkout role (`pay_page_block`), and `setPageRole(checkout)` refuses a page that holds one |

**`commerce.stores`** gains `terms_at_checkout text not null default 'link'`, check in (`link`, `checkbox`, `off`).

**`commerce.legal_snapshots`** (store-owned, immutable)

| Column | Notes |
|---|---|
| `id uuid pk` | |
| `store_id uuid not null` fk stores | indexed |
| `role text not null` | a `LegalRole` |
| `locale text not null` | the market's locale the shopper saw (`nb-NO`, `sv-SE`, …) |
| `page_id uuid null` | the page it came from; **no foreign key** (the page may be deleted; the snapshot is the record) |
| `title text not null`, `content jsonb not null` | the localised published page: title and rows as `PageContent` |
| `content_hash text not null` | SHA-256 hex of a canonical JSON of title and rows |
| `created_at timestamptz` | |
| unique `(store_id, role, locale, content_hash)` | deduplication: one row per unchanged text |

Rules: a trigger (`commerce.forbid_change()`, the existing function) refuses UPDATE and DELETE.

**`commerce.order_terms`** (store-owned, immutable; one row per order that recorded acceptance)

| Column | Notes |
|---|---|
| `order_id uuid pk` fk orders | one record per order |
| `store_id uuid not null` fk stores | indexed; a composite check that it is the order's store (trigger) |
| `mode text not null` | `link` or `checkbox` (what the shopper was shown) |
| `accepted_at timestamptz not null` | when the shopper pressed pay (server time) |
| `locale text not null` | |
| `snapshots jsonb not null` | `[{ role, snapshotId, hash, title }]` for the pages named in the sentence |

Rules: UPDATE and DELETE refused; a trigger refuses a row for an order with `copied_from is not null` (copied orders never carry one).
A separate table, not columns on `orders`, because `orders` is the money lane's hottest table (VAT treatment is being added there) and this
keeps the two lanes' schema edits apart; the shopper and staff views expose it as `OrderView.terms`. The frame's wording ("records on the
order `terms_accepted_at` and a snapshot") is met by `order_terms.accepted_at` keyed by the order.

**`commerce.accessibility_settings`** (store-owned, one row per store)

| Column | Notes |
|---|---|
| `store_id uuid pk` fk stores | |
| `status text not null default 'not_assessed'` | check in (`not_assessed`, `partial`, `full`) |
| `assessed_by text`, `assessed_on date`, `report_url text`, `assessment_note text` | check: `status <> 'full'` or (`assessed_by` and `assessed_on` not null) |
| `microenterprise boolean not null default false` | the owner's tick |
| `known_issues text not null default ''` | length <= 4000 |
| `contact_email text`, `prepared_on date`, `reviewed_on date` | |
| `updated_at`, `updated_by uuid` fk accounts | indexed |

### 3.2 Unit 1f

**`commerce.accounts`** gains `two_step_since timestamptz null`: a **mirror for display only** ("has two-step": the Team page and the
platform's customer page). It is set when an account's own `aal2` session is seen and cleared when an `aal1` session's server-side
`getUser()` shows no verified factor. It is **never** used to decide access (finding 4).

It also gains `two_step_reenrol_at timestamptz null`: set when a recovery code is used or a platform admin resets an account's two-step, cleared when a factor is next verified. While it is set and the account has no factor, `assuranceOf()` returns `enrol` for **that account whether or not any store or the platform requires two-step** (the frame's "forces re-enrolment at the next sign-in"); the page says why and offers no skip. Unlike the mirror, this column is a decision the server made, so it is read for access.

**`commerce.stores`** gains `require_two_step boolean not null default false`.

**`commerce.account_recovery_codes`**

| Column | Notes |
|---|---|
| `id uuid pk`, `account_id uuid not null` fk accounts (indexed) | |
| `batch uuid not null` | the set a code came with |
| `code_hash text not null` | hex of HMAC-SHA256 of the normalised code (upper case, no separators) keyed by a key derived from `SETTINGS_ENCRYPTION_KEY`; unique `(account_id, code_hash)` |
| `created_at`, `used_at timestamptz null`, `revoked_at timestamptz null` | |

Rules: a trigger allows an UPDATE only to set `used_at` or `revoked_at` once from null; the plaintext is never stored and is shown once.
Used and revoked rows older than 12 months are deleted by the daily job in application code (a plain `delete` statement, not inside a function).

**`commerce.store_roles`**

| Column | Notes |
|---|---|
| `store_id uuid not null` fk stores, `id uuid not null default gen_random_uuid()`, pk `(store_id, id)` | |
| `name text not null` | 1 to 60 characters; unique on `(store_id, lower(name))` |
| `template text null` | the template key it was made from (`orders`, `products`, `marketing`, `content`, `analytics`, `read_only`), so `ensureStoreRoles()` does not make it twice |
| `permissions text[] not null` | check: contained in the 18 grantable keys (all `read`/`write` pairs except `staff:write` and `billing:write`); `write` implies `read` is normalised in code |
| `created_at`, `updated_at`, `created_by` fk accounts (indexed) | |

**`commerce.store_members`** gains `role_id uuid null`, `kind text not null default 'staff'` (check in `staff`, `collaborator`) and
`expires_at timestamptz null`, with: a composite foreign key `(store_id, role_id)` to `store_roles` (`on delete restrict`, indexed);
check `role_id is null or role = 'admin'` (only the admin enum value carries a custom role); check `kind <> 'collaborator' or (role =
'admin' and expires_at is not null)`; the existing `keep_an_owner` trigger is unchanged.

**`commerce.audit_log`** gains `area text`, `target_type text`, `target_id text`, `changes jsonb`; indexes `(store_id, area, id desc)` and
`(store_id, account_id, id desc)`. The existing rows get `area` from their action prefix by **one top-level `UPDATE` in the migration**
(a `CASE` over the same prefix table as `AUDIT_AREAS`, with exact-action overrides first); the readers use `coalesce(area,
areaOfAction(action))` as well, so a failed backfill changes nothing visible.

### 3.3 The rules the database itself enforces

| Rule | How |
|---|---|
| `legal_snapshots` and `order_terms` are never changed or deleted; a copied order has no `order_terms` | `forbid_change()` triggers and a guard trigger |
| A page holding a legal role cannot be an A/B test target | `experiments_guard()` |
| `accessibility_settings.status = 'full'` needs an assessor and a date | check |
| Recovery codes are single use and unreadable | trigger on update, hash-only storage |
| A custom role holds only grantable keys; a role in use cannot be deleted; only the admin enum value carries a role; a collaborator is never an owner and always ends | checks and the composite restrict key |
| The store keeps one active owner | existing `keep_an_owner` trigger (test kept) |
| **Audit log: no UPDATE except filling `area` once; DELETE only of a row older than 24 months** | `commerce.guard_audit_log()` replaces `audit_log_append_only`. It contains `RAISE EXCEPTION` and a comparison, **no `DELETE` statement**, so the migration tool does not cancel it. The 24 months are a constant in the function and in `AUDIT_RETENTION_MONTHS`; a test holds the two equal. A row of the last 24 months cannot be deleted by anyone, the app included. |

The migrations are small and top-level (`CREATE TABLE`, `ALTER TABLE`, `CREATE TRIGGER`, one `DROP TRIGGER`, one `DROP CONSTRAINT`, one
`UPDATE`). **No function body contains `DELETE`, `TRUNCATE` or `DROP`**: collaborator expiry, recovery-code pruning and audit pruning are
application code run by the daily job (`src/server/security-jobs.ts`, called from the existing `/api/cron/subscription-reminders`).

### 3.4 What is private

Nothing in this wave is public data except the pages the owner publishes. `order_terms` and `legal_snapshots` are read only by staff of
the store (their order page) and by the shopper with the order page's own key. `account_recovery_codes` holds hashes only and is read
only to verify a code. `store_roles`, `audit_log` and the activity page are staff-only and per store. `accessibility_settings` is
staff-only; only the generated page is public. Emails of staff appear in `audit_log.details` as they do now.

### 3.5 Copying a store (`clone_store()`, `duplicate_store()`) and `COPY_RULES`

**This lane does not edit `clone_store()` or `duplicate_store()`**: the money lane re-creates both functions in its own migration (the
tax profile), and two migrations that each `CREATE OR REPLACE` them would drop one another's additions. Instead:

| Table or column | `COPY_RULES` class | What happens |
|---|---|---|
| `legal_snapshots` | `never` | evidence of what the original's shoppers accepted |
| `order_terms` | `never` | same; copied orders are history without it |
| `accessibility_settings` | `never` | an audit claim belongs to the site it was made for |
| `store_roles` | `derived` | the new store gets the templates from `ensureStoreRoles()`; custom roles are not copied (they name people's powers) |
| `page_roles` (existing, `settings`) | unchanged | its legal rows are copied by the generic statements with the pages that were copied |
| `stores.terms_at_checkout` | n/a | the copy starts with the default (`link`) |
| `stores.require_two_step` | n/a | the copy starts `false` |
| `store_members` (existing, `never`) | unchanged | |

### 3.6 Retention

| Data | Kept |
|---|---|
| `audit_log` | **24 months**, then pruned by `pruneAuditLog()` (default decision; section 9 asks the owner). 1g's `retention_rules` row for the audit log must say the same figure; the constant is exported for it. |
| `legal_snapshots`, `order_terms` | as long as the order exists (orders are never deleted); no personal data of the shopper |
| `account_recovery_codes` | until revoked or used; then 12 months |
| `store_roles`, `accessibility_settings` | until changed or deleted |

---

## 4. Rules and law

Each rule has its source, whether the source was read in this run, and a place to correct it. "Not read" means the rule is written from
the frame or general knowledge and must be checked by the reviewer; none of it is presented to a shopper as a fact without the notice.

### 4.1 Legal pages: what they must contain

| Rule | Source | Read |
|---|---|---|
| Before the contract the consumer gets: the trader's identity, address and contact details, the goods' main characteristics, total price with taxes and delivery costs, payment and delivery arrangements, the right of withdrawal and its conditions, the cost of returning goods, the legal guarantee of conformity, after-sales service, contract duration where relevant | Directive 2011/83/EU Art. 6(1) | https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32011L0083 (2026-10-03) |
| The model withdrawal instructions and the model withdrawal form are in Annex I(A) and I(B) | same, Annex I | same (2026-10-03; headings read, the full wording is for the foundation agent to take from EUR-Lex) |
| Service providers make easily and permanently available: name, geographic address, contact details including email, trade register number, VAT number where the activity is subject to VAT, supervisory authority where one is needed; prices indicated clearly with whether taxes and delivery costs are included | Directive 2000/31/EC Art. 5 | https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32000L0031 (2026-10-03) |
| Norway: § 8 of the e-commerce act requires name, address, email and other details that allow direct contact, registration details and VAT status; § 11 requires contract terms to be made available so they can be **stored and reproduced** | ehandelsloven, https://lovdata.no/dokument/NL/lov/2003-05-23-35 | 2026-10-03 |
| Norway: § 8 of the withdrawal act requires the information before the contract incl. a standardised withdrawal form; the period is 14 days (§§ 12, 13) | angrerettloven, https://lovdata.no/dokument/NL/lov/2014-06-20-27 | 2026-10-03 |
| A privacy statement gives: the controller's identity and contact, purposes and legal basis, recipients, transfers, the storage period or its criteria, the data subject's rights, the right to withdraw consent, the right to complain to a supervisory authority, whether providing data is a duty and what follows, automated decisions | GDPR Art. 13(1) and (2) | https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679 (2026-10-03) |
| **No link to the EU's online dispute resolution platform**: the ODR Regulation is repealed with effect from 20 July 2025 and the trader's duty to link to it is deleted | Regulation (EU) 2024/3228 Arts. 1, 2, 3 | https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R3228 (2026-10-03) |
| Swedish (distansavtalslagen 2005:59, lagen om elektronisk handel) and Danish (forbrugeraftaleloven, e-handelsloven) national texts | national acts | **not read**: the starters name no section of them; the reviewer adds them |
| A two-year legal guarantee of conformity for goods (Directive (EU) 2019/771 Art. 10) and Norway's longer periods | the directive and forbrukerkjøpsloven | **not read**: the starters say "the legal guarantee that applies in your country" and leave the period as `[[Add: guarantee period]]` |
| Names of the consumer complaint body (NO, SE, DK) and the data protection authority (Datatilsynet NO, IMY SE, Datatilsynet DK) | the authorities' sites | **not read**: placeholders the reviewer fills; the authority names appear only as `[[Check: …]]` suggestions |

**What each starter must contain** (`REQUIRED_TOPICS`, checked by a unit test in all four languages: each section of a starter carries a
`topic` tag in the source module and the test requires every listed topic):

| Kind | Required topics |
|---|---|
| Terms of sale | `seller`, `products_prices`, `vat_shipping_costs`, `order_contract` (the order obliges the shopper to pay; the contract terms can be stored: the snapshot), `payment`, `delivery`, `withdrawal` (summary and a link to the withdrawal information and to `/withdraw`), `returns_link`, `conformity` (legal guarantee), `complaints`, `disputes` (no ODR), `privacy_link`, `law_and_changes`, plus `bookings_subscriptions` when those modules are on and `businesses` when the audience includes businesses |
| Privacy statement | `controller`, `contact`, `purposes_basis`, `recipients` (the platform operator as processor, the payment provider, the email provider, the carriers named in the store's settings, and each tracking tool the store has set up), `transfers`, `retention`, `rights`, `consent_withdrawal`, `complaint_authority`, `obligation_to_provide`, `automated_decisions` (and the AI assistant, only when the store's chat agent is on), `cookies_link` |
| Returns policy | `window` (days from `return_settings`, never under 14 for the legal right), `how_to` (the store's instructions text), `who_pays`, `refund_timing`, `excluded_goods` (the categories of D153), `return_address`, `withdrawal_link`, `businesses` (when `b2bReturns`) |
| Shipping policy | `markets`, `rates` (each market's flat rate and free-above amount, formatted with `formatMoney`), `carriers` (names only), `delivery_time` (placeholder), `tracking`, `outside_eu` (placeholder), `damaged_goods` (placeholder), `contact` |
| Withdrawal information | `right` (14 days from receipt, CRD), `how` (the online withdrawal function, email, address), `effects` (reimbursement within 14 days, the trader may hold back until goods or proof of sending, the consumer pays return cost as the store's setting says, diminished value), `exclusions`, `model_form` (Annex I(B) text) |
| Imprint | `legal_name`, `org_number`, `vat_number`, `address`, `email`, `phone` (placeholder: Kaizen holds none), `register` (placeholder), `supervisory_authority` (placeholder) |

Wording rules for all of them: plain sentences, no promise the store has not made, no law named except those in the table above, every
fact from `legalFacts()` or a `[[…]]` placeholder, and **no sentence written by a model**. They live in `src/lib/legal-starters/{nb,sv,da,en}.ts`,
not in `i18n.ts` and not in `ui_translations`, so the catalogue and AI translation never see them.

### 4.2 Terms at checkout

| Rule | Source | Read |
|---|---|---|
| The order button or similar function is labelled "only with the words 'order with obligation to pay' or a corresponding unambiguous formulation indicating that placing the order entails an obligation to pay the trader" | CRD Art. 8(2) | 2026-10-03 |
| The trader confirms the contract "on a durable medium within a reasonable time after the conclusion of the distance contract, and at the latest at the time of the delivery of the goods or before the performance of the service begins" | CRD Art. 8(7) | 2026-10-03 |
| Contract terms must be available so they can be stored and reproduced | ehandelsloven § 11 | 2026-10-03 |
| Whether a link to a web page is a durable medium, and so whether the terms must be attached to the confirmation email | CRD Art. 2(10) and case law | **not read**: a lawyer question (section 8); the snapshot makes either answer possible |
| `link` mode records "shown and ordered"; `checkbox` mode records "ticked and ordered"; neither is said to be proof of consent to anything beyond the terms | this spec | |

### 4.3 Accessibility

| Rule | Source | Read |
|---|---|---|
| E-commerce services are in scope of the European Accessibility Act ("services provided at a distance, through websites and mobile device-based services by electronic means and at the individual request of a consumer") | Directive (EU) 2019/882 Art. 2(2)(f) | https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32019L0882 (2026-10-03) |
| Providers comply with the service requirements of Annex I section III; they put information on how the service meets them in their general terms or an equivalent document (Art. 13, Annex V); applies to services provided to consumers after 28 June 2025 | same Arts. 4(1), 13, application date | same (2026-10-03). **The Annex V item list was not read in full** (the page truncated it): the foundation agent reads it from EUR-Lex before writing the generator's fields. |
| Microenterprises providing services are exempt from the Annex I section III requirements | same Art. 4(5) | same (2026-10-03) |
| The harmonised standard is EN 301 549 v4.1.1, which adopts WCAG 2.2; until the Commission cites it in the Official Journal the reference stays v3.2.1; once cited it gives a presumption of conformity | AccessibleEU | https://accessible-eu-centre.ec.europa.eu/content-corner/news/european-accessibility-standard-en-301-549-has-been-updated-2026-09-07_en (2026-10-03) |
| Kaizen builds to WCAG 2.2 AA | `docs/decisions.md` D11; `docs/plan.md` | repo |
| **Enforcement bodies** (data, `ENFORCEMENT_BODIES` in `src/lib/a11y-statement.ts`, each with `source`, `checkedOn`, `verified`) | below | below |

`ENFORCEMENT_BODIES` starts with these entries, **all `verified: false`** and printed with "check with the authority"; the reviewer sets
`verified` when they have read the authority's own page:

| Country | Body named | Source and how it was read |
|---|---|---|
| NO | Digitaliseringsdirektoratet's UU-tilsynet (supervises the ICT-solutions regulation under the equality and anti-discrimination act). Whether and how Norway has taken in the EAA is **not confirmed**: the statement says "The rules that apply to you in Norway: check with Digdir." | a search result summarising uutilsynet.no, 2026-10-03; the authority's page (`uutilsynet.no/regelverk/ikt-lovene/…`) returned 404 |
| SE | Post- och telestyrelsen (PTS), which opened its first market inspections of e-commerce services from October 2025 | https://www.lflegal.com/lf-country/european-accessibility-act-eaa-enforcement-and-implementation/ (secondary source), 2026-10-03; PTS's own page could not be read (blocked) |
| DK | Erhvervsstyrelsen ("Herudover håndhæver og administrerer vi tilgængelighedsloven"); a search result also names Sikkerhedsstyrelsen for supervision from July 2025 | https://erhvervsstyrelsen.dk/om-markedsovervaagning (2026-10-03: the page says it enforces the accessibility act but not that it covers webshops); the second name is from a search summary |
| any other EU country | "the national market surveillance authority for accessibility; see the list kept by the European Commission" | no list read |

Checker thresholds (2.2) use WCAG's 4.5:1 for all text (the size is unknown to the checker, so it is the stricter figure); `alt_long` at 125
characters is a convention, not a WCAG rule. The CI scan uses axe-core's tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` (axe-core
4.13.0, already in `pnpm-lock.yaml` through `eslint-plugin-jsx-a11y`, contains the `wcag22aa` tag) and fails on impact `serious` or
`critical`. An automated scan finds only part of the problems; the generator and the docs say so.

### 4.4 PCI and the Content-Security-Policy

| Fact | Source | Read |
|---|---|---|
| The revised SAQ A (effective 31 March 2025) removed PCI DSS requirements 6.4.3 and 11.6.1 from SAQ A and added the eligibility criterion that the merchant "confirm their site is not susceptible to attacks from scripts that could affect the merchant's e-commerce system(s)"; "the underlying PCI DSS requirements themselves remain in effect" | PCI SSC blog, 30 Jan 2025 | https://blog.pcisecuritystandards.org/important-updates-announced-for-merchants-validating-to-self-assessment-questionnaire-a (2026-10-03) |
| A merchant using a low-risk integration (card data goes from the browser to Stripe, not through the merchant's servers) avoids most controls; "including JavaScript from other sites makes your security dependent on theirs … we recommend trying to minimize it"; each business attests annually | Stripe integration security guide | https://docs.stripe.com/security/guide (2026-10-03) |
| **Stripe's CSP directives** — Stripe.js: `connect-src https://api.stripe.com`; `frame-src https://*.js.stripe.com https://js.stripe.com https://hooks.stripe.com`; `script-src https://*.js.stripe.com https://js.stripe.com`. Checkout: `connect-src`, `frame-src` and `script-src` `https://checkout.stripe.com`, `img-src https://*.stripe.com`. Link: `frame-src`, `connect-src` `https://link.com https://*.link.com`, `img-src https://*.link.com`. Redirect payment methods need `hooks.stripe.com` in `frame-src`. Cross-origin isolation is not supported | same page | 2026-10-03 |
| Nonces need dynamic rendering; "Partial Prerendering (PPR) is incompatible with nonce-based CSP since static shell scripts won't have access to the nonce"; without nonces the header is set in `next.config`; an experimental hash-based option (`experimental.sri`) keeps static generation | Next.js guide in `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md` | repo, 2026-10-03 |
| Whether Kaizen, as the platform, has its own PCI obligations (service provider status) | PCI SSC | **not read**: a question for the company (section 9) |

**The policy** (`src/lib/csp.ts`, `checkoutCsp(env)`, pure, one function; sent by `headers()` in `next.config.ts` for the pay routes of every
store, on both address shapes and every market token):

| Directive | Value | Why |
|---|---|---|
| `default-src` | `'self'` | |
| `script-src` | `'self' 'unsafe-inline' https://js.stripe.com https://*.js.stripe.com https://checkout.stripe.com https://maps.googleapis.com` | the prerendered shell has inline bootstrap scripts that carry no nonce (below) |
| `style-src` | `'self' 'unsafe-inline'` | theme variables, React `style=` attributes |
| `img-src` | `'self' data: blob: https://*.stripe.com https://*.link.com {storage host}` | `{storage host}` is the host of `NEXT_PUBLIC_SUPABASE_URL` (pictures, logos) |
| `font-src` | `'self'` | fonts are self-hosted (D59) |
| `connect-src` | `'self' https://api.stripe.com https://checkout.stripe.com https://link.com https://*.link.com https://maps.googleapis.com` | server actions and the app's own `/api` |
| `frame-src` | `https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com https://checkout.stripe.com https://link.com https://*.link.com` | the payment form, 3-D Secure, Link |
| `media-src` | `'self' {storage host}` | uploaded videos |
| `object-src` | `'none'` | |
| `base-uri` | `'self'` | |
| `form-action` | `'self'` | |
| `frame-ancestors` | `'none'` | |
| `upgrade-insecure-requests` | only where `VERCEL` is set | it would break `http://localhost` (the e2e server) |

**`unsafe-eval` is never present.** Honest strength: with `'unsafe-inline'` in `script-src` the policy stops **any script from another
origin** (the SAQ A worry: tag managers, chat and owner scripts) but does not stop an injected inline script; the protection against that is
that these routes draw no owner code and no owner HTML (2.5), React escapes text, and `frame-ancestors`, `form-action` and `base-uri` are
shut. The foundation agent **first tries the stricter forms** in this order and keeps the strictest one that passes the e2e below,
writing which one and why in `docs/pci.md`: (1) `experimental.sri` with `script-src 'self' <stripe hosts>` and no `'unsafe-inline'`;
(2) the table above. A nonce is not an option on the static shell. The e2e load of `/s/demo/no/cart` must report **no
`securitypolicyviolation`** events (a listener test), so a policy that breaks the shell fails before it ships.

`src/lib/csp.ts` also exports `CSP_ENFORCE` (a constant, `true`): setting it to `false` sends the same policy as
`Content-Security-Policy-Report-Only`, the one-line fallback if a live Stripe session turns out to need something the docs did not list.
Extra headers on the same routes: `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`.

**`docs/pci.md`** (written by the foundation agent) records: the SAQ A criteria as read above, the policy and why each directive, which
mode (SRI or `'unsafe-inline'`) was chosen, the list of what is and is not on pay routes, the runbook (a Stripe origin missing from the
policy: what a broken form looks like and the one-line fallback), and what the company must do (the attestation itself).

### 4.5 Two-step sign-in

| Rule | Value | Source |
|---|---|---|
| Factor type | TOTP only (authenticator app). Phone (SMS) is not used: it sends numbers to a messaging provider outside the EU data rule | frame default; Supabase `mfa.enroll` |
| Assurance | `aal2` means a conventional sign-in plus a second factor; verifying a factor promotes the current session and **ends the person's other sessions** | Supabase docs https://supabase.com/docs/guides/auth/auth-mfa and `@supabase/auth-js` 2.117.1 types (read 2026-10-03) |
| Unenrolling a verified factor needs an `aal2` session; an admin can delete a user's factor (`auth.admin.mfa.deleteFactor`, typed `@experimental`, ends the user's sessions if the factor was verified) | auth-js 2.117.1 types | read 2026-10-03; the fallback if the typed call changes is the Auth server's admin `DELETE /auth/v1/admin/users/{id}/factors/{factorId}` |
| The admin client uses `SUPABASE_SECRET_KEY` (already in `.env.example` for Storage); `supabaseKeyKind()` refuses a publishable key | repo | |
| Native recovery codes and WebAuthn exist in the client only as experimental; the docs pages say "TOTP only" and "Supabase does not return recovery codes" | https://supabase.com/docs/guides/platform/multi-factor-authentication; GitHub PR supabase/supabase-js#2676 | read 2026-10-03 |
| **Recovery codes**: 10 per set; 10 characters of Crockford base-32 (50 bits) shown as `XXXXX-XXXXX`; checked case- and separator-insensitively; stored as HMAC-SHA256; single use by one `update … where used_at is null returning`; a new set revokes the old; at most 5 failed second-step or recovery attempts per account in 15 minutes, counted from `account.two_step_failed` entries | this spec | |
| The kill switch `ADMIN_TWO_STEP=off` | env, default on; audit-logged | this spec |

### 4.6 Permissions

| Rule | Value |
|---|---|
| Keys | `{orders,products,customers,marketing,analytics,website,bookings,settings,billing,staff}:{read,write}` plus `owner` (not grantable). 21 keys; **18 grantable** (not `staff:write`, `billing:write`, `owner`) |
| Implication | `write` ⇒ `read` (normalised when a role is saved and again in `can()`) |
| Area of a page | `sectionOf(path)`'s section key (`orders`…`settings`, `analytics`, `website`, `bookings`), except `/staff…` → `staff`, `/billing` → `billing`; a store page with no section and no override is Home's: membership only |
| Owner-only pages | those with `needs: "owner"` in `ADMIN_PAGES` need the `owner` key |
| `admin` default set | every `read` and `write` of the eight working areas, `staff:read`, `billing:read` |
| Collaborator cap | a collaborator never holds `staff:*`, `billing:*` or `owner`, whatever the role |
| Expiry | `expires_at <= now()` ⇒ not a member (`getMembership` filters it); the daily job writes `disabled_at` and the audit entry |
| Server actions | `checkPermission(slug, key)` with the area's `write`; GET routes `read`; the key is the page's area, a test compares |

### 4.7 The audit log

`AUDIT_AREAS` (pure, `src/lib/audit.ts`): **exact-action overrides first, then the prefix**. Areas: `orders`, `products`, `customers`,
`marketing`, `analytics`, `website`, `bookings`, `settings`, `billing`, `staff`, `platform`, `account`. The principal prefixes:

| Area | Prefixes |
|---|---|
| orders | `order.`, `return.`, `booking.`, `deliveries.`, `shipping.*_booked` |
| products | `product.`, `product_layout.`, `products.` |
| customers | `customer.`, `tier.`, and `company.created/deleted/main_account` (B2B company accounts) |
| marketing | `discount.`, `campaign.`, `cart_reminders.`, `recommendations.`, `experiment.`, `search_test.`, `store.bonus_settings`, `store.affiliate_settings` |
| analytics | `analytics.` |
| website | `page.`, `article.`, `header.`, `footer.`, `field_group.`, `term.`, `store.front_page_changed`, `store.products_page_changed`, `store.page_role_changed`, `store.legal_role_changed`, `store.theme_*`, `store.menu_*`, `store.navigation_updated`, `store.css_saved`, `store.media_*`, `store.saved_theme_*`, `store.template_*`, `store.ai_translated`, `store.page_replicat*` |
| bookings | `booking_resource.`, `resource_block.`, `calendar_feed.`, `host.`, `bookings.` |
| billing | `billing.` |
| staff | `staff.`, `role.`, `store.two_step_*`, and the per-store copies of `account.two_step_*` and `account.recovery_*` |
| platform | `platform.`, `language.`, `ai.platform_*`, `google.platform_*` |
| account | `account.` (store null) |
| settings | everything else (`payments.`, `shipping.updated`, `returns.`, `company.updated/office_saved/place_*`, `store.*`, `ai.`, `integration.`, `localization.`, `cookies.`, `chat.`, `knowledge.`, `google.`, `work.`, `store.terms_mode_changed`, …) |

Pure helpers: `areaOfAction(action)`, `summaryOf(action, target, changes)` (the sentence), `diffOf(kind, before, after)` (the allowlisted
`changes`), `ALLOWED_FIELDS: Record<AuditKind, readonly string[]>`, `AUDIT_RETENTION_MONTHS = 24`.

---

## 5. Where things live

Order of work: **foundation** (schema, migrations, pure libraries, guards' skeleton, policy, docs) → **server** (guards, jobs, actions'
cores) → **shopper, admin and analytics-and-ai in parallel**. The areas below share no file except through the registries in 5.6, each
edited by one area only. All paths are in `/home/user/kaizen-trust` (the worktree); nothing is committed by the agents.

### 5.1 Foundation

| File | What |
|---|---|
| `src/db/schema.ts` | the tables and columns of section 3 (`legalSnapshots`, `orderTerms`, `accessibilitySettings`, `accountRecoveryCodes`, `storeRoles`, additions to `stores`, `accounts`, `storeMembers`, `auditLog`, the `page_roles` check) |
| `supabase/migrations/*` | `legal_terms` (schema) and `legal_terms_rules` (triggers, `experiments_guard`), `staff_security` and `staff_security_rules` (triggers, `guard_audit_log`, the backfill): generated, then custom. Small files, so the tool can apply them in parts |
| `src/db/commerce.test.ts` | PGlite tests of every rule in 3.3 (immutability, checks, the owner trigger kept, audit prune boundary at 24 months, collaborator checks, role restrict key, copied order refuses `order_terms`) |
| `src/lib/store-copy-rules.ts` | the four classifications of 3.5 |
| `src/lib/legal-roles.ts` | `LEGAL_ROLES`, `LEGAL_ROLE_COPY`, `isLegalRole()` |
| `src/lib/legal-facts.ts` | the `LegalFacts` type and its pure assembly from a store, shipping settings, return settings, carriers' names, flags |
| `src/lib/legal-starters.ts`, `src/lib/legal-starters/{nb,sv,da,en}.ts` | `legalStarter(kind, lang, facts, id)`, `REQUIRED_TOPICS`, `LEGAL_REVIEW_MANIFEST`; hand-written texts |
| `src/lib/checkout-terms.ts` | modes, `termsSentence()`, snapshot hash (`snapshotHash()`), the pure state of the acceptance |
| `src/lib/page-a11y.ts` | `pageIssues()` and its rules (2.2) |
| `src/lib/a11y-statement.ts`, `src/lib/a11y-statement-text.ts` | statement builder, `ENFORCEMENT_BODIES`, the four languages' text |
| `src/lib/csp.ts`, `src/lib/pay-routes.ts` | `checkoutCsp()`, `CSP_ENFORCE`, `isPayPath()`, the forbidden-module list |
| `next.config.ts` | a `headers()` entry for the pay-route sources (`/s/:store/:market/(cart\|checkout\|order)…` and the own-host shape `/:market/(cart\|checkout\|order)…`); the existing keys untouched |
| `src/lib/permissions.ts` | keys, `AREAS`, `OWNER_HELD`, `ADMIN_DEFAULT`, `can(member, key)`, `permissionOfPath()`, `normalisePermissions()`, role templates |
| `src/lib/two-step.ts`, `src/lib/recovery-codes.ts` | `assuranceOf()` (the decision matrix), limits, the code format, normalisation, `formatCodes()`; hashing is server |
| `src/lib/audit.ts` | `AUDIT_AREAS`, `areaOfAction()`, `diffOf()`, `ALLOWED_FIELDS`, `summaryOf()`, `AUDIT_RETENTION_MONTHS` |
| `src/lib/permissions.baseline.json` + the one-off script that writes it (`scripts/permission-baseline.mjs`) | the oracle of 2.7.2, written **before** the sweep |
| `docs/pci.md` | 4.4's contents |
| `package.json`, `pnpm-lock.yaml` | `@axe-core/playwright` as a dev dependency (it resolves to the `axe-core@4.13.0` already in the lock; if the install cannot reach the network, fall back to `axe-core` as the dev dependency with `page.addScriptTag`, and say so in the report) |
| `.env.example` | `ADMIN_TWO_STEP=` with its explanation |

### 5.2 Server

| File | What |
|---|---|
| `src/server/auth.ts` | `getAccount()` fail-closed, `getSessionAccount()`, `getMembership()` with role, kind, expiry and permissions, `requireMember` kept as internal; `audit()` gains its optional fifth argument (the 224 callers are untouched) |
| `src/server/permissions.ts` | `requirePermission`, `checkPermission`, `requireOwnerRole`, `requireMemberAny`, `GUARDS`, `DELEGATED_GUARDS` |
| `src/server/two-step.ts` | enrol (start, verify), challenge, recovery-code use (admin client), regenerate, remove, platform reset, the failure counter, `assuranceOfSession()` (claims + one `getUser()` for `aal1`), the mirror update |
| `src/server/recovery-codes.ts` | generation, HMAC, single-use claim |
| `src/server/security-emails.ts`, `src/lib/security-emails.ts` | the English emails (recovery code used, two-step removed or reset); pure text in `lib`, sending in `server` through `sendEmail()` with an idempotency key `security.{event}:{account}:{at}` |
| `src/server/store-roles.ts` | `ensureStoreRoles()`, list, create, update, delete, assign; collaborator invite, extend, end |
| `src/server/audit.ts` | `auditChange()`, `auditAccount()` (the store-null row plus one per store membership), `listActivity()`, `exportActivity()` |
| `src/server/activity.ts` | the activity queries (filters, cursor, visibility by permission) |
| `src/server/legal-facts.ts` | `legalFacts(store)`, `taxFactsOf()` (the hook, null here) |
| `src/server/legal-starters.ts` | `createLegalStarter(member, kind)`, status per kind, `setLegalRole` (through `setPageRole`) |
| `src/server/checkout-terms.ts` | `recordTermsAcceptance()` (find the open checkout from the cart cookie, snapshot, write), `termsForOrder()`, `snapshotForOrder()` |
| `src/server/accessibility.ts` | settings read and write, the facts the statement needs, `createStatementDraft()` |
| `src/server/security-jobs.ts` | `endExpiredCollaborators(now)`, `pruneAuditLog(now)`, `pruneRecoveryCodes(now)`; called from the existing `/api/cron/subscription-reminders` (one line in its `Promise.all`) |
| `src/server/pages.ts`, `src/server/page-rules.ts` | `savePage()` runs `pageIssues()`, returns `needs_confirmation`, takes `acknowledgedIssues`, writes the audit entries; `pageRulesProblem()` gets `pay_page_block`; `setPageRole()` widened (3.1) |
| `src/server/seo.ts` | `listPublicStores().role_pages` excludes legal roles (3.1) |
| `src/server/products.ts` | `saveProduct()` writes `product.created/updated/archived` and one `product.price_changed` per price change (additive, after the transaction) |
| `src/server/discounts.ts`, `src/server/settings.ts` (shipping, staff, payments) | `auditChange` calls (before/after) |
| `src/server/experiment-admin.ts` | refuses a legal page as a target |

### 5.3 Shopper

| File | What |
|---|---|
| `src/app/s/[store]/[market]/layout.tsx`, `extras.tsx`, `src/components/off-pay-routes.tsx` | the extras (`StoreChat`, `SiteConsent`, `StoreAffiliate`, `BuyerQuestion`) move into `extras.tsx` (`MarketExtras`, the only file that imports them) and the layout draws them inside `<OffPayRoutes>`, which draws nothing on the cart, checkout and order (finding 8: the first design, a parallel slot `@extras`, remounted them on every navigation and was dropped) |
| `src/components/pay-route-guard.tsx` | `PayDocumentWatcher` (in the layout) and `PayRouteGuard` (on the three pages), 2.5 |
| `src/components/checkout-button.tsx`, `src/app/s/[store]/[market]/cart/cart-contents.tsx`, the drawer | entries into `/checkout` become full navigations |
| `src/components/checkout-terms.tsx`, `src/components/terms-choice.ts` | the sentence, the checkbox, the in-memory choice; `CheckoutForm` reads the choice and calls the action before `confirm()` |
| `src/app/s/[store]/[market]/checkout/terms-actions.ts` | the server action bound to the store and market |
| `src/app/s/[store]/[market]/checkout/checkout-section.tsx` | draws the piece; `CheckoutPayment` draws it itself when the page has no `checkout_terms` block |
| `src/app/s/[store]/[market]/order/[orderId]/order-section.tsx` and `…/terms/[role]/page.tsx` | the *Terms you accepted* piece and the read-only snapshot page |
| `src/components/store-layout.tsx` | `StoreFooter` lists the published legal pages (`nav aria-label="Legal"`) |
| `src/lib/store-parts.ts`, `src/components/store-part-section.tsx`, `src/lib/page-roles.ts` (`starterPage`) | the two new pieces `checkout_terms` and `order_terms` (a key in `STORE_PIECES`, a case in `StorePartSection`, a place in the starter) |
| `src/lib/i18n.ts` | `m.terms.*` (the sentence in its four forms, the checkbox, the order block, the footer's *Legal* label) in nb, sv, da, en |
| `e2e/csp.spec.ts`, `e2e/a11y.spec.ts`, `e2e/a11y.ts`, `e2e/fixtures/a11y-bad.html`, `e2e/legal-pages.spec.ts` | 6.1 |

### 5.4 Admin

| File | What |
|---|---|
| `src/app/admin/sign-in/two-step/page.tsx`, `set-up/page.tsx`, `recovery/page.tsx`, `actions.ts` | the challenge, the forced enrolment and the recovery-code page (outside the gated area) |
| `src/app/admin/sign-in/actions.ts`, `src/app/auth/callback/route.ts`, `src/app/auth/confirm/route.ts` | end at the two-step page when enrolled |
| `src/app/admin/(gated)/layout.tsx` | `Gate` chooses the held page (2.8) |
| `src/app/admin/(gated)/(owner)/account/page.tsx` and actions | the *Two-step sign-in* section |
| `src/components/admin/two-step-panel.tsx`, `recovery-codes-view.tsx` | the QR and code form, the codes with copy and print |
| `src/app/admin/(gated)/[store]/staff/page.tsx`, `roles/page.tsx`, actions | members with role, two-step status, collaborator badge and end date, invite as staff or collaborator, the *Require two-step* switch, roles list and editor |
| `src/components/admin/role-editor.tsx` | the area × (none, view, change) matrix |
| `src/app/admin/(gated)/[store]/activity/page.tsx`, `export/route.ts`; `platform/activity/page.tsx` | 2.9; `src/components/admin/activity-view.tsx` |
| `src/app/admin/(gated)/[store]/orders/[orderId]/page.tsx` | an additive *Terms accepted* block (staff see the snapshot, 2.4); the money lane edits this page too |
| `src/app/admin/(gated)/platform/customers/[accountId]/page.tsx` | *Remove two-step* for a platform admin to press |
| `src/app/admin/(gated)/[store]/settings/legal/page.tsx` and actions; `settings/accessibility/page.tsx` and actions | 2.1 and 2.3; `src/components/admin/legal-pages-panel.tsx`, `a11y-statement-form.tsx` |
| `src/components/admin/page-builder.tsx`, `page-editor.tsx`, `page-issues-panel.tsx` | the *Checks* tab, the publish dialog |
| `src/lib/store-nav.ts` | `item("/settings/legal", "Legal pages", …)` in Settings → Selling; `item("/settings/accessibility", "Accessibility", …)` in Site; `item("/activity", "Activity log", …)` in Account; `storeSections(flags, can)` and the area filter |
| `src/lib/admin-map.ts` | the new pages (`legal`, `accessibility`, `activity`, `staff.roles`) with their `needs`; `pageOffered` takes the member's permissions |
| `src/lib/platform-nav.ts` | `item("/activity", "Activity log", …)` in `SETTINGS_ITEMS`; `admin-map.ts` `platform("activity", …)` |
| `src/lib/store-translate.ts` | `isLegalPage` change (3.1) |
| the **permission sweep** (2.7.2) of every store admin page, action, route and helper **not listed in 5.5** | including `(owner)/account/work/s/[store]/**` and the components under `src/components/admin/**` that call a guard |

**As built by the admin surface (deviations and additions, each keeping its intent):**

| Spec says | Built | Why |
|---|---|---|
| Component tests `*.test.tsx` | `*.test.ts` with `createElement` + `renderToString` (`two-step-panel.test.ts`, `team-and-roles.test.ts`, `activity-and-legal.test.ts`, `theme-editor-warnings.test.ts`) | `vitest.config.ts` includes `src/**/*.test.ts` only |
| The activity log needs membership only | `MEMBERSHIP_ONLY_PAGE_IDS` gains `activity`, and `permissionOfPath()` returns null for it (`permissions.test.ts` expects it) | the page narrows what a member sees by their readable areas itself (`listActivity()`); the nav shows it to every role |
| `storeSections(flags, can)` | `storeSections(flags, canOpen?: (path) => boolean)`, with the same optional argument on `storeTabs()` and `storeAreas()`; the predicate is `canOpenPath(holder, path)` in `permissions.ts` (store-nav cannot import it: permissions reads store-nav) | a section or group with nothing a member can open is not drawn, hub cards included (`settings/page.tsx`, `website/page.tsx`) |
| `pageOffered` takes the member's permissions | `SiteFlags.canOpen?: (page: AdminPage) => boolean`, checked first by `pageOffered()`; the assistant's tools pass it (analytics-and-ai) | admin-map cannot import permissions either |
| The Checks tab | The builder's left sidebar gets a fifth tab through `PageBuilder`'s `checks` prop (`{ count, panel }`), drawn by `PageIssuesPanel`; rows, columns and blocks carry `data-builder-id` so "Show it" scrolls to and focuses them; `PageOwnerContext.check` (`{ theme, checkoutPageId }`) feeds the checker the theme's colours and the checkout page; `actions.save` takes a fourth argument `acknowledged` and `PageSaveState` carries `code` and `issues` | needed to carry `needs_confirmation` to the dialog (`PublishWithIssuesDialog`) |
| A staff view of the terms on the order page | `OrderTermsCard` on the order page, and a read-only admin page `/admin/{store}/orders/{orderId}/terms/{role}` (`ADMIN_PAGES` id `order.terms`, `orders:read`) showing the snapshot's plain text, version and mode | staff need the kept copy, not only the shopper's `?session_id=` page |
| Platform activity log | `listPlatformActivity()` and `platformActivityFilters()` appended to `src/server/activity.ts` (`store_id is null` in every condition; days in UTC) | the store's `listActivity()` is per member |
| Set-up page redirects an `aal2` session away | It does not: `EnrolPanel` gets `alreadyOn` and shows a note only while it has nothing else to show | enrolling promotes the session and a server action that sets cookies draws the page again; a redirect would take the recovery codes away unread |
| `inviteStaffAction`/`disableStaffAction` in `(gated)/actions.ts` | Removed there; the Team page's actions are in `[store]/staff/actions.ts` (`checkOwnerRole`) | the old ones compared `role` with `"owner"` |

### 5.5 Analytics and AI

| File | What |
|---|---|
| `src/lib/owner-tool-permissions.ts` | `TOOL_PERMISSIONS` (exhaustive over `OwnerToolName`) |
| `src/server/owner-tools.ts` (`runOwnerTool`), `src/server/owner-assistant.ts`, `src/server/manager-tools.ts` (`find_pages`, `open_page`) | the permission check; offered pages follow what the member can open |
| `src/server/store-mcp.ts` | the `aal` check of 2.7.3 |
| the **permission sweep** of | `[store]/analytics/**`, `assistant/**`, `chat/**`, `recommendations/**`, `experiments/**`, `settings/ai/**`, `translate/**`, `pages/ai/**` (the replicate routes), and their helpers `src/server/analytics-context.ts`, `experiment-admin.ts`, `replicate-route.ts`, `assistant-route.ts` |
| `src/server/owner-tool-permissions.int.test.ts`, `src/lib/owner-tool-permissions.test.ts`, `src/server/store-mcp.int.test.ts` | 6.1 |

### 5.6 The registries, and who edits each

| Registry | Edited by | Edit |
|---|---|---|
| `src/db/schema.ts`, `supabase/migrations`, `src/lib/store-copy-rules.ts`, `next.config.ts`, `package.json` | foundation | as in 5.1 |
| `src/lib/store-nav.ts`, `admin-map.ts`, `platform-nav.ts`, `store-translate.ts` | admin | as in 5.4 |
| `src/lib/i18n.ts`, `src/lib/store-parts.ts`, `src/lib/page-roles.ts` | shopper | as in 5.3 |
| `src/lib/email-text.ts` | nobody | staff emails are English in their own module (like `experiment-emails.ts`); the terms text is in `i18n.ts` |
| `KNOWN_COOKIES` | nobody | the terms tick is in memory and the second step uses Supabase's session cookies, which are already listed; a test asserts no new cookie or storage name appears in the new code |
| plan features (D132) | the lead | after deploy, from the platform editor: *Staff roles and permissions*, *Two-step sign-in*, *Activity log*, *Legal page starters*, *Accessibility checks* (a migration would have to guess plan ids) |
| owner tools | analytics-and-ai | `TOOL_PERMISSIONS`; no new tool is added by this wave |
| sitemap, structured data | server (`seo.ts`) | legal pages are ordinary pages in the sitemap and the page JSON-LD; nothing new in structured data |
| `COPY_RULES` | foundation | the four classes of 3.5 |
| `docs/decisions.md`, `CLAUDE.md`, `docs/parity/rows` | the lead | section 9 |


---

## 6. Acceptance, row by row

Test kinds: **U** unit (`pnpm test`), **P** PGlite (`src/db/commerce.test.ts`), **I** integration against a database (`pnpm test:int`),
**E** end-to-end (`PORT=3100 pnpm test:e2e`), **M** manual, recorded by the lead. A row closes only when its listed tests exist and pass.

### 6.1 Criteria mapped to tests

**`international.legal-page-templates-and-policy-generator`**

| Criterion | Held by |
|---|---|
| Starters for privacy, terms, shipping, returns, withdrawal information and an imprint in nb, sv, da, en, filled from the business details and settings | **U** `legal-starters.test.ts`: 7 kinds × 4 languages build; each fact appears (name, number, address, email, each market's rate, return window, who pays); a missing fact gives `[[Add: …]]`; `REQUIRED_TOPICS` all present per language; no ODR address; no unresolved template braces. **I** `legal-starters.int.test.ts`: the facts are read from the database (legal name, shipping rates, return settings, carriers, flags); main language chosen; other languages among the four written into `translations`; a main language outside the four gives English and the extended notice |
| Hand-written, marked draft, visible notice, none machine-translated | **U** the first row of every starter carries `legal-review-notice`; an import scan fails if `src/lib/legal-starters/**` imports an AI or catalogue module; `LEGAL_REVIEW_MANIFEST` equals the files (so section 8 stays true); the starter keys are absent from `ui-catalog` |
| Checkout shows a terms and privacy link, or a required checkbox, pointing to the chosen pages, and records the acceptance on the order | **U** `checkout-terms.test.ts` (the three modes, one page or two, none; the sentence), `checkout-terms.test.tsx` (render: link, checkbox required, pay disabled until ticked, `aria-describedby`; drawn once whether the page has the piece or not). **I** `checkout-terms.int.test.ts`: acceptance written once per order (a second call writes nothing), the snapshots are of the localised published pages and deduplicate by hash, a changed page makes a new snapshot, a host order records, a copied order refuses, another store's order is never found, a shopper cannot record for a cart that is not theirs. **P** immutability and the copied-order trigger |
| A starter is never published automatically and is out of the sitemap until published | **I** after `createLegalStarter` the page is a draft, absent from `listPublishedPages()` and from the sitemap data, present after publishing; `setPageRole` refuses a draft; a legal page is served at its own address (the role does not redirect it) and an A/B test on it is refused. **E** `legal-pages.spec.ts`: a seeded published page with a legal role is at its address and in `store-sitemap.xml`, a draft one is not |

**`international.accessibility-wcag-eaa-and-statement`**

| Criterion | Held by |
|---|---|
| CI runs an automated WCAG check over the main storefront pages and admin entry pages and fails on serious violations | **E** `a11y.spec.ts`: front, product, cart (with an item), order (a seeded paid order opened by its key), account signed out, withdraw, light and dark; admin: sign-in, forgot-password, sign-up; impact `serious` or `critical` fails. `e2e/fixtures/a11y-bad.html` is scanned by the same helper in a test that **expects** violations, so the check provably fails. See criteria changes 6.2 |
| A statement from a template in nb, sv, da, en, marked as needing review | **U** `a11y-statement.test.ts`: default status "not assessed"; `full` without an assessor and date is refused; each language; the enforcement body per country with its `verified` flag; the facts included; the microenterprise sentence only when ticked. **I** `accessibility.int.test.ts`: the draft page is made, unpublished, with the notice; facts read from the site (theme warnings, alt-text share, checker issues) |
| Theme settings that fail AA are refused or flagged | **U** existing `theme.test.ts`, plus a render test that the theme editor lists `themeWarnings()` output |
| An independent audit result | outside the row; never counted |

**`storefront.accessibility-and-theme-quality-guarantees`**

| Criterion | Held by |
|---|---|
| Automated WCAG check in CI on front, product, cart, checkout, account in light and dark | **E** `a11y.spec.ts` as above; the checkout is scanned in the states reachable without Stripe (the redirect to the cart, the checkout section's non-payment parts rendered in a unit fixture); the Stripe form itself is **M** (an axe run on a test-mode checkout, recorded in `docs/pci.md`) |
| The builder lists draft issues with a link to the block | **U** `page-a11y.test.ts` (each rule, positive and negative, severities, `heading_order` across rows and rich text, contrast with and without theme), `page-issues-panel.test.tsx` (each issue links to its block id) |
| Publishing with an unresolved blocking issue warns and records the choice | **I** `pages.int.test.ts` additions: `needs_confirmation` without acknowledgement and nothing published; with it, published and `page.published_with_issues` written with the rule counts; a draft save is never held |
| A statement from facts the site holds, flagged for review | as the statement row |

**`international.pci-dss`**

| Criterion | Held by |
|---|---|
| Card details only in Stripe's form; no Kaizen route receives, logs or stores a card number, expiry or code | **U** `no-card-fields.test.ts` scans `src/app` and `src/components` for card inputs (`cc-number`, `cc-csc`, `cc-exp`, `name="card…"`) and for routes reading such fields; existing **I** `checkout-stripe.int.test.ts` |
| Direct charges on the store's connected account | existing `checkout-stripe.int.test.ts` (`stripeAccount` on every call) |
| A strict CSP on checkout, order and cart routes | **U** `csp.test.ts` (no `unsafe-eval`, no bare `*` in `script-src`, exact Stripe hosts, `object-src 'none'`, `frame-ancestors 'none'`, the storage host from the env, `upgrade-insecure-requests` only on Vercel, report-only when `CSP_ENFORCE` is false), `next-config-headers.test.ts` (the sources match `/s/x/no/checkout`, `/no/checkout`, `/no~abc/order/123`, and not `/s/x/no`). **E** `csp.spec.ts`: the header on `/s/demo/no/cart`, `/checkout` and an order address, absent on the front page; the cart loads with **no** `securitypolicyviolation` event |
| `liveCustomCode()`, `ConsentManager` and the chat widget are not drawn on checkout routes and a test fails if a checkout route imports them | **U** `pay-routes.test.ts`: the import graph of the market layout and of `checkout`, `cart`, `order` (and their section files) contains none of `site-consent`, `consent-manager`, `store-custom-code`, `custom-code`, `site-chat`, `chat-widget`, `store-affiliate`, `buyer`; `OffPayRoutes` draws nothing on a pay path (`off-pay-routes.test.ts`) and the layout draws the extras only inside it; `isPayPath()` table; `PayRouteGuard` reloads once when the loaded document is not a pay route; a scan finds no `<Link href=…/checkout>` and no `redirect(…/checkout)` outside the allowlist of full navigations; `page-rules.test.ts` refuses an `html` or embed-video block on the checkout page. **E** on `/s/demo/no/cart` there is no consent banner and no chat button, on `/s/demo/no` there is (with the chat agent and a tool switched on in the test store) |

**`international.staff-two-step-authentication`**

| Criterion | Held by |
|---|---|
| Enrol an authenticator with recovery codes from Your account; asked for the code at sign-in after the password or link | **U** `two-step.test.ts`: `assuranceOf()` over every combination (enrolled, `aal1`/`aal2`, required by platform or store, kill switch), code format, normalisation, the failure counter. **I** `two-step.int.test.ts` with an injected Supabase client: enrol and verify, codes shown once and hashed, sign-in ends at the challenge, a wrong code fails and is counted, the sixth attempt in 15 minutes is refused, the right code reaches `aal2`; `account-gate.int.test.ts`: `getAccount()` is null for an enrolled `aal1` session, the cookie's own `factors` edited away still holds (trusted source); every direct caller of `getAccount()` fails closed |
| An owner can require it for the store; a member without it is held at enrolment before the admin | **I** `getMembership()` is null and `requirePermission()` redirects with reason `enrol` for the held member, another store of the same person is not held, the owner cannot switch it on without their own factor and `aal2`, switching on and off is audited |
| Enrolling, removing a factor and a failed second step are audit-logged; recovery codes are single-use | **I** the audit rows (store null and per-store `staff` copies) for each event; a recovery code works once and the second use fails; using one calls the admin delete-factor with the account's factor ids, revokes the other codes, sends the email, and a missing secret key leaves the code unspent |
| Platform admins are required | **I** `requirePlatformAdmin()` holds a platform admin without `aal2` at enrolment; the kill switch lifts it and is audited |

**`international.staff-roles-and-permissions`**

| Criterion | Held by |
|---|---|
| An owner defines roles (at least orders, products, marketing, content, analytics, read-only) as per-section permissions and assigns one | **I** `store-roles.int.test.ts`: `ensureStoreRoles()` makes the six and is idempotent, create, edit, delete (refused while in use), assign, the normalisation of `write` ⇒ `read`, the ungrantable keys refused. **P** the checks and the restrict key. **U** `role-editor.test.tsx` |
| Every admin page and action checks the permission; refused with 404 or a refusal; the navigation hides what they cannot use | **U** `permissions.scan.test.ts` and `permissions.matrix.test.ts` (2.7.2), `permissions.test.ts` (`can()`, `permissionOfPath()` over every `ADMIN_PAGES` store page), `store-nav.test.ts` (sections, hubs and areas filtered). **I** for each area one action called by a member who holds only another area's keys is refused, and a view-only member's write is refused |
| The AI manager's tools and the store's MCP server respect the member's permissions | **U** `owner-tool-permissions.test.ts` (exhaustive; reads `:read`, changes and gated tools `:write`, owner-only pages `owner`); **I** `owner-tool-permissions.int.test.ts`: a synthetic principal without the key is refused, with it is served; `find_pages` omits pages the member cannot open; **I** `store-mcp.int.test.ts`: a token below `aal2` is refused for a store that requires two-step and for a platform admin |
| One active owner always; a role change is audit-logged | **P** existing owner test kept; **I** `role.created/updated/deleted` and `staff.role_assigned` rows with before and after |

**`platform.staff-accounts-and-roles`**: criterion 1 as the roles row; criterion 2 **I** `collaborators.int.test.ts` (invite with role and expiry, the badge data, never owner and no `staff`/`billing` keys, access ends at `expires_at` through `getMembership`, `endExpiredCollaborators(now)` with a fixed clock writes `disabled_at` and the audit entry, extend and end early); criterion 3 as the two-step row (with the change below); criterion 4 as the activity-log row (by person, action and date, role changes included).

**`international.audit-log-of-admin-changes`**

| Criterion | Held by |
|---|---|
| An Activity log page by person, area and period, paged | **I** `activity.int.test.ts`: each filter and their combination, the action filter, cursor paging stable under new entries, visibility (owner all; others their readable areas and their own; `staff` needs `staff:read`), another store's entries never, platform entries not in a store's log. **U** `activity-view.test.tsx` |
| Product, price, page, discount, shipping, staff and payment changes write an entry with the account and the changed fields, never secrets | **I** `audit-coverage.int.test.ts`: each of the six writes (`saveProduct`, a price, `savePage`, discount, shipping, staff, payments) produces its entry with the allowlisted fields. **U** `audit.test.ts`: `diffOf` per kind, a secret-like key is refused, long values truncated, `areaOfAction` covers every `audit(` literal found by a scan, every `set_price` caller has its price entry |
| CSV for owners; staff see only what their role allows; another store's entries never appear | **I** `activity-export.int.test.ts`: owner only (others refused), period required, the 50,000 cap, formula-safe cells (`=`, `+`, `-`, `@`), the export is audited, no other store's rows |
| Entries cannot be edited or deleted through the app; kept for a stated period | **P** update refused except filling `area` once, delete refused under 24 months and allowed over; **I** `security-jobs.int.test.ts`: `pruneAuditLog(now)` removes what is older than 24 months and keeps the rest; the page states the period |

### 6.2 Criteria changes (the rows are not edited here)

1. **`platform.staff-accounts-and-roles`, criterion 3**: "(authenticator app or passkey)" becomes "(authenticator app)". The frame defers passkeys; Supabase's client now has an experimental WebAuthn factor but its public docs and platform page do not offer it (finding 5). Proposed text: *"A staff member can switch on two-step authentication (authenticator app), is asked for it at sign-in, and an owner can require it for the whole store."*
2. **`platform.staff-accounts-and-roles`, criterion 2**: "invited for a store by an agency's account" is ambiguous. Built: the **owner invites an agency's account** as a collaborator with a role and an expiry. Proposed text: *"An owner can invite an agency's account to the store as a collaborator with a limited role and an expiry; it shows as a collaborator in the staff list and loses access when it expires."*
3. **`international.accessibility-wcag-eaa-and-statement`, criterion 1** and **`storefront.accessibility-and-theme-quality-guarantees`, criterion 1**: CI has neither Stripe nor a signed-in admin, so "checkout, order, account and withdraw pages and admin entry pages" can only be scanned in these states: the checkout's reachable states, a seeded order, the account page signed out, the withdraw page, and the admin's sign-in, forgot-password and sign-up pages. Dark mode is scanned where the store's theme follows the device (the demo store's template does; the agent verifies). Proposed text for the first: *"CI runs an automated WCAG check over the storefront's front, product, cart, order, account (signed out) and withdraw pages, the checkout in the states reachable without a payment session, and the admin's signed-out entry pages, in light and dark where the theme allows, and fails on serious or critical violations. The payment form and signed-in admin screens are checked by hand and recorded."*
4. **`international.staff-roles-and-permissions`, criterion 3**: not a change of text but a limit: the assistant is owner-only, so "respect the signed-in member's permissions" cannot be observed in production until it is opened to staff; it is held with synthetic principals (6.1) and the assistant stays owner-only (section 7).
5. **`international.pci-dss`**: criterion 3 says "checkout, order and cart routes (test of the header)"; the header test cannot see a live Stripe session, so the lead's manual test-mode payment (section 9) is part of the evidence. No text change.
6. **Duplicate rows**: `platform.staff-accounts-and-roles` and `international.staff-roles-and-permissions` are one Shopify feature in two domains (`docs/parity/README.md` rule 8). The lead merges them: the survivor takes both rows' criteria (the platform row's collaborator and two-step criteria; the international row's roles, AI and MCP criteria), and keeps one weight.

---

## 7. Deliberately not done

| Not done | Why | Taken by |
|---|---|---|
| Passkeys as a second factor | the frame defers them; Supabase's client has an experimental WebAuthn factor, its docs do not offer it | a later wave, after section 9's question |
| Supabase's native recovery codes | experimental flag, docs say Supabase "does not return recovery codes"; our own codes are the frame's decision and work on any server version | revisit with passkeys |
| SMS second factor | sends staff phone numbers to a messaging provider; against the EU-data rule | not planned |
| Owners delegating `staff:write` or `billing:write` in a custom role | no-escalation rule (2.7) | a later wave if owners ask |
| Opening the AI manager to staff roles | the assistant has owner-only memory and approvals; the permission machinery is in place, the switch is not | wave 8 |
| Per-field or per-location permissions, approval flows | not in the row | wave 9 |
| Two-step required of hosts (D71) | hosts are outside people with their own area | later |
| Re-asking customers to accept changed terms; terms in an account sign-up | not in the row | wave 5 (customers) |
| A staff screen listing every version of a legal page | the snapshots exist; no browsing screen | later |
| Changing the pay button's wording | a lawyer question first (section 8) | after review |
| Attaching the terms to the order confirmation email | a lawyer question first; the lead adds the link line at merge | after review |
| Terms sentence and record for orders confirmed wholly at the venue (`confirmAtVenue()`, in `checkout.ts`) | the order never reaches the checkout page; the function belongs to the money lane | when the cart's button area gets the sentence |
| Axe over signed-in admin screens and the Stripe form in CI | no Supabase or Stripe session in CI | when a test Supabase user and a Stripe test session exist (needs a credential) |
| The independent accessibility audit; the SAQ A attestation | people and contracts (bucket D); never counted by code | the company |
| A nonce-based or strict-dynamic CSP | the static shell cannot carry a nonce | if the pay routes ever become dynamic |
| A CSP report endpoint | would collect URLs of shoppers' pages; the e2e violation listener and Report-Only fallback are enough for now | later |
| Legal texts for other languages, or for a country's specific statute | hand-written text is expensive and must be reviewed; other languages get English and a notice | the owner's lawyer |
| Subscription policy starter (Shopify has one) | the row's list does not name it | later |
| Audit of customer-facing or host actions, webhooks or streaming of the log | not in the row | wave 9 |

---

## 8. Needs human legal review

Every text below is hand-written and **unreviewed**. None is to be used for real until a person has read it; the parity rows that rest on
them are not Full until then (`docs/parity/WAVES.md` step 4).

| Text | Where | Languages |
|---|---|---|
| Terms of sale starter | `src/lib/legal-starters/{nb,sv,da,en}.ts` | nb, sv, da, en |
| Privacy statement starter | same | nb, sv, da, en |
| Returns policy starter | same | nb, sv, da, en |
| Shipping policy starter | same | nb, sv, da, en |
| Withdrawal information starter (with the model withdrawal form of CRD Annex I(B)) | same | nb, sv, da, en |
| Imprint starter | same | nb, sv, da, en |
| The review notice itself | same | nb, sv, da, en |
| Accessibility statement text, the enforcement-body lines and the microenterprise sentence | `src/lib/a11y-statement-text.ts`, `ENFORCEMENT_BODIES` | nb, sv, da, en |
| The checkout sentence ("By ordering you accept …"), the checkbox text and the *Terms you accepted* block | `src/lib/i18n.ts` (`m.terms`) | nb, sv, da, en (other languages from the catalogue, English first) |

Questions for the lawyer that the code cannot settle:

1. Is "Pay {amount}" (`checkoutLabels.pay`) a "corresponding unambiguous formulation" under CRD Art. 8(2), or must the button say it in words?
2. Is a link to the stored snapshot enough for the durable-medium duty of CRD Art. 8(7), or must the terms be attached to the confirmation email?
3. The guarantee periods, the consumer complaint bodies and the data protection authorities named in each country's starter (all placeholders now).
4. The Swedish and Danish national statutes the terms and withdrawal texts should name (only the Norwegian acts were read).
5. Whether Norway has taken in the EAA and who supervises private webshops there; which Danish body supervises webshops; the `ENFORCEMENT_BODIES` entries (all `verified: false`).
6. The Annex V information the statement must carry (not read in full this run) and whether the microenterprise sentence is acceptable as worded.
7. Whether Kaizen, as the platform, has PCI obligations of its own beyond each store's SAQ A.
8. The recipients and transfers the privacy starter names (the platform operator, Stripe, the email provider, carriers).

---

## 9. For the lead

### 9.1 Migrations expected

Five files, small, generated then custom, so the migration tool can take them in parts (the fifth, `store_role_templates`, is one `ADD COLUMN`):

| File (names are proposals) | Contents |
|---|---|
| `legal_terms` | `legal_snapshots`, `order_terms`, `accessibility_settings`, `stores.terms_at_checkout`; **`ALTER TABLE page_roles DROP CONSTRAINT page_roles_role` and the new check** (top-level DDL, as `category_tag_roles` did) |
| `legal_terms_rules` | `forbid_change` triggers on the two snapshot tables, the copied-order trigger, `experiments_guard()` re-created **from its live definition** with the legal-role refusal |
| `staff_security` | `accounts.two_step_since`, `stores.require_two_step`, `account_recovery_codes`, `store_roles`, `store_members` columns and keys, `audit_log` columns and indexes |
| `staff_security_rules` | the recovery-code trigger, the member checks, **`DROP TRIGGER audit_log_append_only`** and `CREATE FUNCTION commerce.guard_audit_log()` plus its trigger, the one top-level `UPDATE` backfilling `audit_log.area` |
| `store_role_templates` | `stores.role_templates_offered text[] not null default '{}'` |

- **Statements with `DELETE`, `DROP` or `TRUNCATE` inside a function: none** (the design keeps deletions in application code). Top-level
  `DROP TRIGGER` and `DROP CONSTRAINT` are the two drops; earlier migrations carried the same and applied. If the tool cancels either,
  the owner runs it from the SQL editor. If it cancels the `audit_log` backfill (one `UPDATE` over every row), run it by hand; the readers
  do not depend on it.
- **Drizzle meta**: both lanes generate migrations and snapshots from `schema.ts`. After merging the lanes, **re-run `pnpm db:generate`** and make
  `pnpm db:check` pass; give this lane's files later timestamps than the money lane's if the order matters (it does not between them).
- **Do not let a later migration re-create `clone_store()`, `duplicate_store()` from an older body** (3.5): this lane did not touch them.
- Apply each file once the tests pass, record its version in `docs/decisions.md` (Migration versions), then check the advisors.

### 9.2 Advisors to check

Security: the four new tables have RLS enabled with no policies (the same informational finding as every `commerce` table);
`guard_audit_log()` and the new trigger functions set `search_path`; nothing is exposed to the Data API. Performance: foreign-key indexes
exist for `legal_snapshots.store_id`, `order_terms.store_id`, `accessibility_settings.updated_by`, `store_roles.created_by`,
`store_members (store_id, role_id)`, `account_recovery_codes.account_id`, and the two new `audit_log` indexes; confirm none is reported
unindexed or unused-then-needed.

### 9.3 Before pushing (the things CI cannot prove)

1. **Supabase MFA**: in the project's Auth settings, TOTP enrol and verify are on (the docs say enabled by default). Without it the platform
   admin cannot enrol and, since two-step is required of them, is held. `ADMIN_TWO_STEP=off` in Vercel is the escape; set it only if needed.
2. **`SUPABASE_SECRET_KEY`** in Vercel is the secret key (`sb_secret_…`), not the publishable one: recovery codes and a platform reset need it
   (`/api/health` already reports the key's kind).
3. **A test-mode payment on a Vercel preview with the CSP enforced**, through to the order page, with an axe run on the checkout page
   (record the result in `docs/pci.md`). If something Stripe needs is missing from the policy, set `CSP_ENFORCE = false` (Report-Only) and
   fix the list; do not ship a broken checkout.
4. **Enrol the platform admin** (the owner) in production right after deploy and save the recovery codes: they will be held at enrolment on
   their first visit. This is the manual check the two-step row's `full` rests on.
5. Read the starters in at least nb and en once, and write the result in the parity rows' history.

### 9.4 Merge notes for the lead (the two lanes meet here)

- **The money lane's new admin pages and actions** (tax settings, invoices, the VAT reports and the like) call `requireMember()`; the scan test of
  2.7.2 fails on them until converted. The pattern is one line; keys: tax settings `settings:write` with `owner`, invoices and credit notes
  `orders:read` / `orders:write`, the VAT and OSS reports `analytics:read`, the VAT rates page is platform-level and unaffected.
- `taxFactsOf()` in `src/server/legal-facts.ts`: replace `return null` with a read of `commerce.store_tax_profile` (VAT number, registration).
- One line in the order confirmation email linking the order's *Terms you accepted* page (`email-text.ts`; kept out of this lane to avoid two
  lanes editing that file).
- The staff order page (`orders/[orderId]/page.tsx`) and the shopper's `order-section.tsx` get one additive block each; the money lane edits both.
- `saveProduct()` (the product editor lane edits it for VAT categories): this lane's audit calls are an additive block after the
  transaction; expect a textual conflict and keep both.
- `src/lib/i18n.ts`, `store-parts.ts`, `store-nav.ts`, `admin-map.ts`: this lane's edits are additive blocks; the money lane edits the same files.
- Plan features (D132): add the five rows listed in 5.6 from the platform editor.
- Rows: merge the two staff rows (6.2 item 6); ratings as in section 1.1; `docs/shopify-parity.md` via `pnpm parity:write`.

### 9.5 Draft decision rows

*(The wave's spec is D156; renumber to the next free numbers when the money lane has taken its own.)*

**D1xx (1e)**, 2026-10-03: **Legal starters, terms at checkout, accessibility checks and a strict checkout policy** (`docs/wave-1-trust.md`, `docs/pci.md`). A store makes **draft** starter pages for terms, privacy, returns, shipping, withdrawal information and an imprint (and an accessibility statement) in nb, sv, da and en from its own facts (`legalFacts()`, `src/lib/legal-starters/*`), hand-written, each with a review notice and `[[placeholders]]` where a fact is missing; they are published only by the owner and are linked roles (`LEGAL_ROLES`, in `page_roles`, served at their own address, never A/B tested). Checkout shows a terms and privacy link or a required checkbox (`stores.terms_at_checkout`), and the pay press records `order_terms` with immutable `legal_snapshots` of the pages as shown. The builder checks a draft for missing alt text, empty links, heading order and contrast and asks before publishing with a blocking issue (recorded in the audit log); CI scans the storefront and the admin's entry pages with axe. The cart, checkout and order routes send a Content-Security-Policy (`src/lib/csp.ts`), draw no consent manager, owner code or chat widget (`OffPayRoutes`), are entered by full page loads, and refuse an HTML block on the checkout page. Texts need legal review; the SAQ A attestation and the accessibility audit are the company's.
*Why:* Asked for by the owner (wave 1). The policy keeps `'unsafe-inline'` for scripts unless the SRI form passes (a static shell cannot carry a nonce); the starters link no ODR platform (repealed 2025).

**D1xx (1f)**, 2026-10-03: **Two-step sign-in, roles and permissions, and an activity log for staff.** TOTP through Supabase Auth with our own single-use recovery codes (`commerce.account_recovery_codes`); required of platform admins and, by the owner's switch (`stores.require_two_step`), of a store's members; `getAccount()` fails closed for an enrolled session at `aal1` and enrolment is read from the signed claim or a server-side `getUser()`, never the cookie. Roles are `commerce.store_roles` of `{section}:{read|write}` keys plus the system roles; `staff:write` and `billing:write` and every owner-only page stay the owner's; every admin page, action and route asks `requirePermission()` / `checkPermission()` (scan tests fail on a missed one, a baseline proves owner and admin lost and gained nothing); collaborators are members with a role and an expiry. `audit_log` gains area, target and allowlisted changes (never secrets), has a page with filters and an owner's CSV, refuses edits, and is pruned at 24 months by application code through `commerce.guard_audit_log()`.
*Why:* Asked for by the owner (wave 1). Passkeys and native recovery codes wait: Supabase's client has them as experimental and its docs do not offer them.

### 9.6 Draft `CLAUDE.md` bullets

- **Legal pages and terms at checkout (D1xx, `docs/wave-1-trust.md`)**: a store's terms, privacy, returns, shipping, withdrawal-information, imprint and accessibility pages are *linked roles* (`LEGAL_ROLES` in `src/lib/legal-roles.ts`, rows of `page_roles`, served at their own address, in the sitemap when published, never A/B tested, `isLegalPage()`); starters are made as drafts from `legalFacts()` by `legalStarter()` (`src/lib/legal-starters/{nb,sv,da,en}.ts`, hand-written, never AI, each with the `legal-review-notice` row and `[[placeholders]]`, which the builder's checker blocks publishing over). Never link the EU ODR platform (repealed). Checkout's `stores.terms_at_checkout` (`link`, `checkbox`, `off`) draws the `checkout_terms` piece (and `CheckoutPayment` when the page has none); the pay press calls `recordTermsAcceptance()` before Stripe's `confirm`, writing `order_terms` and the immutable `legal_snapshots` (never columns on `orders`; copied orders refuse). A new legal kind is a role, a starter in each language with its `REQUIRED_TOPICS`, and an entry in `LEGAL_REVIEW_MANIFEST`.
- **Accessibility (D1xx)**: `pageIssues()` (`src/lib/page-a11y.ts`) is the one checker; `savePage()` re-runs it and publishing with a blocking issue needs `acknowledgedIssues` and writes `page.published_with_issues`. The statement (`src/lib/a11y-statement.ts`) never says "conforms" without an audit entry; `ENFORCEMENT_BODIES` entries carry `verified`. CI: `e2e/a11y.spec.ts` (axe, tags up to `wcag22aa`, fails on serious and critical; the admin's signed-out pages only).
- **Pay routes (D1xx, `docs/pci.md`)**: `/cart`, `/checkout` and `/order` send `checkoutCsp()` (`next.config.ts` `headers()`, both address shapes; `CSP_ENFORCE` is the one-line Report-Only fallback), draw nothing from `OffPayRoutes` (consent manager, owner code, chat, affiliate capture, business popup), and are entered by full page loads (`PayRouteGuard`, a scan test); the checkout page may not hold an `html` or embed-video block. A test fails if the layout or a pay route imports a module in `FORBIDDEN_ON_PAY_ROUTES`. Never add a script origin to the policy without a reason in `docs/pci.md`.
- **Staff security (D1xx)**: `getAccount()` is the *assured* account (null for an enrolled `aal1` session and for a platform admin without `aal2`); `getSessionAccount()` is for the sign-in and two-step pages only. Enrolment is read from the signed `aal` claim or a server-side `getUser()` for `aal1`, **never the cookie's `user`**; `accounts.two_step_since` is a display mirror. Recovery codes are `account_recovery_codes` (HMAC, single use, ten per set); using one deletes the account's factors with `SUPABASE_SECRET_KEY`. `ADMIN_TWO_STEP=off` is the break-glass. Two-step pages live under `/admin/sign-in/two-step` and `/admin/account` (a new `/admin/{word}` would take a store address).
- **Permissions (D1xx)**: every store admin page, action, route and helper asks `requirePermission(slug, key)`, `checkPermission`, `requireOwnerRole`, `requireAnyPermission`/`checkAnyPermission` (the page builder's side actions) or `requirePageTypeAccess`/`checkPageTypeAccess` (a kind of page has its own area, `PAGE_TYPE_AREA`) (`src/server/permissions.ts`, the names in `src/lib/permission-guards.ts`); Work's screens ask `settings:*`; nothing else compares `role` with `"owner"` or calls `requireMember`/`getMembership` (`permissions.scan.test.ts`). A page's key is its navigation section (`sectionOf`), `/staff…` → `staff`, `/billing` → `billing`; owner-only pages (`needs: "owner"`) need `owner`; `staff:write` and `billing:write` are owner-held. Roles are `store_roles` made by `ensureStoreRoles()` (not by `clone_store()`); a custom-role member has the enum `admin` and a `role_id`. A new page: one nav item, `ADMIN_PAGES`, a guard with its area. A new owner tool: a row in `TOOL_PERMISSIONS` (`runOwnerTool()` and `preflightOwnerTool()` hold it to the member's role; the MCP server serves a store that requires two-step, and a platform admin, to `aal2` tokens only). Collaborators are members with `kind = 'collaborator'` and `expires_at`.
- **Audit log (D1xx)**: `audit()` keeps its signature and takes an optional `{ area, target, changes }`; `auditChange()` writes allowlisted diffs (`ALLOWED_FIELDS`), never secrets; a new action needs an area in `AUDIT_AREAS` (a scan test). The log is append-only, deletable only after 24 months by `pruneAuditLog()` (`commerce.guard_audit_log()`); `/admin/{store}/activity` shows an owner everything and others their readable areas; the CSV is owners'.

## 10. Changes after the adversarial review

Six findings were taken at their cause; each has a test. They change the spec above as follows (where this section and an earlier one disagree, this one stands).

1. **Translations are checked (2.2).** `pageIssues()` also runs the placeholder check over every translation as `localizePage()` draws it (the title and each block's words), once for a block the main language does not already report; the message names the language. Filling the brackets in the main language alone no longer publishes silently. *Not done:* a translation made stale by a later edit of the main text is still shown as it was (D55's general behaviour, not changed in this lane); only a bracket left in it is caught.
2. **Withdrawal information follows what the store sells (4.1).** With bookings on, the withdrawal page and the terms say the period for services runs from the contract (CRD Annex I(A), Art. 9(2)), add the proportional-payment sentence (Art. 14(3)) and the Art. 16(a) and (l) exclusions (a fully performed service; accommodation, car rental, catering or leisure with a fixed date); with deliveries on, they say the period for regular delivery runs from the first delivery. The goods exclusions stay for every store and are followed by a `[[Check: …]]` line asking the store to delete those that do not fit what it sells, so the page cannot publish unnoticed. Eight new texts in each of nb, sv, da and en (`terms.withdrawal.services|regular`, `withdrawal.right.services|regular`, `withdrawal.effects.services`, `excl.dated_service|service_performed`, and the placeholder label `exclusionsFit`) are on the legal review list.
3. **The pay routes' policy allows `https://maps.googleapis.com` (4.4).** In `script-src` and `connect-src` only, because Stripe lists it for Stripe.js and the checkout mounts the Address Element (`docs/pci.md`, "Address autocomplete"). **Not verified against a live Stripe session**; the manual test-mode payment must check it, or the owner may remove `ADDRESS_AUTOCOMPLETE` from `src/lib/csp.ts` and live without autocomplete.
4. **Home and the control center follow the role and the expiry (2.7).** `controlCenter()` ignores a collaborator whose `expires_at` has passed and counts sales, orders waiting, the latest orders and returns only where the member holds `orders:read`, stock only with `products:read`, the plan only with `billing:read`; what is withheld is named in `StoreFigures.hides` and left out of the views, never drawn as zero. Home's Analytics alerts need `analytics:read`. The expiry predicate was added to `listStores()`, `signInAccount()`, `visibleTo()` of templates, Work's people lists and its store switch, the running timer and `roleIn()`; `store-members-expiry.test.ts` fails when another reader of `commerce.store_members` ignores it without a reason.
5. **The second step's limit is atomic (2.6).** A try is reserved before the code is checked, under a per-account advisory lock (`reserveAttempt()`), as an `account.two_step_attempt` entry (platform row only); it counts until the success entry (`two_step_passed`, `two_step_enrolled`, `recovery_code_used`) names it, or until it is cleared (`account.two_step_attempt_cleared`) because Supabase Auth could not be asked. The wrong code's own `two_step_failed` entry is still written, with the attempt's key. Parallel guesses therefore make at most five `verify` calls per window. No migration.
6. **A referral code survives the pay routes' reload (D131).** `PayRouteGuard` carries a code held only in the page's memory in the reload address (`?ref=`, as the capture does for links that leave the market), and `attachReferral()` falls back to the code on this browser's open cart. A visit may be counted a second time when the address carries the code again (the same as for the market links).

