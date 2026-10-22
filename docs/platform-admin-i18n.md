# Kaizena Flow and the admin in more than one language (D312)

Status: plan, 2026-10-22. Decisions 1 to 3 of section 2 taken as recommended (the owner, 2026-10-22); no lawyer reviews the legal pages (the owner, 2026-10-22: no gating, Norwegian live at once). P0 done; P1 built (2026-10-22): the `/no` routes, the switch and suggestion bar, `hreflang` and the sitemap, offered while turned on. P2 built (2026-10-22): the chrome's words in English and Norwegian catalogues (`platformText(lang)`), held by `platform-chrome.scan.test.ts`. P3 built (2026-10-22): the theme store in Norwegian (`/no/themes`, theme pages, the full-screen preview, the theme store's host), its words and each theme's own words per language (`listing.words`, `inLanguage()`). P4 built (2026-10-22): Kaizena Flow's builder translates its pages, articles, header, footer and theme store pages (`ownerLanguages(null)`, `translatePlatformPageAction`), `/no` draws their Norwegian texts (`inPlatformLang()`), and menu links have Norwegian words. A0 built (2026-10-22): the admin's language per account (`accounts.admin_locale`, first from the browser, Your account and the account menu), the catalogues' machinery (`adminText()`, `useAdminText()`), the account menu in Norwegian, and the scan with its baseline. A1 built (2026-10-22): the pages before a person is let in (sign-in, a forgotten password, two-step sign-in with its recovery codes and set-up, the OAuth consent) and what the server answers on them are the `signIn` catalogue (`src/lib/admin-messages/sign-in.{en,nb}.ts`), in the account's language where a session is known and the browser's `Accept-Language` before (`requestAdminLang()`, `src/server/admin-request-lang.ts`: never from the email typed, so an email with access and one without get the same words, and nothing is stored); the frame carries the page's `lang`, and Your account's two-step card reads the same words. A2 built (2026-10-22): the shell in the account's language: `AdminFrame` takes `lang` and draws its own words, the rail's, the level switcher's and the layouts' from the `shell` catalogue; the navigation (every section, sidebar heading, page label and card line of `store-nav.ts`, `owner-nav.ts` and `platform-nav.ts`) stays written in English and is shown through `navWord()` from `NAV_NB` (`src/lib/admin-messages/nav.nb.ts`), by the frame and the pages of cards (`SectionHub`); every admin page has a Norwegian title and words (`PAGES_NB`, `pages.nb.ts`) that `findPages()` matches, so the AI manager finds pages asked for in Norwegian, and a page's Norwegian title is the navigation's word for it (`admin-pages-nb.test.ts`). Store role names and the pages themselves follow in A3 to A11. A3 built (2026-10-22): the setup wizard (`setup` catalogue: the frame, every step, the "What will you sell?" answers, the business and countries fields, what the actions answer), a store's Home, the owner's control center and Your stores (`home` catalogue) in the account's language; what needs attention is `attentionFor(stores, now, words)` and the week's change `changeText(…, words)`, written from the catalogue with counts as `{ one, many }` pairs (`countWords()`), English when no words are given; the demo content's words (`demoWords()`, `removalWords()`) take the same; an order's status in a list is `common.orderStatus`; amounts and dates are in the language's own format (`ADMIN_LANG_FACTS[lang].locale`). The Company and Countries settings, feature labels and warnings, the Stripe panel and the texts other areas put on the attention list (tax findings, the VAT report, Work) stay English until their own step. A4 built (2026-10-22): Orders in the account's language, in five catalogues: `orders` (the list, filters, saved views, bulk actions, tags and archive, pick list, packing slips, export; the list's sentences through `src/lib/order-list-words.ts`), `order` (one order: its cards, parcels and handovers, capture, hold, payments, gift message, bonus and referral, and their actions), `drafts` (draft orders and order changes, `src/lib/drafts-words.ts`), `returns` (returns, exchanges, return labels and their settings) and `invoices` (the invoices page and its settings, the order's documents card). A page hands its client parts the slices they read with `AdminTextScope` (`src/components/admin/admin-text.tsx`), so the layout's provider stays small; a server action that refuses before a member is known answers in `actionAdminLang()` (English outside a request). The libraries' functions take the words as an optional last parameter and say exactly the English they said before when none are given. Left English for their own steps: the order history's event sentences, payment-method and dispute words, refusals the server modules write, stored refund and cancel reasons (they can reach the customer), the orders and export settings forms, loading screens, and every document, shopper page and email. A5 built (2026-10-22): Products in the account's language, in six catalogues: `products` (the list, bulk edit with its grid and results, product import and export, categories and tags with their fields and search texts; `BULK_WORDS` in `src/lib/bulk-admin.ts`), `product` (the product editor in every section, unit price, VAT category and search snippet fields; `src/lib/admin-messages/product.test.ts` holds its English to the libraries'), `inventory` (stock, locations, history, stock import and export; `src/lib/inventory-words.ts`), `giftCards` and `reviews` (their admin pages and actions), and `fields` (custom field groups, the field editor, the entry form and pickers wherever they are drawn; `staff-fields-section.tsx` scopes itself). A page that draws a part of another area adds that area to its `AdminTextScope` (the product editor hands down `product`, `products` and `fields`). Left English for their own steps: the page editor's custom fields until A7 adds `fields` to its scope, server-written refusals and job findings, the shared data pieces (job progress, export forms), platform-made VAT category names, CSV column names, and shopper words, emails and loading screens. P5 (stores' part) built (2026-10-22): every statement of a right in the stores' Norwegian legal starters is written from the record's passages and cites its section (`RIGHT_STATEMENTS` in `legal-wording-nb.test.ts`); Kaizena Flow's own terms of service, privacy notice and data processing agreement are written by hand in English and Norwegian (`src/lib/platform-legal/{en,nb}.ts`, `src/lib/platform-legal.ts`) and published from the Legal pages card on Platform → Pages (`writePlatformLegalPages()`: a missing or empty page is written, a written one only when ticked), Norwegian as the pages' `nb-NO` texts; the company's facts come from the business details, a missing one a bracketed placeholder. P6 built (2026-10-22): a request keeps its language (`access_requests.locale`), its emails (received, approved, declined) are written in it (`accessEmail()`, `platformText(lang).accessEmails`), the new owner's admin starts in it, and Supabase's sign-in link carries it as user data (`{{ .Data.locale }}` for the template). Norwegian (bokmål, `nb-NO`) first, then the other hand-written languages (Swedish, Danish). English stays the
source and the fallback.

The owner's ask: every string of Kaizena Flow's own site (the platform store: front page, Kaizena Flow's pages, sign-up, the theme store,
the blog) and of the admin can be read in Norwegian; the platform store first, then the admin. Legal and financial terms are researched
and right, never guessed.

## 1. What there is today

| Surface | Where | Today | Size (measured 2026-10-22) |
|---|---|---|---|
| Kaizena Flow's own site, chrome | `src/app/(platform)/`, `src/components/platform-*.tsx`, `theme-*.tsx` | English in the code; `<html lang="en">`, `og:locale en_GB`, `SiteConsent lang="en"` | 31 files, about 70 texts |
| Kaizena Flow's own site, content | builder pages with a null owner (`pages`, `platform_page_roles`, the theme store's pages, D285) | English only; the platform's `PageOwnerContext` has `translate: null`, so its builder has no translate mode | data, not code |
| Kaizena Flow's legal pages | builder pages (terms for owners, privacy, data processing) | English, written by people | data |
| The theme store | `/themes`, `/themes/{slug}`, listing words (`design_presets.listing`), highlights, launch themes' `notes` | English | data and code |
| Emails to owners and staff | sign-in links, access request decisions, staff alerts, security emails, billing, theme invoices, Kaizena Flow support replies | English (`email-text.ts` holds shoppers' languages; owner emails mostly inline English) | about 25 senders |
| The admin's pages | `src/app/admin/**` | English in JSX, `<html lang="en">` | 642 files, about 2,700 texts |
| The admin's components | `src/components/admin/**` | English in JSX | 449 files, about 6,000 texts |
| Navigation and the admin map | `store-nav.ts`, `owner-nav.ts`, `platform-nav.ts`, `admin-map.ts` | English | 4 files, every label |
| Messages from the server | refusals and results of savers and tools (`fail(…)`, `problems: [...]`, `message: "…"`) | English sentences, shared by screens, the AI manager and the MCP server | about 1,400 |
| Validation | zod messages in shared schemas (`src/lib/*-input.ts`, `*-schema.ts`) | English | several hundred |
| The AI manager | tool descriptions (`OWNER_TOOLS`), `TOOL_WORDS`, approval summaries, system prompt | English; the model answers in what it is spoken to in | about 400 tools |

The shopper side already has the machinery this plan reuses: `t(lang)` and the hand-written catalogues in `src/lib/messages/{lang}.ts`
(English is the type, so a missing key is a compile error), `HAND_WRITTEN_ONLY`, the AI-translated catalogue for other languages (D111),
per-language page texts (D55, `mapTexts()`, `localizePage()`), and `formatMoney()`/`Intl` with a locale.

## 2. Decisions, with what I recommend

1. **Address of Kaizena Flow's own site in Norwegian.** Recommended: a language prefix, `/no/…` (`kaizenaflow.com/no`, `/no/themes`,
   `/no/sign-up`; the owner chose `/no` over `/nb`, the language itself tagged `nb`), English unprefixed as today, so no English link breaks. `nb`, `sv`, `da`, `en` become reserved page addresses. Never a
   redirect by the browser's language (the store chooser's rule): the site suggests Norwegian once, in a small bar, to a browser that asks
   for it. Alternatives: a Norwegian domain (`kaizenaflow.no`) later, pointing at the same `/no` routes.
2. **The admin's language.** Per account (`accounts.admin_locale`, `en` or `nb-NO`), chosen on Your account and in the account menu,
   first set from the browser at the first sign-in. Never per store: a person working in two stores reads one admin. The store's own
   languages stay what its shoppers read.
3. **Kaizena Flow's admin (`/admin/platform`).** Last. It is used by Kaizena Flow's own team; translated after every page owners and staff
   see, with the same catalogue, so nothing is built twice.
4. **What stays English.** Code, logs, audit action names, error ids, API and webhook payloads, CSV column headers of imports and exports
   (Shopify's and the importers' are English; a Norwegian header would break an import), and Kaizena Flow's name. Each is listed in the
   scan test's allowlist with its reason.
5. **Who writes Norwegian.** Written into the catalogues by hand in code review (as nb, sv, da and en are for shoppers today), never
   translated at run time. Legal and financial terms come only from the glossary (section 5), each with its source. Legal texts (Kaizena
   Flow's terms, privacy, data processing agreement) are translated in full in the law's own wording and published as they are: no lawyer
   reviews them first (the owner, 2026-10-22: "Do not apply gating. We need Norwegian and any other language to go live immediately.").

## 3. How it is built

### 3.1 Languages of the platform

- `platform_settings.locales` (`{en, nb-NO}`, the main first), edited on a Languages page under Kaizena Flow's Settings, as a store's are;
  the platform's hand-written languages are the ones `src/lib/messages` holds. A language is offered on the site as soon as it is turned on
  there (no readiness check; the owner, 2026-10-22); Norwegian is on in production from migration `platform_norwegian_on`.
- One reader, `platformLang(request or params)`, gives the language a page is drawn in; every platform route and layout takes it, and
  `<html lang>`, `og:locale`, `SiteConsent`, `hreflang` alternates, the sitemap (one entry per language with alternates) and `llms.txt`
  follow it.

### 3.2 Kaizena Flow's own site (the platform store)

- **Chrome:** a catalogue `src/lib/messages/platform-{lang}.ts` (English the type) for the standard header and footer, sign-up and its
  form errors, the theme store's parts (`theme-page-parts.tsx`, `ThemePreviewStage`, cards, filters, prices and `priceLine()`), the blog
  listing, cookies, unsubscribe, Kaizena Flow support's pages, not found, the full-screen preview's bar. Read through `platformText(lang)`;
  client parts get only their slice (D211: no catalogue in a visitor's first scripts beyond what it draws).
- **Content:** Kaizena Flow's builder gets the store's translate mode (D55): `translate` in the platform's `pages/context.ts`, texts in
  other languages laid over the page, `localizePage()` on the site; the AI page translation (`page-translate-ai.ts`) only suggests, as for
  stores, and is never used for a legal page. Menus' words per language, as a store's.
- **The theme store's data:** listing words, highlights and launch themes' notes per language (`listing.words[lang]`), written by people;
  a theme without Norwegian words shows the English ones with `lang="en"` on them.
- **Emails from the platform store:** access request received and decided, sign-in links, in the language the request was made in
  (`access_requests.locale`).

### 3.3 The admin

- **Catalogue:** `src/lib/admin-messages/{area}.{lang}.ts`, one pair per area (common, nav, orders, products, customers, marketing, website,
  settings, analytics, support, work, billing, platform), English the type, so a key missing in Norwegian fails the typecheck. Server
  components read `adminText(lang, area)`; client components get their area's slice from the layout through `AdminTextProvider` and
  `useAdminText(area)`.
- **Plural and choice:** the ICU subset of `src/lib/icu-lite.ts` (`{count, plural, one {…} other {…}}`), never string joins; dates, numbers
  and money with the account's locale (`formatMoney(…, "nb-NO")`, `Intl.DateTimeFormat`).
- **Messages from the server:** a saver's refusal becomes a key with values (`problem("shipping.notSold", { country })`), turned into words
  by the screen in the person's language and by the AI manager in English for the model and the person's language for the person. Converted
  module by module with the screens that show them; a saver not yet converted keeps its English sentence, which the screen shows as it is.
- **Validation:** shared schemas get a zod error map keyed by message id (`schemaText(lang)`), so the browser and the server say the same
  words in the same language.
- **The AI manager:** told the person's language in its system prompt (it answers in it); `TOOL_WORDS`, approval summaries and the code's
  answers (`done`, `note`) from the catalogue; tool descriptions stay English (they are for the model).
- **Emails to owners and staff:** staff alerts, security emails, billing and theme invoices, support replies, the AI manager's digest
  (unit B3) in the recipient's `admin_locale`.
- **Guard:** `admin-strings.scan.test.ts` walks the converted areas and fails on English text in JSX or a quoted sentence in a prop it knows
  (`label`, `title`, `description`, `placeholder`, `aria-label`), against `admin-strings.baseline.json`, which only ever shrinks (as
  `permissions.baseline.json` does). A second test holds every Norwegian catalogue to the glossary (section 5.3).

## 4. The order of work

Each step is its own commit with its tests, shipped before the next; each ends with the pages it covers read in Norwegian in the
signed-in browser tests (`e2e/signed-in/`, an owner with `admin_locale = nb-NO`) and on the site.

**The platform store first**

| Step | What | Done when |
|---|---|---|
| P0 | The glossary (section 5): every legal, financial, tax, payment and privacy term the site and the admin use, researched with its source | `docs/i18n/glossary-nb.md` and `src/lib/i18n-glossary.ts` reviewed, every entry with a source and a date |
| P1 | Languages of the platform (3.1): `platform_settings.locales`, `platformLang()`, `/no` routes, reserved addresses, `<html lang>`, hreflang, sitemap, the language bar | `/no` draws the site with Norwegian chrome where written and English where not, each marked with its `lang` |
| P2 | The site's chrome catalogue in English and Norwegian: header, footer, sign-up and its errors, cookies, unsubscribe, support, not found | the scan finds no English in the platform's chrome |
| P3 | The theme store in Norwegian: its parts, cards, filters, prices (without VAT, in the store's words), preview bar, listing words per language | `/no/themes` and every theme page read in Norwegian |
| P4 | Kaizena Flow's builder translates (3.2): the front page, the plans page, the theme store's pages and the other content pages in Norwegian | every published Kaizena Flow page has Norwegian texts |
| P5 | Kaizena Flow's legal pages in Norwegian in the law's own wording (5.2), published as written (no lawyer's review, the owner). The stores' Norwegian legal starters (`src/lib/legal-starters/nb.ts`) are checked against the same wording | published; every statement of a right cites its section |
| P6 | Emails from the platform store in the requester's language | the access request emails in Norwegian for a Norwegian request |

**Then the admin**, in the order an owner meets it

| Step | What |
|---|---|
| A0 | The language choice (`accounts.admin_locale`, Your account, the account menu), the catalogue's machinery, the provider, the scan and its baseline |
| A1 | The pages before a person is let in: sign-in, two-step, forgotten password, OAuth consent (`FocusFrame`) |
| A2 | The shell: rail, sections, sidebars, account menu, level switcher, `ADMIN_PAGES` names and keywords (so the ⌘K search finds Norwegian words), the components in `src/components/admin/ui/` |
| A3 | The setup wizard and the store's Home, the owner's control center and Stores |
| A4 | Orders: list, filters, saved views, an order, drafts, returns and exchanges, shipping and handovers, invoices and credit notes |
| A5 | Products: list, editor, inventory, gift cards, reviews, fields, categories and tags, bulk edit, imports |
| A6 | Customers and marketing: customers, segments, subscribers, broadcasts, automations, discounts, campaigns, bonus, referrals |
| A7 | Website: pages and the builder, menus, header and footer, media, design and themes, redirects, A/B tests |
| A8 | Settings: company, countries, languages and currencies, tax, payments, shipping, notifications, legal, accessibility, features, staff and roles, close the store, billing |
| A9 | Analytics, including Finance, payouts and the VAT, OSS and IOSS reports (financial terms only from the glossary) |
| A10 | Support inbox, Work, the AI manager's words, the emails to owners and staff |
| A11 | Kaizena Flow's admin (`/admin/platform`) |
| A12 | Swedish and Danish, area by area, with their own glossaries |

## 5. Getting legal and financial Norwegian right

### 5.1 The rule

A term about law, tax, accounting, payments, consumer rights or personal data is never translated from the English word. It is taken from
the Norwegian source that defines it (the law's own words on Lovdata, the authority's own pages), written into the glossary with that
source, the date it was read and who checked it, and used only from there. Where Norwegian law has no counterpart (an EU-only scheme), the
glossary says what Norwegian authorities call it and what the admin says, and the admin explains it rather than inventing a word.

### 5.2 Sources, in order of weight

1. The law itself on Lovdata (`lovdata.no`): angrerettloven, forbrukerkjøpsloven, kjøpsloven, merverdiavgiftsloven, bokføringsloven and
   bokføringsforskriften, regnskapsloven, personopplysningsloven with GDPR as it is in Norwegian (personvernforordningen), markedsføringsloven,
   ehandelsloven, finansavtaleloven, likestillings- og diskrimineringsloven (universell utforming), and their regulations.
2. The authorities' own pages: Skatteetaten (mva., VOEC, registration, invoices' required contents), Brønnøysundregistrene (organisasjonsnummer,
   Foretaksregisteret, Merverdiavgiftsregisteret), Forbrukertilsynet and Forbrukerrådet, Datatilsynet, Finanstilsynet, Digdir/Uutilsynet.
3. The EU's Norwegian-language texts where Norway has taken them over through the EEA (EØS) and the Commission's own terms (IATE).
4. Språkrådet's advice and the Termportalen for words that are not legal terms; the payment providers' own Norwegian pages (Stripe, Mollie,
   Vipps) for what shoppers and owners already read.
5. Never: a machine translation, another shop system's translation, a forum.

### 5.2a The law's own wording in legal pages (the owner, 2026-10-22)

The terms are not enough: where a legal page (Kaizena Flow's terms, privacy, data processing agreement and cookies pages, and the stores'
Norwegian legal starters) says what the law gives or requires, it says it in the law's own words as Lovdata has them, not in a
paraphrase of the English page.

- **Rights and duties** (the right of withdrawal and its period, the complaint period, the data subject's rights, the duty to keep
  accounting records) are written with the section's own wording, adapted only in grammar to the sentence, and cite the section
  (`angrerettloven § 22`). The page keeps the English page's structure, but not its sentences where the law has its own.
- **Prescribed texts** are copied word for word from the regulation on Lovdata, never reworded: the standard withdrawal form and the
  information about the right of withdrawal (`forskrift om opplysningsplikt og angrerett`, its attachments), and any other text a law or
  regulation prescribes.
- **Each such passage is recorded** with its source: `LEGAL_WORDING_NB` beside the glossary (statute, section, Lovdata address, the date
  read, the passage as the page uses it), and a test fails when a Norwegian legal page or starter quotes a prescribed text differently
  from the record.
- **When the law changes**, the passage is read again on Lovdata; the record's date says how old each one is, and a passage older than a
  year is listed for checking.
- No lawyer reviews the pages (the owner, 2026-10-22); Lovdata's wording is what keeps them right.

**As built in P0 (2026-10-22).** `src/lib/legal-wording-nb.ts` holds 23 passages (angrerettloven §§ 8, 20, 21, 24; forbrukerkjøpsloven
§§ 26, 27; ekomloven § 3-15; ehandelsloven § 8; forskrift om opplysningsplikt og angrerett mv. §§ 1–2; the titles of personvernforordningen
art. 13–18, 20, 21), all `proofread: false`: Lovdata refuses plain downloads, so they were read in short pieces and joined, and a person
compares each with Lovdata before a page uses it. Two reads came back garbled and are left out (the lead-in of angrerettloven § 21's
letters; a stray sentence in forbrukerkjøpsloven § 26). Its test checks the record, lists passages older than a year
(`staleWording()`), refuses the repealed ekomloven § 2-7b and holds any prescribed passage a Norwegian legal text cites to its words.
Open: the standard withdrawal form is not on Lovdata (the regulation points to the directive's Annex I B, and Forbrukertilsynet names
the state form Q-0319B), which the owner chose as the source (2026-10-22); LOV-2026-06-19-34 (a withdrawal function, § 20 a) and inkassoloven 2026
are passed but not in force, to read again when they are.

### 5.3 The glossary

`docs/i18n/glossary-nb.md` (for people) and `src/lib/i18n-glossary.ts` (for the tests): each English term, its Norwegian term, a short
definition, its source with a link and the date read, any words that must not be used for it, and its status (`researched`, `checked by a
person`, `legal review`). A test fails when a Norwegian catalogue uses a word the glossary forbids (for example `tilbaketrekking` where
`angrerett` is meant) or a glossary term in a form it does not list.

Candidates to research in P0 (none is used before its entry has a source):

| English | Norwegian candidate | To check against |
|---|---|---|
| VAT | merverdiavgift, mva. | merverdiavgiftsloven, Skatteetaten |
| VAT number / VAT registered | organisasjonsnummer med MVA; registrert i Merverdiavgiftsregisteret | Brønnøysundregistrene, bokføringsforskriften § 5-1-1 |
| reverse charge | omvendt avgiftsplikt | merverdiavgiftsloven § 11-1, Skatteetaten |
| IOSS | IOSS (EU's importordning), not the same as VOEC | Skatteetaten on VOEC; the EU's Norwegian texts |
| VOEC | VOEC-ordningen (forenklet mva.-registrering for fjernsalg av lavverdivarer) | Skatteetaten |
| OSS (Union and non-Union schemes) | EU's ett-vindu-ordning (unionsordningen, ikke-unionsordningen) | EU texts in Norwegian, Skatteetaten |
| invoice / credit note | faktura / kreditnota | bokføringsforskriften kap. 5 |
| right of withdrawal | angrerett, angrefrist, angreskjema | angrerettloven |
| complaint / defect | reklamasjon, mangel | forbrukerkjøpsloven |
| terms of sale | salgsbetingelser, kjøpsvilkår | Forbrukertilsynet's standard terms |
| privacy policy / controller / processor / DPA | personvernerklæring / behandlingsansvarlig / databehandler / databehandleravtale | personopplysningsloven, Datatilsynet |
| payout / payment fee / dispute (chargeback) | utbetaling / transaksjonsgebyr / tvist, tilbakeføring | Stripe's and Mollie's Norwegian pages, finansavtaleloven |
| refund | refusjon, tilbakebetaling | angrerettloven, forbrukerkjøpsloven |
| gift card (multi-purpose voucher) | gavekort (flerbruksverdikort) | merverdiavgiftsloven's rules for vouchers, Skatteetaten |
| unit price | enhetspris, pris per kg/liter | prisopplysningsforskriften |
| order / draft order | bestilling (shoppers), ordre (admin)?, utkast | to be decided once, used everywhere |
| record keeping | oppbevaringsplikt (bokføringsloven § 13) | bokføringsloven |
| accessibility statement | tilgjengelighetserklæring | Uutilsynet, likestillings- og diskrimineringsloven |

### 5.4 Style for everything else

Bokmål, moderate forms; *du*; sentence case; Kaizena Flow's plain register (words for what the person gets: the Homer and Lisa rule); one word
for one thing across the admin and the site (the glossary holds the shop words too: butikk, produkt, variant, lager, frakt, levering,
kampanje, rabattkode); numbers, dates and money as `nb-NO` writes them (`1 249,50 kr`, `22.10.2026`).

## 6. Tests

- Each catalogue: English is the type; a key missing in Norwegian fails the typecheck; a plural is an ICU message with a case in its test.
- `admin-strings.scan.test.ts` and its shrinking baseline; the platform's chrome scan the same.
- The glossary test (5.3).
- Signed-in browser tests per admin step with a Norwegian owner, and the platform site at `/no` in the public e2e: no English text in the
  areas converted, `lang` right on the page and on English stand-ins.
- The AI manager: a turn of a Norwegian account answers in Norwegian and its approval summaries are Norwegian (a fake model).

## 7. Risks

- **Size.** About 9,000 admin texts and 1,400 server sentences: the work is long, so each step ships alone and the baseline keeps what is
  done from sliding back.
- **Half-translated screens.** A page converted shows English only where its server sentences are not yet keys; the step that converts a
  page converts the savers it calls.
- **Legal liability.** A Norwegian legal page that is wrong binds Kaizena Flow; the owner has chosen to publish without a lawyer's review (2026-10-22),
  so the law's own wording from Lovdata is the safeguard.
- **Imports.** Translated CSV headers would break imports; they stay English (section 2, decision 4).
