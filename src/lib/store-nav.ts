/**
 * A store admin's sections (D147), pure data for its layout, its hub pages and the tests that keep them in step with the
 * admin map, built like the platform's (D144): each section is a tab with an icon and, where it has pages of its own, a
 * sidebar; Home has none. Website and Settings open on a page of cards (their hub), the others on their main page.
 */

import type { NavIconName } from "@/components/admin/nav-icons";

import { requirementMet, type FeatureRequirement, type FeatureSource } from "./store-features";

/**
 * What the navigation is filtered by: the store's features (D178), as kept (`store.features`); a page or section behind a feature is offered
 * only while it is on (`requirementMet()`: kept on with everything it needs).
 */
export type StoreFlags = FeatureSource;

/**
 * A page in a sidebar: its address after the store's, its label, and a line on what it is for (the hub's card). `feature` is the store
 * feature (D178) it stands behind: one, or several of which any is enough; the same as its `ADMIN_PAGES` entry's (a test holds them).
 */
export type StoreItem = { path: string; label: string; description: string; exact?: boolean; feature?: FeatureRequirement };
export type StoreGroup = { heading: string; items: StoreItem[] };

export type StoreSection = {
  key: "orders" | "products" | "customers" | "marketing" | "analytics" | "website" | "bookings" | "support" | "settings";
  label: string;
  icon: NavIconName;
  /** The tab's address after the store's: the section's main page, or its hub. */
  start: string;
  /** A page of cards instead of a main page; the section's sidebar leads to the same pages. */
  hub: boolean;
  intro: string;
  feature?: FeatureRequirement;
  groups: StoreGroup[];
};

const item = (path: string, label: string, description: string, extra: Partial<StoreItem> = {}): StoreItem => ({ path, label, description, ...extra });

export const STORE_SECTIONS: StoreSection[] = [
  {
    key: "orders",
    label: "Orders",
    icon: "package",
    start: "/orders",
    hub: false,
    // The online shop's (D178 step 5): while it is off, the orders, returns and invoices stay reachable (not in the menu) as long as an order
    // can still be withdrawn from or returned (`AFTER_SALE_ADMIN_PATHS`).
    feature: "shop",
    intro: "Everything that is bought: orders, returns and withdrawals, subscriptions and the emails the store sent about them.",
    groups: [
      {
        heading: "Orders",
        items: [
          item("/orders", "Orders", "Every order: search and filter them, save views, tag, archive, send and print in bulk, open one to fulfil or refund it."),
          item("/orders/drafts", "Draft orders", "Orders you make for a customer: products, custom items and prices, a discount and shipping, sent as a pay link or recorded as paid outside Kaizena Flow."),
          item("/returns", "Returns", "Customers' withdrawals and return requests: approve, receive, inspect and refund them in time."),
          item("/invoices", "Invoices", "Invoices and credit notes for orders, the orders waiting for one, and a CSV for the accountant."),
          item("/subscriptions", "Subscriptions", "Customers' recurring subscriptions and their payments.", { feature: "subscriptions" }),
          item("/deliveries", "Subscription boxes", "Weekly delivery days, cutoffs, and the lists customers have set up.", { feature: "boxes" }),
          item("/emails", "Emails", "Every email the store sent to customers and staff, and whether it arrived."),
        ],
      },
    ],
  },
  {
    key: "products",
    label: "Products",
    icon: "tag",
    start: "/products",
    hub: false,
    intro: "What the store sells: the products, how their pages look and what more is said about them.",
    groups: [
      {
        heading: "Products",
        items: [
          item("/products", "Products", "The catalogue: prices, stock, variants, pictures, categories and tags.", { feature: "shop" }),
          item("/inventory", "Inventory", "Stock for each variant and location: on hand, held by checkouts and owed on backorder, with counts, adjustments with a reason, history and files.", { feature: "shop" }),
          item("/gift-cards", "Gift cards", "Cards customers buy or you issue: what they hold, each card's history, issuing and changing one.", { feature: "gift_cards" }),
          item("/reviews", "Reviews", "What buyers say about your products: check new reviews, publish or hide them and answer.", { feature: "reviews" }),
          item("/product-layouts", "Product layouts", "How a product's page is laid out, for all products, a category, a tag or one product.", { feature: "shop" }),
          item("/fields", "Custom fields", "Your own groups of fields for products, pages, customers and more."),
        ],
      },
    ],
  },
  {
    key: "customers",
    label: "Customers",
    icon: "users",
    start: "/customers",
    hub: false,
    intro: "The people and companies who buy from the store.",
    groups: [
      {
        heading: "Customers",
        items: [
          item("/customers", "Customers", "Everyone with an account, their orders and details.", { feature: "shop" }),
          item("/customer-groups", "Customer groups", "Groups with a fixed discount, such as members or resellers.", { feature: "shop" }),
          item("/price-lists", "Price lists", "Prices of their own for customer groups and companies: a percentage off or fixed prices.", { feature: "shop" }),
          item("/companies", "Companies", "Company accounts with their employees and a group's discount.", { feature: "business" }),
          item("/wishlists", "Wishlists", "What customers have saved, and what they added to the cart from it.", { feature: "shop" }),
          item("/privacy", "Privacy requests", "People's requests for a copy of their data or for it to be erased, with the one-month clock."),
        ],
      },
    ],
  },
  {
    key: "marketing",
    label: "Marketing",
    icon: "megaphone",
    start: "/campaigns",
    hub: false,
    intro: "Ways to get people to buy, and to come back.",
    groups: [
      {
        heading: "Marketing",
        items: [
          item("/campaigns", "Campaigns", "Offers without a code, for a time: a percentage off, buy N pay for M, a free product.", { feature: "shop" }),
          item("/discounts", "Coupons", "Discount codes customers type at checkout.", { feature: "shop" }),
          item("/recommendations", "Recommendations", "What the store suggests to each shopper, and how well it works.", { feature: "shop" }),
          item("/experiments", "A/B tests", "Try two versions of a page on real visitors and keep the one that works better."),
          item("/automations", "Email automations", "Emails that go by themselves: a welcome, after a purchase, win-back, and back in stock."),
          item("/broadcasts", "Broadcasts", "Emails with news and offers to everyone who wants them, or to a segment, with what happened after."),
          item("/segments", "Segments", "Groups of customers and subscribers by what they did, counted as you open them."),
          item("/ads", "Ads and conversions", "Checkouts and purchases sent to your ad platforms from the server, for shoppers who allowed marketing."),
          item("/feeds", "Product feeds", "Your products for Google Shopping, Meta, TikTok and Pinterest, at a secret address."),
          item("/subscribers", "Subscribers", "People who asked for your emails with news and offers, with what they agreed to and when."),
          item("/cart-reminders", "Cart reminders", "Emails to people who left items in their cart.", { feature: "shop" }),
          item("/bonus", "Bonus credits", "Credits customers earn on what they pay and use as a price reduction.", { feature: "bonus" }),
          item("/affiliates", "Referral program", "Customers who refer their friends, and what both get.", { feature: "referrals" }),
        ],
      },
    ],
  },
  {
    key: "analytics",
    label: "Analytics",
    icon: "chart",
    start: "/analytics",
    hub: false,
    intro: "How the store is doing: sales and profit, why they change, which customers and products drive them, and what needs doing today.",
    groups: [
      {
        heading: "Analytics",
        items: [
          item("/analytics", "Overview", "The store's main figures against the last period and last year, its funnel, best sellers, channels and what needs you today.", { exact: true, feature: "shop" }),
          item("/analytics/live", "Live", "Who is in the store right now, carts and checkouts in progress, and today's orders so far.", { feature: "shop" }),
          item("/analytics/finance", "Finance", "From gross sales to profit: discounts, refunds, costs, fees, marketing and what is left.", { feature: "shop" }),
          item("/analytics/reports", "Reports", "Your sales cut the way you need them: ready reports and your own, saved and downloaded.", { feature: "shop" }),
          item("/analytics/payouts", "Payouts", "What Stripe paid to your bank, what each payout settles and whether it adds up.", { feature: "shop" }),
          item("/analytics/tax", "VAT", "VAT by country and rate, the quarterly OSS and monthly IOSS return data, and how they agree with your invoices and Finance.", { feature: "shop" }),
          item("/analytics/customers", "Customers", "New and returning customers, repeat purchases, lifetime value, segments and cohorts.", { feature: "shop" }),
          item("/analytics/products", "Products", "What sells, what earns, what is refunded, and how fast each product moves.", { feature: "shop" }),
          item("/analytics/inventory", "Inventory", "Stock, its value, how many days it lasts, what is about to run out and what does not sell.", { feature: "shop" }),
          item("/analytics/marketing", "Marketing", "Channels, ad spend, cost to win a customer, return on ad spend, discounts and coupons.", { feature: "shop" }),
          item("/analytics/subscriptions", "Subscriptions", "Monthly recurring revenue, how it moves, churn and failed renewals.", { feature: "subscriptions" }),
          item("/analytics/traffic", "Traffic", "Visits, the way from visit to purchase, devices, countries, searches and the busiest hours."),
          item("/analytics/speed", "Speed", "How fast your pages load for your visitors, measured in their browsers, and what to fix."),
          item("/analytics/settings", "Analytics settings", "Costs, fees and targets that turn sales into profit, and whether visits are counted."),
        ],
      },
    ],
  },
  {
    key: "website",
    label: "Website",
    icon: "monitor",
    start: "/website",
    hub: true,
    intro: "Everything that makes the store's site: its pages and blog, pictures, menus, header, footer, look and translations.",
    groups: [
      {
        heading: "Website",
        items: [
          item("/pages", "Pages", "The store's own pages, built in the page builder: draft, publish, and choose the front page and special pages."),
          item("/articles", "Blog", "The store's blog: articles, their categories and tags."),
          item("/articles/blogs", "Blogs", "The store's blogs, each with its address, feed and comments setting, and the authors of its articles."),
          item("/articles/comments", "Blog comments", "Visitors' comments on the articles: approve, refuse or mark them as spam."),
          item("/content", "Content", "Your own kinds of content, such as team members or locations: entries listed on pages, each with a page if you like."),
          item("/media", "Media", "Pictures and videos for the store, searchable, with alt texts."),
          item("/menus", "Menus", "Lists of links for the header, footer and pages."),
          item("/redirects", "Redirects", "Redirects for addresses that changed and a report of the addresses shoppers could not find."),
          item("/headers", "Headers", "Headers built from components; choose the one the store shows."),
          item("/footers", "Footers", "Footers built from components; choose the one the store shows."),
          item("/settings/design", "Design", "The store's look: template, colours, fonts, buttons and corners."),
          // More than one language comes with Several languages or with countries of different languages (D178); the page says when there is one.
          item("/translate", "Translate the store", "Have AI suggest translations of the whole store, and read them before they are used.", { feature: ["languages", "countries"] }),
        ],
      },
    ],
  },
  {
    key: "bookings",
    label: "Bookings",
    icon: "calendar",
    start: "/bookings",
    hub: false,
    feature: ["appointments", "bookings"],
    intro: "Appointments, stays and rentals: the calendar, who does them, and the rooms and items.",
    groups: [
      {
        heading: "Bookings",
        items: [
          item("/bookings", "Calendar", "Every booking by week, with what can be done about it.", { exact: true, feature: ["appointments", "bookings"] }),
          item("/bookings/staff", "Staff and hours", "The people who do appointments, their opening hours and capacity.", { feature: "appointments" }),
          item("/bookings/stays", "Stays and rentals", "Products booked by night or day, with seasons and fees.", { feature: "bookings" }),
          item("/bookings/units", "Rooms and items", "The rooms and items stays and rentals are booked on, and their calendars.", { feature: "bookings" }),
          item("/hosts", "Hosts", "Outside hosts who list stays and rentals in the store, and the DAC7 report.", { feature: "bookings" }),
        ],
      },
    ],
  },
  {
    // Support (D216, docs/support.md): every conversation with the store's customers, live, and the chat assistant that answers first.
    key: "support",
    label: "Support",
    icon: "chat",
    start: "/support",
    hub: false,
    intro: "Conversations with the store's customers: the inbox, and the chat assistant that answers them first.",
    groups: [
      {
        heading: "Support",
        items: [
          item("/support", "Inbox", "Every conversation with the store's customers as it happens: who is waiting, who is talking to the assistant, and what was said."),
          item("/support/requests", "Requests", "What the chat assistant passed to your team (a refund, cancelling an order, a new address, an exception): decide each, and the customer is told."),
          item("/support/reports", "Reports", "How the store's conversations went: how many, how many the AI handled alone, how long customers waited, ratings, tone and topics."),
          item("/support/replies", "Saved replies", "Texts your team puts in an answer with / in the inbox, filled in with the customer's and the person's names and the store's."),
          item("/chat", "Chat assistant", "The store's chat assistant for shoppers, and the knowledge it answers from."),
          item("/support/settings", "Settings", "Who answers the store's customers (the assistant alone, the AI first, or people only), opening hours, email follow-up and how long conversations are kept."),
        ],
      },
    ],
  },
  {
    key: "settings",
    label: "Settings",
    icon: "cog",
    start: "/settings",
    hub: true,
    intro: "How the store is set up: its company, markets, payments, delivery, tools and team.",
    groups: [
      {
        heading: "Store",
        items: [
          item("/settings/company", "Company", "The business details, places and contact information shoppers and invoices show."),
          item("/settings/domains", "Domains", "The addresses the store is reached at."),
          item("/settings/countries", "Countries", "The countries the store sells to, and its own country."),
          item("/settings/localization", "Languages and currencies", "The languages and currencies the store offers, and the exchange rates."),
          item("/settings/features", "Features", "Switch the online shop and the store's features on or off: subscriptions, bookings, countries, languages, selling to businesses and more."),
          item("/settings/close", "Close store", "Stop sales and take the shop off the web. Nothing is deleted, and you can reopen it for thirty days."),
        ],
      },
      {
        heading: "Selling",
        items: [
          item("/settings/payments", "Payments", "Take payments through Stripe, and the methods shoppers can use.", { feature: "shop" }),
          item("/settings/shipping", "Shipping", "Flat rates, shipping methods with zones and profiles, pickup at your places, local delivery and carriers.", { feature: "shop" }),
          item("/settings/orders", "Orders", "Gift messages at checkout, automatic archiving, how long a draft order's pay link lasts and who may record a payment taken outside Kaizena Flow.", { feature: "shop" }),
          item("/settings/notifications", "Notifications", "The emails customers get about their orders and returns: which are sent, your own wording in each language, and who on the team is told of new orders.", { feature: "shop" }),
          item("/settings/automation", "Automation", "Rules that tag, hold or tell staff about paid orders that match conditions you choose, and the log of what they did.", { feature: "shop" }),
          item("/settings/returns", "Returns", "How long customers have to return goods, who pays for sending them back, when refunds are made and the instructions they get.", { feature: "shop" }),
          item("/settings/legal", "Legal pages", "Starter drafts of the terms, privacy statement, returns and shipping policies, withdrawal information and imprint, and what checkout says about the terms."),
          item("/settings/tax", "Tax", "VAT registration and number, OSS and IOSS, and how the store charges VAT.", { feature: "shop" }),
          item("/settings/customs", "Duties and import VAT", "Who pays duties and import VAT in each country outside your customs area: your customer to the carrier on delivery, or with the order at checkout.", { feature: "shop" }),
          item("/settings/invoices", "Invoicing", "Switch on invoices, the numbering, the note printed on every invoice and credit note.", { feature: "shop" }),
          item("/settings/producer-responsibility", "Producer responsibility", "Registrations for packaging, electrical equipment, batteries and other schemes in each country, and what is not sold without one.", { feature: "shop" }),
          item("/integrations", "Integrations", "Connect shipping carriers, Slack, accounting and other services."),
        ],
      },
      {
        heading: "Site",
        items: [
          item("/settings/navigation", "Header and footer", "The store's logos, icon, business details and which menus its standard header and footer show."),
          item("/settings/seo", "SEO & Reach", "How search engines and AI crawlers see the store."),
          item("/settings/private", "Private mode", "Keep the store behind a landing page and a password while it is not ready, and preview it as staff."),
          item("/settings/cookies", "Cookies and tracking", "The cookies the store sets, its tracking tools and consents."),
          item("/settings/accessibility", "Accessibility", "What has been checked against the accessibility requirements, and a draft accessibility statement for the site."),
        ],
      },
      {
        heading: "Tools",
        items: [
          item("/search", "Search", "How the store's search works: keywords, meaning and what shoppers searched for.", { feature: "shop" }),
          item("/settings/ai", "AI", "The AI provider and models the store uses, or its own key."),
          item("/settings/api", "Apps and API", "Tokens for your own apps, warehouse or accounting to read and change the store through the Admin API."),
        ],
      },
      {
        heading: "Account",
        items: [
          item("/billing", "Billing", "The store's plan, what it costs and its invoices."),
          item("/staff", "Team", "Who can work in the store's admin, their roles, collaborators with an end date, and two-step sign-in."),
          item("/activity", "Activity log", "Who changed what and when: products, prices, pages, discounts, shipping, staff and payment settings."),
        ],
      },
    ],
  },
];

/**
 * Whether the person looking can open a page, from its address after the store's (wave 1, 1f): the navigation offers only what a
 * member may open, so a page they cannot use is not a link to a 404. Built from the member's keys by `canOpenPath()` in `permissions.ts`
 * (not here: that file reads this one).
 */
export type CanOpen = (path: string) => boolean;

/**
 * The pages of the sections offered to a store with these features on (D178), and, with `canOpen`, only those the member can open: a group,
 * a section and a hub's card with none left are not drawn. `STORE_SECTIONS` itself stays whole: `sectionOf()` and the permissions read it.
 */
export function storeSections(flags: StoreFlags, canOpen?: CanOpen): StoreSection[] {
  const on = (feature?: FeatureRequirement) => requirementMet(flags, feature);
  const open = (path: string) => !canOpen || canOpen(path);
  return STORE_SECTIONS.filter((s) => on(s.feature))
    .map((s) => {
      const groups = s.groups.map((g) => ({ ...g, items: g.items.filter((i) => on(i.feature) && open(i.path)) })).filter((g) => g.items.length > 0);
      // A section whose main page is hidden opens on the first page it has left (D178 step 5: a website's Customers open on Privacy requests).
      const left = groups.flatMap((g) => g.items.map((i) => i.path));
      const start = s.hub || left.length === 0 || left.includes(s.start) ? s.start : left[0];
      return { ...s, start, groups };
    })
    .filter((s) => !canOpen || s.groups.length > 0);
}

/** Addresses inside a section, after the store's: its hub (if it has one) and every page in its sidebar. */
export const sectionPaths = (section: StoreSection): string[] => [...(section.hub ? [section.start] : []), ...section.groups.flatMap((g) => g.items.map((i) => i.path))];

/** The section a page after the store's address belongs to, by the longest address it is inside; undefined for Home's pages. */
export function sectionOf(path: string): StoreSection | undefined {
  let best: { section: StoreSection; length: number } | undefined;
  for (const section of STORE_SECTIONS) {
    for (const prefix of sectionPaths(section)) {
      if ((path === prefix || path.startsWith(`${prefix}/`)) && (!best || prefix.length > best.length)) best = { section, length: prefix.length };
    }
  }
  return best?.section;
}

/** Pages with no section: Home, the setup steps and the AI manager. */
export const HOME_PATHS = ["/setup", "/assistant"];

/** Where the cards of a page of cards or the sidebar link to. */
export const storeLink = (base: string, item: Pick<StoreItem, "path" | "exact">) => ({ href: `${base}${item.path}`, ...(item.exact && { exact: true as const }) });

type Link = { href: string; label: string; exact?: boolean };

/**
 * The tabs of a store's admin: Home, then each section offered, with the addresses inside it. A page of cards marks only itself, its pages are
 * inside their own section. `counts` puts a number on a section's tab (Support: the conversations waiting for a person, D216).
 */
export function storeTabs(base: string, flags: StoreFlags, canOpen?: CanOpen, counts: Partial<Record<StoreSection["key"], number>> = {}): (Link & { icon: NavIconName; also: string[]; badge?: number; foot?: boolean })[] {
  return [
    { href: base, label: "Home", icon: "home", exact: true, also: HOME_PATHS.map((p) => `${base}${p}`) },
    ...storeSections(flags, canOpen).map((s) => ({
      href: `${base}${s.start}`,
      label: s.label,
      icon: s.icon,
      ...(s.hub && { exact: true }),
      ...(counts[s.key] ? { badge: counts[s.key] } : {}),
      // Settings sit at the foot of the rail (docs/admin-style.md 5.3); in the tabs and the menu they keep their place.
      ...(s.key === "settings" && { foot: true }),
      // The page of cards is the tab's own address; only the pages in the sidebar are inside it (Design is `/settings/design`, the Website's).
      also: s.groups.flatMap((g) => g.items.map((i) => `${base}${i.path}`)),
    })),
  ];
}

/** The sidebar of each section (none for Home), by the addresses inside it: a section's page of cards matches only itself. */
export function storeAreas(base: string, flags: StoreFlags, canOpen?: CanOpen): { prefixes: string[]; exact?: string[]; groups: { heading: string; items: Link[] }[] }[] {
  return [
    { prefixes: HOME_PATHS.map((p) => `${base}${p}`), exact: [base], groups: [] },
    ...storeSections(flags, canOpen).map((s) => ({
      prefixes: s.groups.flatMap((g) => g.items.map((i) => `${base}${i.path}`)),
      ...(s.hub && { exact: [`${base}${s.start}`] }),
      groups: s.groups.map((g) => ({ heading: g.heading, items: g.items.map((i) => ({ label: i.label, ...storeLink(base, i) })) })),
    })),
  ];
}
