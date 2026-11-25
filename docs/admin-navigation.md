# The admin's three levels and how they connect (D107)

Kaizen's admin has three levels, for three different jobs. They share one
shell, so moving between them feels like one product.

| Level | Who | Job | Address |
|---|---|---|---|
| **Platform** | Kaizen's team | Run Kaizen: who asks for access, stores, plans, Kaizen's own site, its AI | `/admin/platform/…` |
| **Control center** | A store owner | Run the business: every store they own at a glance, what needs them, money, AI use, their account | `/admin`, `/admin/stores`, `/admin/account/…` |
| **Store** | An owner or staff member | Run one store: orders, products, pages, settings | `/admin/{store}/…` |

Outside hosts (D71) have a small area of their own, `/admin/hosting/…`, with
the same shell.

The tables of each level's tabs, and of every page under *Every page* at the foot, are written from the menu's own data by
`pnpm nav:write` (D885); the words around them are written by hand (*Rules for changes*).

## One shell

Every level is drawn by `AdminFrame` (`src/components/admin/admin-frame.tsx`):

- **A header that hides while scrolling down.** On the left the *level
  switcher* (below), on the right the level's own actions (the AI manager
  where there is one, "View store" or "View site") and the *account menu*.
- **Tabs** along the header: the level's daily sections.
- **A sidebar** for everything else, in groups under headings. On phones it
  is the slide-out menu, which also holds the tabs.
- **A main area** with a sensible width; editors use the whole width.

Changing how a level looks or navigates means changing its layout's
`tabs` and `groups`, nothing else.

## The level switcher

The first thing in every header. It shows where you are (`Kaizen · Platform`,
`Kaizen · Control center`, or the store's name under a `Kaizen` link) and
opens a menu that reaches everywhere you may go:

1. **Control center**, for owners.
2. **Your stores**, each with its status, the current one marked.
3. **Platform**, for Kaizen's team, with the number of requests waiting.
4. **Your account**, **AI usage**, **Billing**.

Because the switcher is in the same place on every page, nobody needs to
remember a URL: the control center is one click from any store, and any store
is one click from the control center.

## Landing

- An owner lands on the **control center**, also with a single store: it is
  the place to see how the business is doing, and the store is one click
  away. (Before, a single store was opened at once, which hid the level.)
- Staff who own nothing, with one store, go straight to it.
- A platform admin with no store of their own lands on the platform.
- An outside host lands on their hosting.

## Platform

The platform (D144) uses the whole width of the screen. Its tabs carry an icon and each section has a sidebar of its
own, or none. Access requests and Support show the number waiting. Settings' six groups (D884) and every page are under
*Every page*.

<!-- nav:generated:start platform-tabs -->

| Tab | Icon | Opens | Sidebar |
| --- | --- | --- | --- |
| Home | `home` | `/admin/platform`; also `/admin/platform/assistant` | none |
| Website | `monitor` | `/admin/platform/website`, its own page | 13 pages, 6 in Basic |
| Themes | `palette` | `/admin/platform/themes` | none |
| Stores | `shopping-bag` | `/admin/platform/stores` | none |
| Customers | `users` | `/admin/platform/customers` | none |
| Plans | `credit-card` | `/admin/platform/plans` | 9 pages, 4 in Basic |
| Access requests | `bell` | `/admin/platform/requests` | none |
| Support | `chat` | `/admin/platform/support` | 7 pages, 3 in Basic |
| Settings | `cog` | `/admin/platform/settings`, its own page | 28 pages in 6 groups, 11 in Basic |

57 pages in 4 sidebars, 24 of them in Basic.

<!-- nav:generated:end platform-tabs -->

Website and Settings open on a page of cards, one for each page in the sidebar; Settings' cards are in its six groups. The AI manager is opened from the
header's button, not a tab; its page is Home's. The sections, their items and what each does are one structure,
`PLATFORM_SECTIONS` in `src/lib/platform-nav.ts` (D877), from which the tabs and their counts, the sidebars, the hub pages and
every page's permission area are derived; a test fails when a platform page folder is in no section and not Home's, or a
sidebar item is not in the admin map. A section's tab is marked for every page inside it, the deepest match (D873); the
sidebar is chosen by the page's address (`NavArea`, `AreaSidebar`), and the phone's menu shows the tabs and the sidebar of
the section being viewed. A platform page's group in the admin map is its tab (`platformSectionOf()`, D881).

The home page is the operator's first look: requests waiting, stores by state,
plans, emails that failed, AI use, each with the page to act on.

## Control center

The control center is the owner's level's Home; the level's tabs are under *Store owner* below. The overview is an operational bird's-eye view of every store the owner owns:

1. **Needs your attention**: what to do first, across stores, each with a link
   to the page that does it (orders late to send, stock running out, plan
   overdue, payments not on, a store not open yet).
2. **The business in numbers**: sales, orders and orders to send over the last
   7 days across all stores, per currency, with the change on the week
   before; AI use.
3. **Your stores**: a card each with its status, plan, payments, sales this
   week, orders to send, low stock, and direct links (Open, Orders,
   Products, AI manager).
4. **Latest orders** across all stores.

Everything on it is counted in code from the stores' own data (D94):
`controlCenter()` in `src/server/control-center.ts` reads all the stores in one
statement and everything else in one wave after it, one statement per set of
stores a figure is counted for (16 statements in 2 waves for one store's Home,
held in `control-center.int.test.ts`; bloat review step 2.32), and
`src/lib/control-center.ts` decides what needs
attention (`attentionFor()`), adds sales per currency (never across
currencies) and words the change on the week before. "The last 7 days" are the
7 days up to now, against the 7 before.

**Billing** (`/admin/account/billing`) puts the plans of every owned store in
one list: what each costs, whether it is paid, when it renews, the fee on its
sales, and a link to the store's own billing, where the plan is changed.
Someone who only works in stores (staff) sees Stores and Account, and Support, Books and Work where a store gives them those.

## Store owner

The owner's level (D147) is the same shape: tabs with icons, the whole width, and `src/lib/owner-nav.ts` as its data.
Only Account has a sidebar, in three groups (`ACCOUNT_GROUPS`, D884), each page with its icon; Work has its own sub-navigation, and
Support shows the number waiting. The owners' pages are only for owners, Your domains for a domain's holder too; staff see Account
without the owners' pages. Account's pages are under *Every page*.

<!-- nav:generated:start owner-tabs -->

| Tab | Icon | Opens | Sidebar | Only for |
| --- | --- | --- | --- | --- |
| Home | `home` | `/admin` | none | owners |
| Stores | `shopping-bag` | `/admin/stores` | none |  |
| Support | `chat` | `/admin/account/support` | none | people who may read a store's support |
| Books | `book-open` | `/admin/account/books` | none | people who keep a store's books |
| Work | `briefcase` | `/admin/account/work` | none | people with Work in a store |
| Account | `user` | `/admin/account` | 15 pages in 3 groups, 5 in Basic |  |

<!-- nav:generated:end owner-tabs -->

## Store

The store (D147) is built like the platform: the whole width of the screen, tabs with an icon, and a sidebar for each
section that has pages of its own. The AI manager is in the header (owners), not a tab. Sections and their pages are data
in `src/lib/store-nav.ts`; the layout, the hub pages and the tests read from it. Home is the store's week and its setup
checklist (the setup steps and the AI manager's page are Home's); Support shows the number of conversations waiting. A section or
page that needs a feature (D178) or a paid extension (D748) is in the menu only while the store has it.

<!-- nav:generated:start store-tabs -->

| Tab | Icon | Opens | Sidebar | Needs |
| --- | --- | --- | --- | --- |
| Home | `home` | `/admin/{store}`; also `/admin/{store}/setup`, `/admin/{store}/assistant` | none |  |
| Orders | `package` | `/admin/{store}/orders` | 7 pages, 4 in Basic | Online shop |
| Products | `tag` | `/admin/{store}/products` | 6 pages, 3 in Basic |  |
| Customers | `users` | `/admin/{store}/customers` | 10 pages, 6 in Basic |  |
| Marketing | `megaphone` | `/admin/{store}/marketing`, its own page | 15 pages in 5 groups, 4 in Basic |  |
| Analytics | `chart` | `/admin/{store}/analytics` | 18 pages in 4 groups, 2 in Basic |  |
| Website | `monitor` | `/admin/{store}/website`, its own page | 15 pages in 3 groups, 8 in Basic |  |
| Bookings | `calendar` | `/admin/{store}/bookings` | 5 pages, 4 in Basic | Appointments or Stays and rentals |
| Support | `chat` | `/admin/{store}/support` | 7 pages, 3 in Basic |  |
| Settings | `cog` | `/admin/{store}/settings`, its own page | 36 pages in 5 groups, 12 in Basic |  |

119 pages in 9 sections, 46 of them in Basic.

<!-- nav:generated:end store-tabs -->

Website and Settings open on a page of cards, and Marketing on a first page of its own (D612): the tables' *its own page*,
the section's `hub`. The others open on their main page. Discounts has two tabs, Codes and Automatic (`?tab=automatic`,
where `/campaigns` leads). A page's address does not say its section: Design is `/settings/design` but the Website's,
Shipping and Payments are `/settings/…` and Settings'. A tab with a page of its own marks only itself and the pages in its
sidebar, so Design marks Website and not Settings. The admin map's `group` for a store page is its section
(`sectionOf()`), so the AI manager guides by the tabs people see.

## A page's name (D881)

The menu is the one source of a page's name at all three levels. The admin map (`ADMIN_PAGES`) writes no section and no menu
word of its own: each page's group is the section whose tab the frame marks on its address (`sectionOf()`, `platformSectionOf()`,
`ownerSectionOf()`), and a page in the menu carries the menu's word (`navLabel`). The page finder, the AI manager and the docs name
a page by that word, so renaming a menu item renames the page everywhere. The section above a page's title (D873) is the same
section. Five titles stay fuller than their menu word (Analytics for Overview, the VAT, OSS and IOSS reports for VAT, Plans for
Editor, Stores' support for Stores, Control center for Home), listed with their reasons in `src/lib/page-names.test.ts`.

## Basic and Advanced (D454, D884)

Every level lists each section's everyday pages in **Basic**, every account's default, and every page in **Advanced**
(`src/lib/admin-view.ts`, the audit behind it in `docs/audits/admin-usability-2026-11.md`): a store since D454, the platform and the
owner's level since D884. The switch, **Basic | Advanced**, is in the top bar beside the page finder (icons only below 1280 px), at the
foot of the phone's menu and on Your account; the choice is kept on the account, one for every level, so it follows the person from a
store to the platform and back, and the sidebar follows it at once.

- A page is in Basic when its item says `basic: true` (`StoreItem`, `PlatformItem`, `OwnerItem`), or when its section's tab leads to it
  (`advancedIn()`). In a store about two in five are (45 of the 115 pages on 17 November 2026; Settings 11 of 33 when D454 was built); on
  the platform 24 of 57 (Website 6, Plans 4, Support 3, Settings 11, one in each of its groups); in Account 5 of 15. Each level's table of
  tabs counts them as the menu stands.
- Basic hides links, never pages. A link from Home, the setup checklist, a notice or the AI manager opens any page, and its sidebar then
  lists it where it lives, marked as the page being viewed.
- While Basic is on, the foot of each sidebar and a store's Home say how many more pages Advanced has here, that it
  is where to look when something is missing, and switch with one press. The pages of cards list every page in either view (D597, D603).

Every page in a sidebar and on a page of cards has an icon beside its name (`icon`, drawn by `NavIcon`), at all three levels. The rail
shows its sections' names on screens 1280 px and wider until the person narrows it.

## What the admin fetches ahead

The rail, the store menu, the store switcher and account menu, back links, buttons that are links and the rows of a list are
`AdminLink` (`src/components/admin/ui/link.tsx`, on `PolicyLink`): a link's page is fetched when the pointer, a touch or the
keyboard focus reaches it, never because it is in view. View store and links to files are never fetched. A press by touch or
keyboard shows the pending bar (`LinkPending`) for one round trip before the skeleton. `e2e/signed-in/prefetch.spec.ts` holds
eight screens (bloat review step 0.13).

## Rules for changes

- A new page goes in exactly one section of its level (`platform-nav.ts`, `store-nav.ts`, `owner-nav.ts`), and in
  `ADMIN_PAGES` (`src/lib/admin-map.ts`), so the AI manager can guide to it. Its section and menu word come from the
  navigation; its title is the menu's word (D881). It has an `icon`; a store page says `basic: true` only
  if most owners use it every week (D454).
- This file's tables are the menu's (D885): after changing a level's nav file, run `pnpm nav:write` and commit this file with
  the change. `src/lib/admin-navigation.test.ts` fails in CI while a table differs (`pnpm nav:check` says the same locally);
  never edit between the `nav:generated` markers, and correct the words around them by hand when they no longer fit.
- A level's own pages check who is asking themselves (`requirePlatformAdmin()`,
  `requireAccount()`, `requireMember()`): a layout's check redirects only
  after its pages have started to be sent.
- One word per thing (ecosystem plan E3.7, D718): no two places of a store's menu share a name in any language, unless they open the
  same page (a section's tab and its main page), and a name the owner's or the platform's menu shares with a store's means the same thing
  at that level (Website, Support, Discounts), listed with its reason in `src/lib/nav-labels.scan.test.ts`. So Analytics' pages are
  Customer analytics and Product analytics, Support's are Support reports and Support settings, Settings' Order settings and Return
  settings; the audit log is the Change log; the platform's are Access requests, Content notices and VAT rates.
- No new top-level `/admin/{word}` for owners' pages: `/admin/{store}` takes
  every other first segment, so a new word reserves a store address. Owner
  pages go under `/admin/account/…`.

## Every page

Each section's sidebar at the three levels, in the menu's order: the group (named on its first page), the page's label and address, the
view that lists it (Basic, or Advanced only: D454, D884; a section's tab always leads to a Basic page) and what it needs. A store's page
needs a feature (D178; one of those named is enough) or a paid extension (D748), and a few only customers' stores have; at the owner's
level a page or tab may be only for some people. A section's own needs are its pages' too.

<!-- nav:generated:start platform-pages -->

### Platform › Website

Opens `/admin/platform/website`, its own page. Also inside it: `/admin/platform/docs`. 13 pages, 6 in Basic.

| Group | Page | Address | View |
| --- | --- | --- | --- |
| Website | Pages | `/admin/platform/pages` | Basic |
|  | Blog | `/admin/platform/articles` | Basic |
|  | Content | `/admin/platform/content` | Advanced |
|  | Media | `/admin/platform/media` | Basic |
|  | Templates | `/admin/platform/templates` | Advanced |
|  | Menus | `/admin/platform/menus` | Basic |
|  | Forms | `/admin/platform/forms` | Basic |
|  | Headers | `/admin/platform/headers` | Advanced |
|  | Footers | `/admin/platform/footers` | Advanced |
|  | Fonts | `/admin/platform/fonts` | Advanced |
|  | Design | `/admin/platform/site-design` | Basic |
|  | Docs feedback | `/admin/platform/docs/feedback` | Advanced |
|  | Docs guide | `/admin/platform/docs/guide` | Advanced |

### Platform › Plans

Opens `/admin/platform/plans`. 9 pages, 4 in Basic.

| Group | Page | Address | View |
| --- | --- | --- | --- |
| Plans | Editor | `/admin/platform/plans` | Basic |
|  | Limits | `/admin/platform/plans/limits` | Advanced |
|  | Plan features | `/admin/platform/plans/features` | Advanced |
|  | Extensions | `/admin/platform/plans/extensions` | Advanced |
|  | Accounts | `/admin/platform/plans/accounts` | Basic |
|  | Plan analytics | `/admin/platform/plans/analytics` | Basic |
|  | Reminders | `/admin/platform/plan-reminders` | Advanced |
|  | Discounts | `/admin/platform/discounts` | Basic |
|  | Referrals | `/admin/platform/referrals` | Advanced |

### Platform › Support

Opens `/admin/platform/support`. 7 pages, 3 in Basic.

| Group | Page | Address | View |
| --- | --- | --- | --- |
| Support | Inbox | `/admin/platform/support` | Basic |
|  | Support reports | `/admin/platform/support/reports` | Basic |
|  | Stores | `/admin/platform/support/stores` | Advanced |
|  | Saved replies | `/admin/platform/support/replies` | Advanced |
|  | Chat assistant | `/admin/platform/chat` | Basic |
|  | Website chat | `/admin/platform/support/widgets` | Advanced |
|  | Support settings | `/admin/platform/support/settings` | Advanced |

### Platform › Settings

Opens `/admin/platform/settings`, its own page. 28 pages in 6 groups, 11 in Basic.

| Group | Page | Address | View |
| --- | --- | --- | --- |
| Site | Header and footer | `/admin/platform/navigation` | Basic |
|  | SEO | `/admin/platform/seo` | Advanced |
|  | Cookies | `/admin/platform/cookies` | Advanced |
|  | Google reviews | `/admin/platform/google-reviews` | Advanced |
|  | Instagram | `/admin/platform/instagram` | Advanced |
| Money and tax | Stripe | `/admin/platform/stripe` | Advanced |
|  | VAT rates | `/admin/platform/vat` | Basic |
|  | Duty rates | `/admin/platform/duty-rates` | Advanced |
|  | Domains | `/admin/platform/domains` | Basic |
| AI | AI | `/admin/platform/ai` | Advanced |
|  | AI usage | `/admin/platform/ai/usage` | Basic |
|  | AI prices | `/admin/platform/ai/prices` | Advanced |
|  | 100-day challenge | `/admin/platform/challenges` | Basic |
| Apps and connections | Integrations | `/admin/platform/integrations` | Advanced |
|  | Workflows | `/admin/platform/workflows` | Advanced |
|  | AI assistants and apps | `/admin/platform/oauth` | Advanced |
|  | App listings | `/admin/platform/apps` | Basic |
| Privacy and law | Data retention | `/admin/platform/retention` | Advanced |
|  | Record of processing | `/admin/platform/processing` | Advanced |
|  | Content notices | `/admin/platform/reports` | Basic |
| Running the platform | Status page | `/admin/platform/status` | Basic |
|  | Usage and limits | `/admin/platform/capacity` | Basic |
|  | Emails | `/admin/platform/emails` | Basic |
|  | Languages | `/admin/platform/languages` | Advanced |
|  | A/B tests | `/admin/platform/experiments` | Advanced |
|  | Search test | `/admin/platform/search-test` | Advanced |
|  | Team | `/admin/platform/team` | Basic |
|  | Change log | `/admin/platform/activity` | Advanced |

<!-- nav:generated:end platform-pages -->

<!-- nav:generated:start owner-pages -->

### Owner › Account

Opens `/admin/account`. 15 pages in 3 groups, 5 in Basic.

| Group | Page | Address | View | Only for |
| --- | --- | --- | --- | --- |
| Personal | Your account | `/admin/account` | Basic |  |
|  | Appearance | `/admin/account/appearance` | Advanced |  |
|  | AI manager notices | `/admin/account/notices` | Advanced | owners |
|  | Kaizena Flow support | `/admin/account/kaizen-support` | Basic |  |
| Billing and usage | Your domains | `/admin/account/domains` | Basic | owners or domain holders |
|  | Billing | `/admin/account/billing` | Basic | owners |
|  | Extensions | `/admin/account/extensions` | Advanced | owners |
|  | Add to your account | `/admin/account/add` | Basic | owners |
|  | AI usage | `/admin/account/usage` | Advanced | owners |
|  | Usage and limits | `/admin/account/limits` | Advanced | owners |
|  | Referrals | `/admin/account/referrals` | Advanced | owners |
| Apps and themes | Your themes | `/admin/account/themes` | Advanced |  |
|  | Connected apps and assistants | `/admin/account/connected` | Advanced |  |
|  | Developer | `/admin/account/developer` | Advanced |  |
|  | WordPress | `/admin/account/wordpress` | Advanced | owners |

<!-- nav:generated:end owner-pages -->

<!-- nav:generated:start store-pages -->

### Store › Orders

Opens `/admin/{store}/orders`. Needs: Online shop. 7 pages, 4 in Basic.

| Group | Page | Address | View | Needs |
| --- | --- | --- | --- | --- |
| Orders | Orders | `/admin/{store}/orders` | Basic |  |
|  | Draft orders | `/admin/{store}/orders/drafts` | Advanced |  |
|  | Returns | `/admin/{store}/returns` | Basic |  |
|  | Invoices | `/admin/{store}/invoices` | Advanced |  |
|  | Subscriptions | `/admin/{store}/subscriptions` | Basic | Subscriptions |
|  | Subscription boxes | `/admin/{store}/deliveries` | Basic | Subscription boxes |
|  | Emails | `/admin/{store}/emails` | Advanced |  |

### Store › Products

Opens `/admin/{store}/products`. 6 pages, 3 in Basic.

| Group | Page | Address | View | Needs |
| --- | --- | --- | --- | --- |
| Products | Products | `/admin/{store}/products` | Basic | Online shop |
|  | Inventory | `/admin/{store}/inventory` | Advanced | Online shop |
|  | Gift cards | `/admin/{store}/gift-cards` | Basic | Gift cards |
|  | Reviews | `/admin/{store}/reviews` | Basic | Product reviews |
|  | Product layouts | `/admin/{store}/product-layouts` | Advanced | Online shop |
|  | Custom fields | `/admin/{store}/fields` | Advanced |  |

### Store › Customers

Opens `/admin/{store}/customers`. 10 pages, 6 in Basic.

| Group | Page | Address | View | Needs |
| --- | --- | --- | --- | --- |
| Customers | Customers | `/admin/{store}/customers` | Basic | Online shop or Deals |
|  | Customer groups | `/admin/{store}/customer-groups` | Advanced | Online shop |
|  | Price lists | `/admin/{store}/price-lists` | Advanced | Online shop |
|  | Companies | `/admin/{store}/companies` | Basic | Sell to businesses |
|  | Deals | `/admin/{store}/deals` | Basic | Deals; the Deals and contracts extension |
|  | Contracts | `/admin/{store}/deals/contracts` | Basic | Deals; the Deals and contracts extension |
|  | Leads | `/admin/{store}/leads` | Basic | Deals; the Deals and contracts extension |
|  | Find companies | `/admin/{store}/companies/find` | Advanced |  |
|  | Wishlists | `/admin/{store}/wishlists` | Advanced | Online shop |
|  | Privacy requests | `/admin/{store}/privacy` | Basic |  |

### Store › Marketing

Opens `/admin/{store}/marketing`, its own page. 15 pages in 5 groups, 4 in Basic.

| Group | Page | Address | View | Needs |
| --- | --- | --- | --- | --- |
| Discounts | Discounts | `/admin/{store}/discounts`, also `/admin/{store}/campaigns` | Basic | Online shop |
| Email | Broadcasts | `/admin/{store}/broadcasts` | Basic | the Email automation extension |
|  | Email automations | `/admin/{store}/automations` | Advanced | the Email automation extension |
|  | Flows | `/admin/{store}/flows` | Advanced | the Email automation extension |
|  | Text messages | `/admin/{store}/text-messages` | Advanced |  |
|  | Cart reminders | `/admin/{store}/cart-reminders` | Advanced | Online shop |
|  | Subscribers | `/admin/{store}/subscribers` | Advanced |  |
|  | Segments | `/admin/{store}/segments` | Advanced | the Email automation extension |
| Channels | Ads and conversions | `/admin/{store}/ads` | Advanced |  |
|  | Product feeds | `/admin/{store}/feeds` | Advanced |  |
|  | Creators | `/admin/{store}/creators` | Advanced | Online shop |
| Loyalty | Bonus credits | `/admin/{store}/bonus` | Basic | Bonus program |
|  | Refer a friend | `/admin/{store}/affiliates` | Basic | Referral program |
| On the site | Recommendations | `/admin/{store}/recommendations` | Advanced | Online shop |
|  | A/B tests | `/admin/{store}/experiments` | Advanced | the A/B testing extension |

### Store › Analytics

Opens `/admin/{store}/analytics`. 18 pages in 4 groups, 2 in Basic.

| Group | Page | Address | View | Needs |
| --- | --- | --- | --- | --- |
| Overview | Overview | `/admin/{store}/analytics` | Basic | Online shop |
|  | Live | `/admin/{store}/analytics/live` | Advanced | Online shop |
|  | Reports | `/admin/{store}/analytics/reports` | Advanced | Online shop |
| Money | Finance | `/admin/{store}/analytics/finance` | Advanced | Online shop |
|  | Payouts | `/admin/{store}/analytics/payouts` | Basic | Online shop |
|  | VAT | `/admin/{store}/analytics/tax` | Advanced | Online shop |
|  | Subscription analytics | `/admin/{store}/analytics/subscriptions` | Advanced | Subscriptions |
| Customers and products | Customer analytics | `/admin/{store}/analytics/customers` | Advanced | Online shop |
|  | Product analytics | `/admin/{store}/analytics/products` | Advanced | Online shop |
|  | Inventory analytics | `/admin/{store}/analytics/inventory` | Advanced | Online shop |
|  | Marketing analytics | `/admin/{store}/analytics/marketing` | Advanced | Online shop |
|  | Sales | `/admin/{store}/analytics/sales` | Advanced | Deals; the Deals and contracts extension |
| The site | Traffic | `/admin/{store}/analytics/traffic` | Advanced |  |
|  | Speed | `/admin/{store}/analytics/speed` | Advanced |  |
|  | Heatmaps | `/admin/{store}/analytics/heatmaps` | Advanced |  |
|  | Recordings | `/admin/{store}/analytics/recordings` | Advanced |  |
|  | Visiting companies | `/admin/{store}/analytics/companies` | Advanced |  |
|  | Analytics settings | `/admin/{store}/analytics/settings` | Advanced |  |

### Store › Website

Opens `/admin/{store}/website`, its own page. 15 pages in 3 groups, 8 in Basic.

| Group | Page | Address | View | Needs |
| --- | --- | --- | --- | --- |
| Content | Dream Factory | `/admin/{store}/dream-factory` | Basic |  |
|  | Pages | `/admin/{store}/pages` | Basic |  |
|  | Blog | `/admin/{store}/articles` | Basic |  |
|  | Blogs | `/admin/{store}/articles/blogs` | Advanced |  |
|  | Blog comments | `/admin/{store}/articles/comments` | Advanced |  |
|  | Content | `/admin/{store}/content` | Advanced |  |
|  | Media | `/admin/{store}/media` | Basic |  |
|  | Forms | `/admin/{store}/forms` | Basic |  |
| Look | Design | `/admin/{store}/settings/design` | Basic |  |
|  | Headers | `/admin/{store}/headers` | Advanced |  |
|  | Footers | `/admin/{store}/footers` | Advanced |  |
| Structure | Menus | `/admin/{store}/menus` | Basic |  |
|  | Redirects | `/admin/{store}/redirects` | Advanced |  |
|  | Staging | `/admin/{store}/staging` | Advanced |  |
|  | Translate the store | `/admin/{store}/translate` | Basic | Several languages or Several countries |

### Store › Bookings

Opens `/admin/{store}/bookings`. Needs: Appointments or Stays and rentals. 5 pages, 4 in Basic.

| Group | Page | Address | View | Needs |
| --- | --- | --- | --- | --- |
| Bookings | Calendar | `/admin/{store}/bookings` | Basic | Appointments or Stays and rentals |
|  | Staff and hours | `/admin/{store}/bookings/staff` | Basic | Appointments |
|  | Stays and rentals | `/admin/{store}/bookings/stays` | Basic | Stays and rentals |
|  | Rooms and items | `/admin/{store}/bookings/units` | Basic | Stays and rentals |
|  | Hosts | `/admin/{store}/hosts` | Advanced | Stays and rentals |

### Store › Support

Opens `/admin/{store}/support`. 7 pages, 3 in Basic.

| Group | Page | Address | View | Needs |
| --- | --- | --- | --- | --- |
| Support | Inbox | `/admin/{store}/support` | Basic | the AI support desk extension |
|  | Requests | `/admin/{store}/support/requests` | Basic | the AI support desk extension |
|  | Support reports | `/admin/{store}/support/reports` | Advanced | the AI support desk extension |
|  | Saved replies | `/admin/{store}/support/replies` | Advanced | the AI support desk extension |
|  | Chat assistant | `/admin/{store}/chat` | Advanced |  |
|  | Website chat | `/admin/{store}/support/widgets` | Basic | the AI support desk extension |
|  | Support settings | `/admin/{store}/support/settings` | Advanced | the AI support desk extension |

### Store › Settings

Opens `/admin/{store}/settings`, its own page. 36 pages in 5 groups, 12 in Basic.

| Group | Page | Address | View | Needs |
| --- | --- | --- | --- | --- |
| Store | Company | `/admin/{store}/settings/company` | Basic |  |
|  | Books | `/admin/{store}/settings/books` | Advanced | the Work extension |
|  | Domains | `/admin/{store}/settings/domains` | Basic |  |
|  | Moving in | `/admin/{store}/settings/moving` | Advanced |  |
|  | Countries | `/admin/{store}/settings/countries` | Basic |  |
|  | Languages and currencies | `/admin/{store}/settings/localization` | Advanced |  |
|  | Features | `/admin/{store}/settings/features` | Basic |  |
|  | Close store | `/admin/{store}/settings/close` | Advanced | not Kaizena Flow's own store |
| Selling | Payments | `/admin/{store}/settings/payments` | Basic | Online shop |
|  | Shipping | `/admin/{store}/settings/shipping` | Basic | Online shop |
|  | Product settings | `/admin/{store}/settings/products` | Advanced | Online shop |
|  | Order settings | `/admin/{store}/settings/orders` | Advanced | Online shop |
|  | Notifications | `/admin/{store}/settings/notifications` | Advanced | Online shop |
|  | Checkout rules | `/admin/{store}/settings/checkout` | Advanced | Online shop |
|  | Prices and quantity | `/admin/{store}/settings/prices` | Advanced | Online shop |
|  | Automatic | `/admin/{store}/settings/automatic` | Basic |  |
|  | Workflows | `/admin/{store}/settings/workflows` | Advanced |  |
|  | Automation | `/admin/{store}/settings/automation` | Advanced | Online shop |
|  | Return settings | `/admin/{store}/settings/returns` | Advanced | Online shop |
|  | Legal pages | `/admin/{store}/settings/legal` | Basic |  |
|  | Tax | `/admin/{store}/settings/tax` | Basic | Online shop |
|  | Duties and import VAT | `/admin/{store}/settings/customs` | Advanced | Online shop |
|  | Invoicing | `/admin/{store}/settings/invoices` | Advanced | Online shop |
|  | Producer responsibility | `/admin/{store}/settings/producer-responsibility` | Advanced | Online shop |
|  | Integrations | `/admin/{store}/integrations` | Advanced |  |
| Site | Header and footer | `/admin/{store}/settings/navigation` | Basic |  |
|  | SEO & Reach | `/admin/{store}/settings/seo` | Advanced |  |
|  | Private mode | `/admin/{store}/settings/private` | Advanced |  |
|  | Cookies and tracking | `/admin/{store}/settings/cookies` | Advanced |  |
|  | Accessibility | `/admin/{store}/settings/accessibility` | Advanced |  |
| Tools | Search | `/admin/{store}/search` | Advanced | Online shop |
|  | AI | `/admin/{store}/settings/ai` | Advanced |  |
|  | Apps and API | `/admin/{store}/settings/api` | Advanced |  |
| Account | Billing | `/admin/{store}/billing` | Basic | not Kaizena Flow's own store |
|  | Team | `/admin/{store}/staff` | Basic |  |
|  | Change log | `/admin/{store}/activity` | Advanced |  |

<!-- nav:generated:end store-pages -->
