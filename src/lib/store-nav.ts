/**
 * A store admin's sections (D147), pure data for its layout, its hub pages and the tests that keep them in step with the
 * admin map, built like the platform's (D144): each section is a tab with an icon and, where it has pages of its own, a
 * sidebar; Home has none. Website and Settings open on a page of cards (their hub), the others on their main page.
 */

import type { NavIconName } from "@/components/admin/nav-icons";

/** What a store must have switched on for a page or a section to be offered. */
export type StoreNeeds = "bookings" | "deliveries";
export type StoreFlags = { bookingsOn: boolean; deliveriesOn: boolean };

/** A page in a sidebar: its address after the store's, its label, and a line on what it is for (the hub's card). */
export type StoreItem = { path: string; label: string; description: string; exact?: boolean; needs?: StoreNeeds };
export type StoreGroup = { heading: string; items: StoreItem[] };

export type StoreSection = {
  key: "orders" | "products" | "customers" | "marketing" | "analytics" | "website" | "bookings" | "settings";
  label: string;
  icon: NavIconName;
  /** The tab's address after the store's: the section's main page, or its hub. */
  start: string;
  /** A page of cards instead of a main page; the section's sidebar leads to the same pages. */
  hub: boolean;
  intro: string;
  needs?: StoreNeeds;
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
    intro: "Everything that is bought: orders, returns and withdrawals, subscriptions and the emails the store sent about them.",
    groups: [
      {
        heading: "Orders",
        items: [
          item("/orders", "Orders", "Every order: open it, fulfil it, refund it, print its packing slip."),
          item("/returns", "Returns", "Customers' withdrawals and return requests: approve, receive, inspect and refund them in time."),
          item("/invoices", "Invoices", "Invoices and credit notes for orders, the orders waiting for one, and a CSV for the accountant."),
          item("/subscriptions", "Subscriptions", "Customers' recurring subscriptions and their payments."),
          item("/deliveries", "Subscription boxes", "Weekly delivery days, cutoffs, and the lists customers have set up.", { needs: "deliveries" }),
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
          item("/products", "Products", "The catalogue: prices, stock, variants, pictures, categories and tags."),
          item("/product-layouts", "Product layouts", "How a product's page is laid out, for all products, a category, a tag or one product."),
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
          item("/customers", "Customers", "Everyone with an account, their orders and details."),
          item("/customer-groups", "Customer groups", "Groups with a fixed discount, such as members or resellers."),
          item("/companies", "Companies", "Company accounts with their employees and a group's discount."),
          item("/wishlists", "Wishlists", "What customers have saved, and what they added to the cart from it."),
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
          item("/campaigns", "Campaigns", "Offers without a code, for a time: a percentage off, buy N pay for M, a free product."),
          item("/discounts", "Coupons", "Discount codes customers type at checkout."),
          item("/recommendations", "Recommendations", "What the store suggests to each shopper, and how well it works."),
          item("/experiments", "A/B tests", "Try two versions of a page on real visitors and keep the one that works better."),
          item("/cart-reminders", "Cart reminders", "Emails to people who left items in their cart."),
          item("/bonus", "Bonus credits", "Credits customers earn on what they pay and use as a price reduction."),
          item("/affiliates", "Referral program", "Customers who refer their friends, and what both get."),
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
          item("/analytics", "Overview", "The store's main figures against the last period and last year, its funnel, best sellers, channels and what needs you today.", { exact: true }),
          item("/analytics/finance", "Finance", "From gross sales to profit: discounts, refunds, costs, fees, marketing and what is left."),
          item("/analytics/customers", "Customers", "New and returning customers, repeat purchases, lifetime value, segments and cohorts."),
          item("/analytics/products", "Products", "What sells, what earns, what is refunded, and how fast each product moves."),
          item("/analytics/inventory", "Inventory", "Stock, its value, how many days it lasts, what is about to run out and what does not sell."),
          item("/analytics/marketing", "Marketing", "Channels, ad spend, cost to win a customer, return on ad spend, discounts and coupons."),
          item("/analytics/subscriptions", "Subscriptions", "Monthly recurring revenue, how it moves, churn and failed renewals."),
          item("/analytics/traffic", "Traffic", "Visits, the way from visit to purchase, devices, countries, searches and the busiest hours."),
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
          item("/media", "Media", "Pictures and videos for the store, searchable, with alt texts."),
          item("/menus", "Menus", "Lists of links for the header, footer and pages."),
          item("/headers", "Headers", "Headers built from components; choose the one the store shows."),
          item("/footers", "Footers", "Footers built from components; choose the one the store shows."),
          item("/settings/design", "Design", "The store's look: template, colours, fonts, buttons and corners."),
          item("/translate", "Translate the store", "Have AI suggest translations of the whole store, and read them before they are used."),
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
    needs: "bookings",
    intro: "Appointments, stays and rentals: the calendar, who does them, and the rooms and items.",
    groups: [
      {
        heading: "Bookings",
        items: [
          item("/bookings", "Calendar", "Every booking by week, with what can be done about it.", { exact: true }),
          item("/bookings/staff", "Staff and hours", "The people who do appointments, their opening hours and capacity."),
          item("/bookings/stays", "Stays and rentals", "Products booked by night or day, with seasons and fees."),
          item("/bookings/units", "Rooms and items", "The rooms and items stays and rentals are booked on, and their calendars."),
          item("/hosts", "Hosts", "Outside hosts who list stays and rentals in the store, and the DAC7 report."),
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
          item("/settings/localization", "Languages and currencies", "The languages and currencies the store offers, and the exchange rates."),
          item("/settings/features", "Features", "Switch the store's optional modules on or off: bookings, subscription boxes and more."),
        ],
      },
      {
        heading: "Selling",
        items: [
          item("/settings/payments", "Payments", "Take payments through Stripe, and the methods shoppers can use."),
          item("/settings/shipping", "Shipping", "The flat rate for each market, free shipping above an amount, and carriers."),
          item("/settings/returns", "Returns", "How long customers have to return goods, who pays for sending them back, when refunds are made and the instructions they get."),
          item("/settings/legal", "Legal pages", "Starter drafts of the terms, privacy statement, returns and shipping policies, withdrawal information and imprint, and what checkout says about the terms."),
          item("/settings/tax", "Tax", "VAT registration and number, OSS and IOSS, and how the store charges VAT."),
          item("/settings/invoices", "Invoicing", "Switch on invoices, the numbering, the note printed on every invoice and credit note."),
          item("/integrations", "Integrations", "Connect shipping carriers, Slack, accounting and other services."),
        ],
      },
      {
        heading: "Site",
        items: [
          item("/settings/navigation", "Header and footer", "The store's logos, icon, business details and which menus its standard header and footer show."),
          item("/settings/seo", "SEO & Reach", "How search engines and AI crawlers see the store."),
          item("/settings/cookies", "Cookies and tracking", "The cookies the store sets, its tracking tools and consents."),
          item("/settings/accessibility", "Accessibility", "What has been checked against the accessibility requirements, and a draft accessibility statement for the site."),
        ],
      },
      {
        heading: "Tools",
        items: [
          item("/search", "Search", "How the store's search works: keywords, meaning and what shoppers searched for."),
          item("/chat", "Chat agent", "The store's chat agent for shoppers, and the knowledge it answers from."),
          item("/settings/ai", "AI", "The AI provider and models the store uses, or its own key."),
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
 * The pages of the sections offered to a store with these modules on, and, with `canOpen`, only those the member can open: a group,
 * a section and a hub's card with none left are not drawn.
 */
export function storeSections(flags: StoreFlags, canOpen?: CanOpen): StoreSection[] {
  const on = (needs?: StoreNeeds) => !needs || (needs === "bookings" ? flags.bookingsOn : flags.deliveriesOn);
  const open = (path: string) => !canOpen || canOpen(path);
  return STORE_SECTIONS.filter((s) => on(s.needs))
    .map((s) => ({
      ...s,
      groups: s.groups.map((g) => ({ ...g, items: g.items.filter((i) => on(i.needs) && open(i.path)) })).filter((g) => g.items.length > 0),
    }))
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

/** The tabs of a store's admin: Home, then each section offered, with the addresses inside it. A page of cards marks only itself, its pages are inside their own section. */
export function storeTabs(base: string, flags: StoreFlags, canOpen?: CanOpen): (Link & { icon: NavIconName; also: string[] })[] {
  return [
    { href: base, label: "Home", icon: "home", exact: true, also: HOME_PATHS.map((p) => `${base}${p}`) },
    ...storeSections(flags, canOpen).map((s) => ({
      href: `${base}${s.start}`,
      label: s.label,
      icon: s.icon,
      ...(s.hub && { exact: true }),
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
