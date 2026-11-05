# The admin's usability: an audit and a plan (November 2026)

Decision D453. Written 4 November 2026 from two sources: the code of the admin (navigation data, the frame, about 60 of the store's 244
pages and their components) and the admin itself as an owner sees it, signed in to a fresh store on a local build, at 1440 px and on a
phone. Phase 0 below is built in the same change; phases 1 to 4 are the plan.

The yardsticks: Jakob Nielsen's ten heuristics (H1 to H10 below), what is known of how people choose and remember (Hick's law, working
memory and chunking, recognition over recall, information scent, dual coding), and the house rule that every screen serves **Homer**
(System 1: one obvious action, nothing to understand first) and **Lisa** (System 2: every setting, one deliberate step away). Severity is
Nielsen's: 4 a catastrophe, 3 major, 2 minor, 1 cosmetic.

## 1. The headline

**The maze is the navigation, not the pages.** Most pages are good once found: the orders list, the product editor, the features page and
the media library are models to copy (section 7). What makes the admin hard is how many doors there are, how alike they look, and that
the same word opens different doors.

| Measure | Before | After phase 0 |
|---|---|---|
| Pages in a store's sidebars | 104, in 9 sections | 104; **40 in Basic**, about 28 for a store with only the shop on |
| Settings | 33 cards and 33 sidebar links | 11 in Basic |
| Marketing / Analytics / Website | 14 / 14 / 13 links, each one flat list | 5 / 2 / 6 in Basic |
| Sections' names in the rail | hidden until the person found the button at its foot | shown on screens 1280 px and wider |
| Pages with an icon beside their name | 0 (sections only) | every page, at all three levels |
| Ways to jump to a page by name | none (⌘K opens the AI manager) | none yet: phase 1 |

A person can hold about four chunks in working memory, and the time to choose grows with the number of equal choices (Hick). A flat list
of 33 settings, whose names are the only cue, asks Homer to read every one, every time. Basic cuts the choice to the everyday few, icons
give each link a second, faster cue (pictures and words are remembered better together than either alone), and groups chunk what is left.

## 2. Findings: the frame and the navigation

From the navigation data (`src/lib/store-nav.ts`, `owner-nav.ts`, `platform-nav.ts`), the frame (`src/components/admin/admin-frame.tsx`,
`admin-rail.tsx`, `store-admin-nav.tsx`) and the screenshots.

| # | H | Sev | Problem | Evidence | Fix | Status |
|---|---|---|---|---|---|---|
| N1 | H8, H6 | 3 | Too many equal choices. 104 pages; Settings alone 33, in a sidebar taller than the screen. Marketing (14), Analytics (14) and Website (13) are each one flat, ungrouped list. | `store-nav.ts`; screenshots of Settings and Shipping | Basic view; then group Marketing, Analytics and Website into 3 or 4 chunks each | **Basic done (phase 0)**; groups phase 2 |
| N2 | H6 | 3 | The rail shows bare icons by default. Box (Orders), tag (Products) and megaphone (Marketing) must be recalled, not read; the names live in a hover tooltip that a touch screen never shows. | `railNamesScript()` defaulted to off | Names by default where there is room | **Done**: names from 1280 px until the person narrows it |
| N3 | H2 | 2 | Settings' cog was drawn as a sun, the usual sign for light and dark mode. | `PATHS.cog` in `nav-icons.tsx` | A real cog | **Done** |
| N4 | H6 | 2 | Sidebar and card links were words only: 33 look-alike lines to read. | `StoreSidebar`, `SectionHub` | An icon beside every page name | **Done**, at all three levels |
| N5 | H4 | 3 | One word, two doors. *Orders* is a section and a Settings page; *Returns* is in Orders and in Settings; *Customers*, *Products*, *Inventory*, *Marketing* and *Subscriptions* are sections and also Analytics pages; *Header and footer* (Settings) against *Headers* and *Footers* (Website); *Automation*, *Workflows* and *Email automations*; *Campaigns* and *Coupons* are both discounts; *Chat assistant* in the menu is *Chat agent* on its page. | `store-nav.ts`; `S/chat/page.tsx:11` | A section's own settings live in the section (a Settings tab on Orders, Returns); one name per thing; merge Automation into Workflows; *Discounts* with *Automatic* and *Code* | Phase 2 |
| N6 | H7, H6 | 3 | No way to go to a page by its name. ⌘K opens the AI manager. `ADMIN_PAGES` already holds a title, words people use and tasks for all 386 pages. | `src/lib/admin-map.ts`; `shortcut-sheet.ts` | *Go to…* finder on ⌘K (the AI manager keeps its button and ⌘J), searching every page, Advanced ones too: Basic's safety net | Phase 1 |
| N7 | H1 | 2 | Where am I? A page's title does not say its section: Analytics opens on a page titled *Overview*, the same word Home uses. | `S/analytics/page.tsx` | The section's name as the eyebrow of every page's `PageHeader` | Phase 1 |
| N8 | H8 | 2 | Home puts a new store's one main job, *Finish setting up* (3 of 6), last, under a briefing offer and empty figures. | `S/page.tsx` | The checklist first until it is done | Phase 1 |
| N9 | H8 | 1 | Inside a store, every attention line repeats the store's name ("E2E Shop: 2 products are out of stock"). | `attentionFor()` reused from the control center | Drop the prefix at the store's level | Phase 1 |
| N10 | H4 | 2 | Analytics' period has three ways to apply it: preset buttons, *Apply range* and *Update* (for the comparison). | Screenshot of Analytics | One period control that applies at once | Phase 3 |
| N11 | H6 | 2 | Marketing opens on Campaigns; Homer's most common job there, a discount code, is the second link and called *Coupons* while its page says *code*. | `store-nav.ts`, `M/discounts.en.ts:95` | A Marketing home with its three everyday jobs; one word, *discount code* | Phase 2 |
| N12 | H8 | 2 | On a phone the menu lists every section and then the whole sidebar: 43 links in one scroll in Settings. | Phone screenshot | Basic (21 links); then the sections as a row of icons above the section's pages | Basic done; rest phase 2 |
| N13 | H4 | 1 | Group headings carry clashing classes (`text-xs … text-muted … text-title text-ink`): the cascade decides their look. | `StoreSidebar`, `SectionHub` | `text-eyebrow text-muted` | Phase 1 |
| N15 | H8 | 1 | On the Settings and Website pages of cards, the sidebar lists the same pages as the cards beside it. | `storeAreas()` gives a hub its own sidebar | No sidebar on a page of cards (its cards are the list); meanwhile Basic's note is said once, by the cards | Note done; rest phase 2 |
| N14 | H10 | 1 | `docs/admin-navigation.md`'s tables have drifted from the navigation (the owner's Account list was four pages; it is thirteen). | `docs/admin-navigation.md` | Owner part corrected; generate the tables from the nav data, as the parity tables are | Phase 4 |

## 3. Findings: inside the pages

From reading the pages and components. Each line was checked against the code (✓) or is reported from the read and to be checked when
its fix is made (·). `S/` is `src/app/admin/(gated)/[store]/`, `C/` is `src/components/admin/`, `M/` is `src/lib/admin-messages/`.

### H1 Visibility of system status

| Sev | Problem | Evidence | Fix | |
|---|---|---|---|---|
| 3 | After a save, *Saved.* stays while the person edits again; no settings form says *not saved*. The default word is English in code. | `C/action-form.tsx:41`, `:98` | Clear the status on input, show *Not saved* beside the button, take the word from the catalogue | ✓ |
| 3 | Only six editors warn before leaving with unsaved changes; the discount and campaign editors keep everything in the browser and Cancel is a bare link. | `C/product-editor.tsx:175`; `C/discount-editor.tsx:497`; `C/campaign-editor.tsx:694` | One leave-guard hook for every editor | · |
| 2 | Saving a code or a campaign returns to the list with no word that it worked. | `C/discount-editor.tsx:125` | A `?saved` notice, as Pages' `?deleted` | · |
| 2 | `ui/Button` never shows that it is busy; plain forms built on it give no feedback (switching a campaign on). | `C/ui/button.tsx:66`; `S/campaigns/page.tsx:107` | A submit `Button` reads `useFormStatus` | · |

### H2 Match with the real world

| Sev | Problem | Evidence | Fix | |
|---|---|---|---|---|
| 3 | Discount and campaign start and end times are read as Oslo time in every store, and the hint says *Norwegian time*. On an EU-wide platform a Finnish or Portuguese store's sale starts an hour off. | `src/server/discounts.ts:182`; `M/discounts.en.ts:82`, `:238` | The store's own time zone, named in the hint | ✓ |
| 2 | Home's latest orders show UTC dates sliced from ISO strings; dozens of `slice(0, 10)` dates across the admin's pages and components do the same. | `S/page.tsx` (`placedAt.slice(0, 10)`) | One date formatter in the store's zone | ✓ |
| 2 | Payments' *Recent changes* shows raw action codes and UTC times, and changes that are not payments. | `S/settings/payments/page.tsx:231` | The activity log's sentences, filtered | · |
| 2 | The inbox's checkbox is labelled only *Partner*. | `M/support.en.ts:27` | *AI partner (only your team sees this)*, already in the catalogue | · |
| 1 | The store's time zone lives in Features, under appointments, though it sets every date. | `S/settings/features/page.tsx:53` | Move it to Company | · |

### H3 and H5 User control and error prevention

| Sev | Problem | Evidence | Fix | |
|---|---|---|---|---|
| 3 | **Refund** sends money back without a question; the button says only *Refund*. Cancel does ask. | `C/order-actions.tsx:188`; cancel `:228` | *Refund €X*, then confirm amount, restock and email | ✓ |
| 3 | Deleting an automation rule always sends a hidden `confirm=1`, so the server's check never stops anything. | `C/automation/rule-list.tsx:90` | A real confirm step | ✓ |
| 3 | *Remove access* for a team member is one press, with no question and no undo. | `C/team-view.tsx:102` | Confirm naming the person; offer *Give access back* | ✓ |
| 3 | *Disconnect Mollie* is one press, even while it takes live payments. | `C/mollie-card.tsx:138` | Confirm, saying what stops working | ✓ |
| 3 | Many permanent deletes ask nothing: price lists, segments, companies, customer groups, checkout rules, roles, connected apps. 39 files call `window.confirm` themselves; the one shared confirm is named `DeleteDiscountButton`. | `S/price-lists/[listId]/page.tsx:351` and others | `ui/ConfirmButton` for every destructive action | · |
| 2 | Discount and campaign errors appear only after saving, listed at the top; the fields are not marked. `ActionForm` already marks fields and moves focus. | `C/discount-editor.tsx:129` | Return the failing fields and mark them | · |

### H4 Consistency and standards

| Sev | Problem | Evidence | Fix | |
|---|---|---|---|---|
| 2 | A product's *Web address* in the editor is its *handle* on import, and *handle* is also the drag handle. | `M/product.en.ts:79`; `M/products.en.ts:212`, `:417` | *Web address* everywhere owners read | · |
| 2 | Analytics says *Cost to win*; the ad spend page says *CAC* and *ROAS*, explained only in a tooltip that touch screens never show. | `M/analytics.en.ts:693`, `:712` | Plain words, the abbreviation after them | · |
| 2 | Page actions are hand-made pills beside `PageHeader` rather than its `actions` slot (96 such pills). | `S/orders/page.tsx:36`, `S/products/page.tsx:35` | `PageHeader.actions` with `ButtonLink`; a lint rule | · |
| 2 | An order's status, payment and sending state run together in one sentence. | `S/orders/[orderId]/page.tsx:254` | Chips in `PageHeader.status` | · |

### H6 Recognition rather than recall

| Sev | Problem | Evidence | Fix | |
|---|---|---|---|---|
| 2 | Whether shoppers need an account is on *Checkout rules*. | `S/settings/checkout/page.tsx:58` | Under Customers' settings | · |
| 2 | The Team page's main action, *Invite*, is at its foot; the header offers Roles and Activity log. | `S/staff/page.tsx:84` | *Invite* as the page's main action | · |

### H7 Flexibility and efficiency

| Sev | Problem | Evidence | Fix | |
|---|---|---|---|---|
| 3 | The products list has no search, no paging and no filter but its two tabs, and loads every product. Orders, customers and inventory have search. | `S/products/page.tsx` | Search, filters by status, stock and category, paging | ✓ |
| 2 | ⌘S saves only in the page editor, not in the product editor or any settings form. | `C/page-editor.tsx:548` | ⌘S on every form with a save button | · |
| 1 | Pages has no search or filter. | `S/pages/views.tsx:130` | Search | · |

### H8 Aesthetic and minimalist design (progressive disclosure)

| Sev | Problem | Evidence | Fix | |
|---|---|---|---|---|
| 3 | The discount editor shows five open cards and about 26 controls, the campaign editor about 45, with no *Advanced* fold. | `C/discount-editor.tsx:462`; `C/campaign-editor.tsx:224` | Code, amount and dates for Homer; who, limits and combining under *More options* | · |
| 2 | AI settings open on the whole *your own provider* form (26 controls) though Kaizena Flow's AI is the default. | `S/settings/ai/page.tsx:86` | Show the form only after *Use my own provider* | · |
| 2 | Payments stacks seven cards at one level. | `S/settings/payments/page.tsx:96` | Status first; methods, wallets and Mollie under *More ways to pay* | · |
| 2 | The IOSS card always shows, though it applies only to goods sent from outside the EU. | `C/tax-profile-form.tsx:163` | Show it when the store ships from outside the EU | · |
| 2 | The order page has about ten sections; Refund and Cancel are always-open forms and *Sending* sits below items, terms and balance. | `S/orders/[orderId]/page.tsx:572`, `:690` | Sending first; Refund and Cancel open from buttons | · |

### H9 Help users recover from errors

| Sev | Problem | Evidence | Fix | |
|---|---|---|---|---|
| 1 | Some errors give an owner no way forward: *its settings key is missing*, *not set up on this server*. | `M/gift-cards.en.ts:143`; `M/builder.en.ts:1112` | Say who can fix it and how | · |

### H10 Help and documentation

| Sev | Problem | Evidence | Fix | |
|---|---|---|---|---|
| 2 | No admin page links to the owners' docs (14 sections of articles at `content/docs/owners`); the shell has no Help. | No `docsPath(` call in `src/app/admin` or `src/components/admin` | `PageHeader.help` to the page's article (`admin:` in each article's front matter already names its page); Help in the account menu | ✓ |

## 4. Phase 0: built with this audit

- **Basic and Advanced views** (`src/lib/admin-view.ts`, `C/admin-view.tsx`). Basic is every account's default and lists each section's
  everyday pages: 40 of 104, about 28 for a store with only the shop on. Advanced lists everything. The switch, **Basic | Advanced**, sits in
  the top bar beside the AI manager, at the foot of the phone's menu and on Your account; the choice is kept on the account
  (`accounts.admin_view`) and the navigation follows it at once, without a reload.
- **Help while in Basic.** The foot of every section's sidebar and of the Settings and Website pages of cards says *"{n} more in Advanced
  view. It shows the pages most owners use every day. Can't find what you're looking for? Switch to Advanced view to see every page and
  setting."* with a button that switches. Home, which has no sidebar, says it too. Nothing is said in Advanced.
- **Basic hides links, never pages.** Any page still opens from a link (Home, the setup checklist, notices, the AI manager), and its sidebar
  then lists it, marked, so nobody is somewhere the navigation does not admit to.
- **Icons beside every page** in every sidebar and on every card, at all three levels (lucide, at the hand-drawn sections' stroke).
- **The rail's names** show by default on screens 1280 px and wider; narrowing it is remembered.
- **Settings' cog** is a cog.
- **An owner's article**, *Find your way around the admin* (`content/docs/owners/getting-started/find-your-way.*.md`).

Which pages are Basic, section by section (a page behind a feature shows only when the feature is on):

| Section | Basic | In Advanced only |
|---|---|---|
| Orders | Orders, Returns, Subscriptions, Subscription boxes | Draft orders, Invoices, Emails |
| Products | Products, Gift cards, Reviews | Inventory, Product layouts, Custom fields |
| Customers | Customers, Companies, Privacy requests | Customer groups, Price lists, Wishlists |
| Marketing | Campaigns, Coupons, Broadcasts, Bonus credits, Referral program | A/B tests, Email automations, Segments, Ads and conversions, Product feeds, Subscribers, Cart reminders, Recommendations, Creators |
| Analytics | Overview, Payouts | Live, Finance, Reports, VAT, Customers, Products, Inventory, Marketing, Subscriptions, Traffic, Speed, Analytics settings |
| Website | Pages, Blog, Media, Menus, Design, Translate the store | Blogs, Blog comments, Content, Redirects, Headers, Footers, Staging |
| Bookings | Calendar, Staff and hours, Stays and rentals, Rooms and items | Hosts |
| Support | Inbox, Requests | Reports, Saved replies, Chat assistant, Settings |
| Settings | Company, Domains, Countries, Features, Payments, Shipping, Legal pages, Tax, Header and footer, Billing, Team | Moving in, Languages and currencies, Close store, Orders, Notifications, Checkout rules, Prices and quantity, Workflows, Automation, Returns, Duties and import VAT, Invoicing, Producer responsibility, Integrations, SEO & Reach, Private mode, Cookies and tracking, Accessibility, Search, AI, Apps and API, Activity log |

The choice of Basic is a first guess from what an owner does in a week. Phase 4 measures it (which Advanced pages people in Basic open
through links, what they search for in the finder) and moves pages in or out.

Every account starts in Basic, those that used the admin before too, as asked. The switch is on every page and the hint says where to find
the rest, so nobody is stuck; anyone who prefers everything presses Advanced once.

## 5. The plan

Each phase is shippable on its own. Effort: S under a day, M a few days, L a week or more.

### Phase 1: safety and finding (next)

What protects money and data first, then the finder that makes Basic safe to rely on.

| Item | Heuristic | Effort |
|---|---|---|
| Confirm before Refund (with the amount), Remove access, Disconnect Mollie; a real confirm for automation rules; `ui/ConfirmButton` for every permanent delete | H5, H3 | M |
| Discount and campaign dates in the store's time zone | H2 | S |
| *Saved* clears on edit, *Not saved* shows; one leave guard for every editor | H1 | M |
| **Go to…**: a page finder on ⌘K over `ADMIN_PAGES` (titles, the words people use, tasks), Advanced pages included and marked; the AI manager keeps its button and moves to ⌘J; the Basic hint gains *or search with ⌘K* | H7, H6 | M |
| Search, filters and paging on Products | H7 | M |
| The section's name as every page's eyebrow | H1 | S |
| Home: setup checklist first until done; no store name in its own attention lines | H8 | S |
| One date formatter in the store's zone | H2 | S |
| Group headings: one eyebrow style | H4 | S |

### Phase 2: one name, one place

The information architecture: chunk what is left, and stop the same word opening two doors.

| Item | Heuristic | Effort |
|---|---|---|
| Settings that belong to a section move into it: Orders' and Returns' settings, Notifications (Orders), Checkout rules and Prices (Products or a Checkout group), Search (Website) | H4, H6 | L |
| Discounts: Campaigns and Coupons become one *Discounts* page with *Automatic* and *Code* | H4 | M |
| Workflows and Automation become one *Automations* (with Email automations beside it, under Marketing) | H4 | M |
| *Header and footer* settings join Website's Headers and Footers | H4 | S |
| Marketing in groups: Discounts, Email, Channels (ads, feeds, creators), Loyalty (bonus, referrals); Analytics in groups: Money, Customers and products, The site; Website in groups: Content, Look, Structure | H8 | S |
| A Marketing home with its three everyday jobs | H6 | M |
| *Chat assistant* everywhere; *Web address* never *handle*; plain words before CAC and ROAS | H4, H2 | S |
| On phones, the sections as a row of icons above the section's pages | H8 | M |

Each move keeps the old address as a redirect and its `ADMIN_PAGES` entry, so links, the AI manager and bookmarks keep working.

### Phase 3: Homer's page, Lisa's fold

The house rule applied page by page: the obvious action first, the depth behind *More options*.

| Item | Heuristic | Effort |
|---|---|---|
| Discount and campaign editors: code, amount and dates; the rest folded | H8 | M |
| Order page: Sending first; Refund and Cancel open from buttons | H8 | M |
| Payments: the status first, the rest under *More ways to pay*; AI: the own-provider form only on request; IOSS only where it applies | H8 | M |
| Analytics' period: one control | H4 | S |
| `PageHeader.help` linking each page to its article; Help in the account menu | H10 | M |
| Page actions in `PageHeader.actions`; status as chips; a lint rule for hand-made pills | H4 | M |
| ⌘S on every form with a save button | H7 | S |

### Phase 4: measure and tune

| Item | Effort |
|---|---|
| Count, per page, how often people in Basic open an Advanced page through a link, and what they search for and do not find in *Go to…*; move pages in or out of Basic from it | M |
| Five owners per round, five tasks each (add a product, make a discount code, refund an order, change shipping, find the VAT report), in Basic, before and after phases 1 and 2: task success, time and the System Usability Scale | M per round |
| Generate `docs/admin-navigation.md`'s tables from the navigation data, as `pnpm parity:write` does | S |

## 6. Rules for what comes next

- A new store page has an `icon` and says `basic: true` only if most owners use it every week (`store-nav.test.ts` keeps Basic under
  half the pages and at most 12 a section).
- One name for one thing, in the menu, on the page and in the AI manager.
- A page's first screen has one main action. Options most owners never touch go under *More options*.
- Money that leaves, access that is taken away and data that is deleted are confirmed, naming what happens.

## 7. Worth keeping

- **The orders list**: filters held in the address, saved views, bulk actions that confirm and report what happened
  (`C/orders/order-table.tsx`).
- **The product editor**: an Advanced fold, a leave guard, a sticky save bar, *Saved · See in store*, and an error summary that takes focus.
- **Bulk product edits with Undo** (`C/products-bulk.tsx`).
- **`ActionForm`**: keeps what was typed, marks the failing field and moves focus to it.
- **Features**: switching one off says what disappears and what stops it (`C/features-view.tsx`).
- **Media**: deleting shows where a file is used.
- **Closing a store**: type its address, and have signed in recently.
- **Plain words** in most places: *address* for slug, OSS and IOSS spelled out, Web Vitals named for what they measure.
- **Empty states** that give a next step, and Analytics' sections that load one by one with labelled placeholders.
- **The shell**: `?` lists the keyboard shortcuts on every page; a skip link; the level switcher in one place on every page.
