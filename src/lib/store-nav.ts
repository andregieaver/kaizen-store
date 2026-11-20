/**
 * A store admin's sections (D147), pure data for its layout, its hub pages and the tests that keep them in step with the
 * admin map, built like the platform's (D144): each section is a tab with an icon and, where it has pages of its own, a
 * sidebar; Home has none. Website and Settings open on a page of cards (their hub), the others on their main page.
 */

import { EXTENSION_IDS, STORE_ONLY_EXTENSIONS, storeExtensionsOn, type ExtensionId } from "./extensions";
import type { NavIconName } from "@/components/admin/nav-icons";

import type { Area } from "./permission-keys";
import { requirementMet, type FeatureRequirement, type FeatureSource } from "./store-features";

/**
 * What the navigation is filtered by: the store's features (D178), as kept (`store.features`); a page or section behind a feature is offered
 * only while it is on (`requirementMet()`: kept on with everything it needs).
 */
export type StoreFlags = FeatureSource & {
  house?: boolean;
  /** The account's paid-extension facts (D748 E3, `Store.extensionFacts`): a page or section behind an extension is offered only while it works. */
  extensionFacts?: unknown;
  /** A standalone account's workspace (D748 E7): only its extensions' pages and those marked `workspace` are offered. */
  workspace?: boolean;
};

/**
 * A page in a sidebar: its address after the store's, its label, and a line on what it is for (the hub's card). `feature` is the store
 * feature (D178) it stands behind: one, or several of which any is enough; the same as its `ADMIN_PAGES` entry's (a test holds them).
 * `icon` is drawn beside its label in the sidebar and on its card (D454). `basic` puts it in the Basic view (D454, `src/lib/admin-view.ts`):
 * an everyday page Homer needs; every other page is shown in Advanced only (and in Basic while it is the page being viewed). A section's
 * main page is always in Basic, since its tab leads there. `area` is the page's own permission area (D851), whichever section it sits in.
 */
export type StoreItem = {
  path: string;
  /**
   * The permission area of the page, of the pages under it and of its `also` addresses (D851): what `areaOfPath()` reads, so who may open
   * the page never follows the section it is listed in. Moving the item moves it in the menu only; a page that changes area changes it here.
   */
  area: Area;
  label: string;
  description: string;
  icon: NavIconName;
  basic?: boolean;
  exact?: boolean;
  feature?: FeatureRequirement;
  /** The paid extension (D748) it is part of: offered only while the account has it; the same as its `ADMIN_PAGES` entry's (a test holds them). */
  extension?: ExtensionId;
  /** A page only a customer's store has: left out for Kaizena Flow's own store (D466), which has no plan and is never closed. */
  customer?: true;
  /** A page a workspace (D748 E7) offers besides its extensions' own: always (`true`), or while the account has that extension. */
  workspace?: true | ExtensionId;
  /** A page that is not what its section's tab stands for (Custom fields under Products): the tab never opens on it, and a section with only
   * such pages left is not in the menu. */
  aside?: true;
  /** Other addresses that are this page (an old address that leads to one of its tabs, and that tab's own pages): inside its section, and
   * the item is marked on them. Discounts holds `/campaigns`, its Automatic tab (ecosystem plan E3.7, D718). */
  also?: string[];
  /** Pages under its address in another area (D851): the responses to the store's forms are the customers', under the website's Forms. */
  within?: { path: string; area: Area }[];
};
export type StoreGroup = { heading: string; items: StoreItem[] };

export type StoreSection = {
  /** The section's name in the menu, and the area of its page of cards (`hub`), which is the section's own page; its items name their own. */
  key: "orders" | "products" | "customers" | "marketing" | "analytics" | "website" | "bookings" | "support" | "settings";
  label: string;
  icon: NavIconName;
  /** The tab's address after the store's: the section's main page, or its hub. */
  start: string;
  /** A page of cards instead of a main page; the section's sidebar leads to the same pages. */
  hub: boolean;
  intro: string;
  feature?: FeatureRequirement;
  /** The paid extension (D748) the whole section is part of. */
  extension?: ExtensionId;
  groups: StoreGroup[];
};

const item = (path: string, label: string, description: string, extra: Partial<StoreItem> & Pick<StoreItem, "area" | "icon">): StoreItem => ({ path, label, description, ...extra });

/**
 * The customer pages' features: the online shop, or Deals (D464), whose deals are with the store's people: a website with Deals has its
 * customers too, as Kaizena Flow's own store does (D467).
 */
export const CUSTOMERS_FEATURE: FeatureRequirement = ["shop", "sales"];

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
          item("/orders", "Orders", "Every order: search and filter them, save views, tag, archive, send and print in bulk, open one to fulfil or refund it.", { area: "orders", icon: "receipt", basic: true }),
          item("/orders/drafts", "Draft orders", "Orders you make for a customer: products, custom items and prices, a discount and shipping, sent as a pay link or recorded as paid outside Kaizena Flow.", { area: "orders", icon: "file-pen" }),
          item("/returns", "Returns", "Customers' withdrawals and return requests: approve, receive, inspect and refund them in time.", { area: "orders", icon: "undo", basic: true }),
          item("/invoices", "Invoices", "Invoices and credit notes for orders, the orders waiting for one, and a CSV for the accountant.", { area: "orders", icon: "file-text" }),
          item("/subscriptions", "Subscriptions", "Customers' recurring subscriptions and their payments.", { area: "orders", feature: "subscriptions", icon: "repeat", basic: true }),
          item("/deliveries", "Subscription boxes", "Weekly delivery days, cutoffs, and the lists customers have set up.", { area: "orders", feature: "boxes", icon: "truck", basic: true }),
          item("/emails", "Emails", "Every email the store sent to customers and staff, and whether it arrived.", { area: "orders", icon: "mail" }),
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
          item("/products", "Products", "The catalogue: prices, stock, variants, pictures, categories and tags.", { area: "products", feature: "shop", icon: "tag", basic: true }),
          item("/inventory", "Inventory", "Stock for each variant and location: on hand, held by checkouts and owed on backorder, with counts, adjustments with a reason, history and files.", { area: "products", feature: "shop", icon: "warehouse" }),
          item("/gift-cards", "Gift cards", "Cards customers buy or you issue: what they hold, each card's history, issuing and changing one.", { area: "products", feature: "gift_cards", icon: "gift", basic: true }),
          item("/reviews", "Reviews", "What buyers say about your products: check new reviews, publish or hide them and answer.", { area: "products", feature: "reviews", icon: "star", basic: true }),
          item("/product-layouts", "Product layouts", "How a product's page is laid out, for all products, a category, a tag or one product.", { area: "products", feature: "shop", icon: "layout-template" }),
          item("/fields", "Custom fields", "Your own groups of fields for products, pages, customers and more.", { area: "products", icon: "list-plus", aside: true }),
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
          item("/customers", "Customers", "Everyone with an account, their orders and details.", { area: "customers", feature: CUSTOMERS_FEATURE, icon: "users", basic: true, workspace: true }),
          item("/customer-groups", "Customer groups", "Groups with a fixed discount, such as members or resellers.", { area: "customers", feature: "shop", icon: "users-round" }),
          item("/price-lists", "Price lists", "Prices of their own for customer groups and companies: a percentage off or fixed prices.", { area: "customers", feature: "shop", icon: "banknote" }),
          item("/companies", "Companies", "Company accounts with their employees and a group's discount.", { area: "customers", feature: "business", icon: "building", basic: true }),
          item("/deals", "Deals", "What each customer or company may buy, on a board from the first talk to won or lost.", { area: "customers", extension: "deals", feature: "sales", icon: "handshake", basic: true }),
          // Every contract on the store's deals (D857), under Deals: made on a deal, found here.
          item("/deals/contracts", "Contracts", "Every contract on your deals: who it is for, its version, and whether it is signed, waiting or declined.", { area: "customers", extension: "deals", feature: "sales", icon: "file-pen", basic: true }),
          // The leads inbox, a tab of Deals before (ecosystem plan E2.8, D713): its own page, so it is found and its address is its own.
          item("/leads", "Leads", "People who asked for something and are not customers yet: what they asked, a deal of those worth following up.", { area: "customers", extension: "deals", feature: "sales", icon: "user-plus", basic: true }),
          item("/wishlists", "Wishlists", "What customers have saved, and what they added to the cart from it.", { area: "customers", feature: "shop", icon: "heart" }),
          item("/privacy", "Privacy requests", "People's requests for a copy of their data or for it to be erased, with the one-month clock.", { area: "customers", icon: "shield-check", basic: true, workspace: true }),
        ],
      },
    ],
  },
  {
    key: "marketing",
    label: "Marketing",
    icon: "megaphone",
    // Round 4 (D612): a first page of its own, what brings people back and what it did, before any one tool.
    start: "/marketing",
    hub: true,
    intro: "Ways to get people to buy, and to come back.",
    groups: [
      {
        heading: "Discounts",
        items: [
          // One page for one job (ecosystem plan E3.7, D718; code review step 2.4): codes and automatic offers are its two tabs. The automatic
          // offers' list was Campaigns at `/campaigns`, which now leads to that tab; their editor keeps its address there.
          item("/discounts", "Discounts", "Money off for shoppers: codes they type at checkout, and automatic offers for a time, such as 3 for 2 or a free product.", { area: "marketing", feature: "shop", icon: "badge-percent", basic: true, also: ["/campaigns"] }),
        ],
      },
      {
        heading: "Email",
        items: [
          item("/broadcasts", "Broadcasts", "Emails with news and offers to everyone who wants them, or to a segment, with what happened after.", { area: "marketing", extension: "email_automation", icon: "send", basic: true }),
          item("/automations", "Email automations", "Emails that go by themselves: a welcome, after a purchase, win-back, and back in stock.", { area: "marketing", extension: "email_automation", icon: "mail-check" }),
          // Flows (D767): sequences of the owner's own, read as a story.
          item("/flows", "Flows", "Emails one after another to each person from the moment something happens, read as a story.", { area: "marketing", extension: "email_automation", icon: "mail-check" }),
          item("/text-messages", "Text messages", "Offers by text message to the numbers that asked for them at checkout, in their daytime.", { area: "marketing", icon: "message-text" }),
          item("/cart-reminders", "Cart reminders", "Emails to people who left items in their cart.", { area: "marketing", feature: "shop", icon: "cart" }),
          item("/subscribers", "Subscribers", "People who asked for your emails with news and offers, with what they agreed to and when.", { area: "marketing", icon: "user-check", workspace: "email_automation" }),
          // Who a message goes to, not a group with a discount (Customer groups): ecosystem plan E3.7, D718.
          item("/segments", "Segments", "Who gets an email or a text message, chosen by rules on what people did and counted again as you open them.", { area: "marketing", extension: "email_automation", icon: "chart-pie" }),
        ],
      },
      {
        heading: "Channels",
        items: [
          item("/ads", "Ads and conversions", "Checkouts and purchases sent to your ad platforms from the server, for shoppers who allowed marketing.", { area: "marketing", icon: "target" }),
          item("/feeds", "Product feeds", "Your products for Google Shopping, Meta, TikTok and Pinterest, at a secret address.", { area: "marketing", icon: "rss" }),
          item("/creators", "Creators", "People with a channel who sell your goods with a code of their own, and the commission they earn.", { area: "marketing", feature: "shop", icon: "video" }),
        ],
      },
      {
        heading: "Loyalty",
        items: [
          item("/bonus", "Bonus credits", "Credits customers earn on what they pay and use as a price reduction.", { area: "marketing", feature: "bonus", icon: "coins", basic: true }),
          // Refer a friend, as its customers know it: Referrals is an owner's own link to Kaizena Flow (ecosystem plan E3.7, D718).
          item("/affiliates", "Refer a friend", "Customers who refer their friends, and what both get.", { area: "marketing", feature: "referrals", icon: "share", basic: true }),
        ],
      },
      {
        heading: "On the site",
        items: [
          item("/recommendations", "Recommendations", "What the store suggests to each shopper, and how well it works.", { area: "marketing", feature: "shop", icon: "thumbs-up" }),
          item("/experiments", "A/B tests", "Try two versions of a page on real visitors and keep the one that works better.", { area: "marketing", extension: "ab_testing", icon: "flask" }),
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
        heading: "Overview",
        items: [
          item("/analytics", "Overview", "The store's main figures against the last period and last year, its funnel, best sellers, channels and what needs you today.", { area: "analytics", exact: true, feature: "shop", icon: "dashboard", basic: true }),
          item("/analytics/live", "Live", "Who is in the store right now, carts and checkouts in progress, and today's orders so far.", { area: "analytics", feature: "shop", icon: "activity" }),
          item("/analytics/reports", "Reports", "Your sales cut the way you need them: ready reports and your own, saved and downloaded.", { area: "analytics", feature: "shop", icon: "file-spreadsheet" }),
        ],
      },
      {
        heading: "Money",
        items: [
          item("/analytics/finance", "Finance", "From gross sales to profit: discounts, refunds, costs, fees, marketing and what is left.", { area: "analytics", feature: "shop", icon: "wallet" }),
          item("/analytics/payouts", "Payouts", "What Stripe paid to your bank, what each payout settles and whether it adds up.", { area: "analytics", feature: "shop", icon: "landmark", basic: true }),
          item("/analytics/tax", "VAT", "VAT by country and rate, the quarterly OSS and monthly IOSS return data, and how they agree with your invoices and Finance.", { area: "analytics", feature: "shop", icon: "percent" }),
          item("/analytics/subscriptions", "Subscription analytics", "Monthly recurring revenue, how it moves, churn and failed renewals.", { area: "analytics", feature: "subscriptions", icon: "repeat" }),
        ],
      },
      {
        heading: "Customers and products",
        items: [
          // Named apart from the pages they are about (ecosystem plan E3.7, D718): Customers is the customer list, Customer analytics its figures.
          item("/analytics/customers", "Customer analytics", "New and returning customers, repeat purchases, lifetime value, segments and cohorts.", { area: "analytics", feature: "shop", icon: "users" }),
          item("/analytics/products", "Product analytics", "What sells, what earns, what is refunded, and how fast each product moves.", { area: "analytics", feature: "shop", icon: "tag" }),
          item("/analytics/inventory", "Inventory analytics", "Stock, its value, how many days it lasts, what is about to run out and what does not sell.", { area: "analytics", feature: "shop", icon: "warehouse" }),
          item("/analytics/marketing", "Marketing analytics", "Channels, ad spend, cost to win a customer, return on ad spend, discounts and coupons.", { area: "analytics", feature: "shop", icon: "megaphone" }),
          item("/analytics/sales", "Sales", "Deals: what they may bring and when, how they move from stage to stage, who won and lost, and how long a deal takes to win.", { area: "analytics", extension: "deals", feature: "sales", icon: "handshake" }),
        ],
      },
      {
        heading: "The site",
        items: [
          item("/analytics/traffic", "Traffic", "Visits, the way from visit to purchase, devices, countries, searches and the busiest hours.", { area: "analytics", icon: "pointer" }),
          item("/analytics/speed", "Speed", "How fast your pages load for your visitors, measured in their browsers, and what to fix.", { area: "analytics", icon: "gauge" }),
          item("/analytics/heatmaps", "Heatmaps", "Where visitors click, how far they scroll and what they look at, and where they get stuck.", { area: "analytics", icon: "flame" }),
          item("/analytics/recordings", "Recordings", "Watch visits to your pages, for visitors who allow it, to see where they get stuck.", { area: "analytics", icon: "video" }),
          item("/analytics/settings", "Analytics settings", "Costs, fees and targets that turn sales into profit, and whether visits are counted.", { area: "analytics", icon: "sliders" }),
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
        heading: "Content",
        items: [
          item("/dream-factory", "Dream Factory", "Say what you want and the AI does it: a new store, or changes to the one you have, shown to you before anything goes live.", { area: "website", icon: "sparkles", basic: true }),
          item("/pages", "Pages", "The store's own pages, built in the page builder: draft, publish, and choose the front page and special pages.", { area: "website", icon: "files", basic: true }),
          item("/articles", "Blog", "The store's blog: articles, their categories and tags.", { area: "website", icon: "newspaper", basic: true }),
          item("/articles/blogs", "Blogs", "The store's blogs, each with its address, feed and comments setting, and the authors of its articles.", { area: "website", icon: "book-open" }),
          item("/articles/comments", "Blog comments", "Visitors' comments on the articles: approve, refuse or mark them as spam.", { area: "website", icon: "message-square" }),
          item("/content", "Content", "Your own kinds of content, such as team members or locations: entries listed on pages, each with a page if you like.", { area: "website", icon: "library" }),
          item("/media", "Media", "Pictures and videos for the store, searchable, with alt texts.", { area: "website", icon: "image", basic: true }),
          // What visitors sent with the forms (D705) is people's data: read with the customers, though the forms are the website's.
          item("/forms", "Forms", "Contact forms and newsletter sign-ups to place on any page, and what visitors sent with them.", { area: "website", icon: "clipboard-list", basic: true, within: [{ path: "/forms/responses", area: "customers" }] }),
        ],
      },
      {
        heading: "Look",
        items: [
          item("/settings/design", "Design", "The store's look: template, colours, fonts, buttons and corners.", { area: "website", icon: "palette", basic: true }),
          item("/headers", "Headers", "Headers built from components; choose the one the store shows.", { area: "website", icon: "panel-top" }),
          item("/footers", "Footers", "Footers built from components; choose the one the store shows.", { area: "website", icon: "panel-bottom" }),
        ],
      },
      {
        heading: "Structure",
        items: [
          item("/menus", "Menus", "Lists of links for the header, footer and pages.", { area: "website", icon: "menu", basic: true }),
          item("/redirects", "Redirects", "Redirects for addresses that changed and a report of the addresses shoppers could not find.", { area: "website", icon: "signpost" }),
          item("/staging", "Staging", "Gather changes to pages, the look and menus, compare them with what visitors see, and make them live together.", { area: "website", icon: "layers" }),
          // More than one language comes with Several languages or with countries of different languages (D178); the page says when there is one.
          item("/translate", "Translate the store", "Have AI suggest translations of the whole store, and read them before they are used.", { area: "website", feature: ["languages", "countries"], icon: "languages", basic: true }),
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
          item("/bookings", "Calendar", "Every booking by week, with what can be done about it.", { area: "bookings", exact: true, feature: ["appointments", "bookings"], icon: "calendar", basic: true }),
          item("/bookings/staff", "Staff and hours", "The people who do appointments, their opening hours and capacity.", { area: "bookings", feature: "appointments", icon: "clock", basic: true }),
          item("/bookings/stays", "Stays and rentals", "Products booked by night or day, with seasons and fees.", { area: "bookings", feature: "bookings", icon: "bed", basic: true }),
          item("/bookings/units", "Rooms and items", "The rooms and items stays and rentals are booked on, and their calendars.", { area: "bookings", feature: "bookings", icon: "door", basic: true }),
          item("/hosts", "Hosts", "Outside hosts who list stays and rentals in the store, and the DAC7 report.", { area: "bookings", feature: "bookings", icon: "house" }),
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
          item("/support", "Inbox", "Every conversation with the store's customers as it happens: who is waiting, who is talking to the assistant, and what was said.", { area: "support", extension: "support_desk", icon: "inbox", basic: true }),
          item("/support/requests", "Requests", "What the chat assistant passed to your team (a refund, cancelling an order, a new address, an exception): decide each, and the customer is told.", { area: "support", extension: "support_desk", icon: "clipboard-check", basic: true }),
          // Support's own names (ecosystem plan E3.7, D718): Reports are Analytics', Settings the store's.
          item("/support/reports", "Support reports", "How the store's conversations went: how many, how many the AI handled alone, how long customers waited, ratings, tone and topics.", { area: "support", extension: "support_desk", icon: "chart-column" }),
          item("/support/replies", "Saved replies", "Texts your team puts in an answer with / in the inbox, filled in with the customer's and the person's names and the store's.", { area: "support", extension: "support_desk", icon: "message-text" }),
          item("/chat", "Chat assistant", "The store's chat assistant for shoppers, and the knowledge it answers from.", { area: "support", icon: "bot", workspace: "support_desk" }),
          item("/support/widgets", "Website chat", "The chat on your other websites: widgets with their own look, each with a tag to paste on one or several sites.", { area: "support", extension: "support_desk", icon: "globe", basic: true }),
          item("/support/settings", "Support settings", "Who answers the store's customers (the assistant alone, the AI first, or people only), opening hours, email follow-up and how long conversations are kept.", { area: "support", extension: "support_desk", icon: "settings-2" }),
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
          item("/settings/company", "Company", "The business details, places and contact information shoppers and invoices show.", { area: "settings", icon: "store", basic: true, workspace: true }),
          // The store's own books (D512) are an area of their own, an accountant's, though they sit with the settings.
          item("/settings/books", "Books", "Your own books, kept from your invoices and credit notes as you issue them: the trial balance, what waits, and locking a period.", { area: "books", extension: "work", icon: "book-open" }),
          item("/settings/domains", "Domains", "The addresses the store is reached at.", { area: "settings", icon: "link", basic: true }),
          item("/settings/moving", "Moving in", "Bring a shop over from Shopify: connect it, check its old links, and import the rest.", { area: "settings", icon: "import" }),
          item("/settings/countries", "Countries", "The countries the store sells to, and its own country.", { area: "settings", icon: "map", basic: true }),
          item("/settings/localization", "Languages and currencies", "The languages and currencies the store offers, and the exchange rates.", { area: "settings", icon: "globe" }),
          item("/settings/features", "Features", "Switch the online shop and the store's features on or off: subscriptions, bookings, countries, languages, selling to businesses and more.", { area: "settings", icon: "toggle", basic: true }),
          item("/settings/close", "Close store", "Stop sales and take the shop off the web. Nothing is deleted, and you can reopen it for thirty days.", { area: "settings", icon: "power", customer: true }),
        ],
      },
      {
        heading: "Selling",
        items: [
          item("/settings/payments", "Payments", "Take payments through Stripe, and the methods shoppers can use.", { area: "settings", feature: "shop", icon: "credit-card", basic: true }),
          item("/settings/shipping", "Shipping", "Flat rates, shipping methods with zones and profiles, pickup at your places, local delivery and carriers.", { area: "settings", feature: "shop", icon: "truck", basic: true }),
          // Named apart from the sections they set (ecosystem plan E3.7, D718).
          item("/settings/products", "Product settings", "What product tiles in your grids show: how many are left, and a quantity chooser with Add to cart.", { area: "settings", feature: "shop", icon: "package" }),
          item("/settings/orders", "Order settings", "Gift messages at checkout, automatic archiving, how long a draft order's pay link lasts and who may record a payment taken outside Kaizena Flow.", { area: "settings", feature: "shop", icon: "clipboard-list" }),
          item("/settings/notifications", "Notifications", "The emails customers get about their orders and returns: which are sent, your own wording in each language, and who on the team is told of new orders.", { area: "settings", feature: "shop", icon: "bell" }),
          item("/settings/checkout", "Checkout rules", "Hide or rename a delivery option, leave a payment method out or stop an order when the basket matches; and questions the checkout asks.", { area: "settings", feature: "shop", icon: "list-filter" }),
          item("/settings/prices", "Prices and quantity", "How shoppers see prices, with or without ,00 on whole amounts and your words before and after them, and how they choose how many.", { area: "settings", feature: "shop", icon: "calculator" }),
          // Ecosystem plan E3.3 (D718): one home for what runs by itself.
          item("/settings/automatic", "Automatic", "Everything that happens by itself in the store, and when it last did: what follows a paid order, workflows, emails, alerts and connections.", { area: "settings", icon: "clock", basic: true }),
          item("/settings/workflows", "Workflows", "When something happens in the store, or at a set time: check what you choose, then tag, tell staff, post to Slack, send to your endpoint or ask the AI manager.", { area: "settings", icon: "workflow", workspace: true }),
          item("/settings/automation", "Automation", "Rules that tag, hold or tell staff about paid orders that match conditions you choose, and the log of what they did.", { area: "settings", feature: "shop", icon: "zap" }),
          item("/settings/returns", "Return settings", "How long customers have to return goods, who pays for sending them back, when refunds are made and the instructions they get.", { area: "settings", feature: "shop", icon: "undo" }),
          item("/settings/legal", "Legal pages", "Starter drafts of the terms, privacy statement, returns and shipping policies, withdrawal information and imprint, and what checkout says about the terms.", { area: "settings", icon: "scale", basic: true }),
          item("/settings/tax", "Tax", "VAT registration and number, OSS and IOSS, and how the store charges VAT.", { area: "settings", feature: "shop", icon: "percent", basic: true }),
          item("/settings/customs", "Duties and import VAT", "Who pays duties and import VAT in each country outside your customs area: your customer to the carrier on delivery, or with the order at checkout.", { area: "settings", feature: "shop", icon: "container" }),
          item("/settings/invoices", "Invoicing", "Switch on invoices, the numbering, the note printed on every invoice and credit note.", { area: "settings", feature: "shop", icon: "file-text" }),
          item("/settings/producer-responsibility", "Producer responsibility", "Registrations for packaging, electrical equipment, batteries and other schemes in each country, and what is not sold without one.", { area: "settings", feature: "shop", icon: "recycle" }),
          item("/integrations", "Integrations", "Connect shipping carriers, Slack, accounting and other services.", { area: "settings", icon: "puzzle", workspace: true }),
        ],
      },
      {
        heading: "Site",
        items: [
          item("/settings/navigation", "Header and footer", "The store's logos, icon, business details and which menus its standard header and footer show.", { area: "settings", icon: "panels-top-left", basic: true }),
          item("/settings/seo", "SEO & Reach", "How search engines and AI crawlers see the store.", { area: "settings", icon: "trending-up" }),
          item("/settings/private", "Private mode", "Keep the store behind a landing page and a password while it is not ready, and preview it as staff.", { area: "settings", icon: "lock" }),
          item("/settings/cookies", "Cookies and tracking", "The cookies the store sets, its tracking tools and consents.", { area: "settings", icon: "cookie" }),
          item("/settings/accessibility", "Accessibility", "What has been checked against the accessibility requirements, and a draft accessibility statement for the site.", { area: "settings", icon: "accessibility" }),
        ],
      },
      {
        heading: "Tools",
        items: [
          item("/search", "Search", "How the store's search works: keywords, meaning and what shoppers searched for.", { area: "settings", feature: "shop", icon: "search" }),
          item("/settings/ai", "AI", "The AI provider and models the store uses, or its own key.", { area: "settings", icon: "sparkles", workspace: true }),
          item("/settings/api", "Apps and API", "Tokens for your own apps, warehouse or accounting to read and change the store through the Admin API.", { area: "settings", icon: "braces", workspace: true }),
        ],
      },
      {
        heading: "Account",
        items: [
          // The plan and the team are areas of their own (`billing`, `staff`), apart from the settings they sit with.
          item("/billing", "Billing", "The store's plan, what it costs and its invoices.", { area: "billing", icon: "receipt-text", basic: true, customer: true }),
          item("/staff", "Team", "Who can work in the store's admin, their roles, collaborators with an end date, and two-step sign-in.", { area: "staff", icon: "user-cog", basic: true, workspace: true }),
          // The audit log, named apart from a customer's Activities (D468): ecosystem plan E3.7, D718.
          item("/activity", "Change log", "Who changed what and when: products, prices, pages, discounts, shipping, staff and payment settings.", { area: "settings", icon: "file-clock", workspace: true }),
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
 * a section and a hub's card with none left are not drawn. `STORE_SECTIONS` itself stays whole: `sectionOf()` and the permissions (`STORE_NAV_AREAS`) read it.
 */
export function storeSections(flags: StoreFlags, canOpen?: CanOpen): StoreSection[] {
  // A workspace (D748 E7) offers only its extensions' pages and those marked for it, never a store-only extension's (A/B tests need a site).
  const workspace = !Array.isArray(flags) && (flags as { workspace?: boolean }).workspace === true;
  const working = new Set<ExtensionId>(
    (Array.isArray(flags) ? EXTENSION_IDS : storeExtensionsOn(flags as { extensionFacts?: unknown })).filter((id) => !workspace || !STORE_ONLY_EXTENSIONS.includes(id)),
  );
  const ours = (part: { extension?: ExtensionId; workspace?: true | ExtensionId }) =>
    !workspace || part.extension !== undefined || part.workspace === true || (part.workspace !== undefined && working.has(part.workspace));
  const on = (part: { feature?: FeatureRequirement; extension?: ExtensionId }) => requirementMet(flags, part.feature) && (!part.extension || working.has(part.extension));
  const house = !Array.isArray(flags) && (flags as { house?: boolean }).house === true;
  const open = (path: string) => !canOpen || canOpen(path);
  return STORE_SECTIONS.filter((s) => on(s))
    .map((s) => {
      const groups = s.groups.map((g) => ({ ...g, items: g.items.filter((i) => on(i) && ours(i) && open(i.path) && !(house && i.customer)) })).filter((g) => g.items.length > 0);
      // A section whose main page is hidden opens on the first page it has left (D178 step 5: a website's Customers open on Privacy requests).
      // A page that is aside (Custom fields under Products) is never where a tab leads: a website's Products tab would open on Custom fields.
      const left = groups.flatMap((g) => g.items.filter((i) => !i.aside).map((i) => i.path));
      const start = s.hub || left.length === 0 || left.includes(s.start) ? s.start : left[0];
      return { section: { ...s, start, groups }, onlyAside: !s.hub && left.length === 0 && groups.length > 0 };
    })
    .filter(({ section, onlyAside }) => (!(canOpen || workspace) || section.groups.length > 0) && !onlyAside)
    .map(({ section }) => section);
}

/** Addresses inside a section, after the store's: its hub (if it has one) and every page in its sidebar. */
export const sectionPaths = (section: StoreSection): string[] => [...(section.hub ? [section.start] : []), ...section.groups.flatMap((g) => g.items.flatMap(itemPaths))];

/** A page's own address and the others that are it (`also`). */
function itemPaths(item: Pick<StoreItem, "path" | "also">): string[] {
  return [item.path, ...(item.also ?? [])];
}

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

/** An address of the navigation with the permission area of the page there (D851). */
export type NavArea = { path: string; area: Area };

/**
 * Every address the navigation names, with the area of the page there (D851): each item's own (its path and `also`), the pages `within` it,
 * and each page of cards (`hub`), which is its section's own page. The section an item is listed in plays no part.
 */
export function navAreas(sections: readonly StoreSection[]): NavArea[] {
  return sections.flatMap((section) => [
    ...(section.hub ? [{ path: section.start, area: section.key }] : []),
    ...section.groups.flatMap((g) => g.items.flatMap((i) => [...itemPaths(i).map((path) => ({ path, area: i.area })), ...(i.within ?? [])])),
  ]);
}

/** The area of an address by the longest address of the navigation it is or is inside (`navAreas()`); undefined for Home's pages. */
export function areaIn(areas: readonly NavArea[], path: string): Area | undefined {
  let best: NavArea | undefined;
  for (const entry of areas) {
    if ((path === entry.path || path.startsWith(`${entry.path}/`)) && (!best || entry.path.length > best.path.length)) best = entry;
  }
  return best?.area;
}

/** The store navigation's addresses with their areas, read once: `areaOfPath()` serves every guard's key and every link of the menu. */
export const STORE_NAV_AREAS: readonly NavArea[] = navAreas(STORE_SECTIONS);

/** Pages with no section: Home, the setup steps and the AI manager. */
export const HOME_PATHS = ["/setup", "/assistant"];

/** Where the cards of a page of cards or the sidebar link to. */
export const storeLink = (base: string, item: Pick<StoreItem, "path" | "exact">) => ({ href: `${base}${item.path}`, ...(item.exact && { exact: true as const }) });

type Link = { href: string; label: string; exact?: boolean; icon?: NavIconName; advanced?: boolean; also?: string[] };

/**
 * A tab of the store's menu. Home names the addresses that are its own (`also`); a section's tab names its section (`section`), whose
 * addresses its sidebar (`StoreArea`) already carries as `prefixes`: the browser looks them up there, so each address is sent once as a
 * prefix and not a second time on the tab (bloat review step 2.28).
 */
export type StoreTab = Link & { icon: NavIconName; also?: string[]; section?: string; badge?: number; foot?: boolean };

/** A section's sidebar, by the addresses inside it (`prefixes`; a page of cards in `exact`), keyed as its tab is (`section`, Home's `home`). */
export type StoreArea = { section: string; prefixes: string[]; exact?: string[]; groups: { heading: string; items: Link[] }[] };

/** Whether a section's page is left out of the Basic view (D454): one not marked `basic`, unless it is where the section's tab leads. */
export const advancedIn = (section: Pick<StoreSection, "start">, item: Pick<StoreItem, "path" | "basic">): boolean => !item.basic && item.path !== section.start;

function tabsOf(base: string, sections: StoreSection[], counts: Partial<Record<StoreSection["key"], number>>): StoreTab[] {
  return [
    { href: base, label: "Home", icon: "home", exact: true, also: HOME_PATHS.map((p) => `${base}${p}`) },
    ...sections.map((s) => ({
      href: `${base}${s.start}`,
      label: s.label,
      icon: s.icon,
      ...(s.hub && { exact: true }),
      ...(counts[s.key] ? { badge: counts[s.key] } : {}),
      // Settings sit at the foot of the rail (docs/admin-style.md 5.3); in the tabs and the menu they keep their place.
      ...(s.key === "settings" && { foot: true }),
      // The page of cards is the tab's own address; only the pages in the sidebar are inside it (Design is `/settings/design`, the Website's):
      // the sidebar's `prefixes`, looked up by this key in the browser (`useIsCurrent()`).
      section: s.key,
    })),
  ];
}

/**
 * The tabs of a store's admin: Home, then each section offered, with the addresses inside it. A page of cards marks only itself, its pages are
 * inside their own section. `counts` puts a number on a section's tab (Support: the conversations waiting for a person, D216).
 */
export function storeTabs(base: string, flags: StoreFlags, canOpen?: CanOpen, counts: Partial<Record<StoreSection["key"], number>> = {}): StoreTab[] {
  return tabsOf(base, storeSections(flags, canOpen), counts);
}

function areasOf(base: string, sections: StoreSection[]): StoreArea[] {
  return [
    { section: "home", prefixes: HOME_PATHS.map((p) => `${base}${p}`), exact: [base], groups: [] },
    ...sections.map((s) => ({
      section: s.key,
      prefixes: s.groups.flatMap((g) => g.items.flatMap((i) => itemPaths(i).map((p) => `${base}${p}`))),
      ...(s.hub && { exact: [`${base}${s.start}`] }),
      groups: s.groups.map((g) => ({
        heading: g.heading,
        items: g.items.map((i) => ({
          label: i.label,
          icon: i.icon,
          ...storeLink(base, i),
          ...(i.also && { also: i.also.map((p) => `${base}${p}`) }),
          ...(advancedIn(s, i) && { advanced: true }),
        })),
      })),
    })),
  ];
}

/** The sidebar of each section (none for Home), by the addresses inside it: a section's page of cards matches only itself. */
export function storeAreas(base: string, flags: StoreFlags, canOpen?: CanOpen): StoreArea[] {
  return areasOf(base, storeSections(flags, canOpen));
}

/** The tabs and the sidebars from one reading of the sections: a menu build asks `canOpen` once per item, not twice (bloat review step 0.17). */
export function storeNav(base: string, flags: StoreFlags, canOpen?: CanOpen, counts: Partial<Record<StoreSection["key"], number>> = {}): { tabs: StoreTab[]; areas: StoreArea[] } {
  const sections = storeSections(flags, canOpen);
  return { tabs: tabsOf(base, sections, counts), areas: areasOf(base, sections) };
}
