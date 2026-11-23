/**
 * The platform admin's sections (D144), pure data for its layout, its hub pages and the tests that keep them in step with the admin
 * map, built as a store's are (`STORE_SECTIONS`, D147): one structure, `PLATFORM_SECTIONS` (code review step 1.18, D877), from which the
 * tabs, the sidebars, the pages of cards and every page's permission area are derived. Each section has a tab and, where it has pages of
 * its own, a sidebar; Themes, Stores, Customers and Access requests have none. Themes is a section of its own beneath Website (D285): its
 * page holds the themes, the demo stores, the starting content and the theme store's own pages.
 */

import type { NavIconName } from "@/components/admin/nav-icons";
import { HOUSE_SLUG } from "@/lib/house-routing";

import type { PlatformArea, PlatformNavArea } from "./platform-access";

export const PLATFORM_BASE = "/admin/platform";

/**
 * A page in a section's sidebar and on its page of cards, with the icon drawn beside its label (D454) and its own permission area (D851):
 * what `platformAreaOfPath()` reads for the page and the pages under it, whichever section it is listed in.
 */
export type PlatformItem = { path: string; label: string; description: string; icon: NavIconName; area: PlatformArea; exact?: boolean };
export type PlatformGroup = { heading: string; items: PlatformItem[] };

export type PlatformSection = {
  /** The section's key: its tab's and sidebar's (`NavItem.section`), and the key a count is given by (`platformTabs()`). */
  key: "website" | "themes" | "stores" | "customers" | "plans" | "requests" | "support" | "settings";
  /** The section's name in the menu, the title of its page of cards and the word above its pages' titles (D873). */
  label: string;
  icon: NavIconName;
  /** The tab's address after the platform's: the section's page of cards, its only page, or the page of its sidebar it opens on. */
  start: string;
  /** A page of cards instead of a main page; the section's sidebar leads to the same pages. */
  hub: boolean;
  /** What its page of cards says at the top (a hub's only; shown through `navWord()` like the rest of the navigation, D312 A2). */
  intro?: string;
  /**
   * The permission area (D851) of the section's own page (its page of cards, or the only page of a section with no sidebar) and of its
   * `also`; where the tab opens a page of its sidebar, that page's (a test holds them equal). Its items name their own.
   */
  area: PlatformArea;
  /** Addresses inside the section that no page of its sidebar holds, of the section's area: the docs portal's folder (its pages are items). */
  also?: string[];
  /** The sidebar; none for a section with no pages besides its own. */
  groups: PlatformGroup[];
};

/** A sidebar's page: its address, label, card line, icon and area (D851: its own; moving it to another section moves it in the menu only). */
const item = (path: string, label: string, description: string, icon: NavIconName, area: PlatformArea, exact = false): PlatformItem => ({ path, label, description, icon, area, exact });

export const PLATFORM_SECTIONS: PlatformSection[] = [
  {
    key: "website",
    label: "Website",
    icon: "monitor",
    start: "/website",
    hub: true,
    intro: "Everything that makes Kaizena Flow's own site: build its pages and blog, keep its pictures, menus, header, footer and fonts.",
    area: "website",
    also: ["/docs"],
    groups: [
      {
        heading: "Website",
        items: [
          item("/pages", "Pages", "Kaizena Flow's own pages, built in the page builder: draft, publish, and choose the front page, blog page and 404 page.", "files", "website"),
          item("/articles", "Blog", "Kaizena Flow's blog: articles, their categories and tags.", "newspaper", "website"),
          item("/content", "Content", "Kaizena Flow's own kinds of content: entries listed on its pages, each with a page if you like.", "library", "website"),
          item("/media", "Media", "Pictures and videos for Kaizena Flow's pages, searchable, with alt texts.", "image", "website"),
          item("/templates", "Templates", "The marketplace's templates, store owners' and Kaizena Flow's own: hide one from every store's list, or show it again.", "layout-template", "website"),
          item("/menus", "Menus", "Lists of links for Kaizena Flow's header, footer and pages.", "menu", "website"),
          item("/forms", "Forms", "Kaizena Flow's contact forms and newsletter sign-ups to place on any page, and what visitors sent with them.", "clipboard-list", "website"),
          item("/headers", "Header", "Headers built from components; choose the one Kaizena Flow's site shows.", "panel-top", "website"),
          item("/footers", "Footer", "Footers built from components; choose the one Kaizena Flow's site shows.", "panel-bottom", "website"),
          item("/fonts", "Fonts", "The self-hosted fonts Kaizena Flow's pages use.", "type", "website"),
          item("/site-design", "Design", "The themes installed on Kaizena Flow's own site: add a published theme, switch the site to it and back.", "palette", "website"),
          item("/docs/feedback", "Docs feedback", "What readers said under each page of the docs: whether it helped, and the sentence some add.", "message-square", "website"),
          item("/docs/guide", "Docs guide", "The AI guide that answers readers in the docs from the docs alone: on or off, its name, picture, greeting and daily limit.", "bot", "website"),
        ],
      },
    ],
  },
  // Themes (D285): a section of its own beneath Website, with no sidebar; the theme store's pages are edited from its page. The website's.
  { key: "themes", label: "Themes", icon: "palette", start: "/themes", hub: false, area: "website", groups: [] },
  // Stores, Customers and Access requests are the stores' (D510: the support role changes them).
  { key: "stores", label: "Stores", icon: "shopping-bag", start: "/stores", hub: false, area: "stores", groups: [] },
  { key: "customers", label: "Customers", icon: "users", start: "/customers", hub: false, area: "stores", groups: [] },
  {
    key: "plans",
    label: "Plans",
    icon: "credit-card",
    start: "/plans",
    hub: false,
    area: "plans",
    groups: [
      {
        heading: "Plans",
        items: [
          item("/plans", "Editor", "Kaizena Flow's plans, their prices and fees, synced to Stripe.", "credit-card", "plans", true),
          item("/plans/limits", "Limits", "What each plan includes of storage, products, staff, domains, emails, AI and traffic, and the default for stores without a plan.", "gauge", "plans"),
          // Named apart from the store's own pages (ecosystem plan E3.7, D718): a store's Features switch them, its Analytics are its figures.
          item("/plans/features", "Plan features", "Every feature with a tick for each plan that includes it: the comparison stores see.", "toggle", "plans"),
          item("/plans/extensions", "Extensions", "The paid extensions: their sizes and prices, the bundles, and what each plan includes.", "blocks", "plans"),
          item("/plans/accounts", "Accounts", "Each account's billing, and the move of accounts billed store by store to one plan.", "users", "plans"),
          item("/plans/analytics", "Plan analytics", "What the stores' plans earn every month, how that moved, and how many who ask for a store end up paying.", "chart-column", "plans"),
          item("/plan-reminders", "Reminders", "Emails to owners who left a plan checkout.", "bell", "plans"),
          item("/discounts", "Discounts", "Discount codes for stores' plans.", "ticket", "plans"),
          item("/referrals", "Referrals", "Kaizena Flow's referral program: commission, referrers, referred stores.", "share", "plans"),
        ],
      },
    ],
  },
  // Access requests, named apart from a store's support Requests (ecosystem plan E3.7, D718); its tab counts those waiting.
  { key: "requests", label: "Access requests", icon: "bell", start: "/requests", hub: false, area: "stores", groups: [] },
  {
    // Support (D216): Kaizen's own desk, and the chat assistant that answers its visitors first; its tab counts the conversations waiting.
    key: "support",
    label: "Support",
    icon: "chat",
    start: "/support",
    hub: false,
    area: "support",
    groups: [
      {
        heading: "Support",
        items: [
          item("/support", "Inbox", "Kaizena Flow's support desk: conversations with visitors of Kaizena Flow's site and owners asking Kaizena Flow, live.", "inbox", "support", true),
          // The same names as a store's support (ecosystem plan E3.7, D718).
          item("/support/reports", "Support reports", "How Kaizena Flow's own desk did: conversations, the AI alone, waiting times, ratings and topics.", "chart-column", "support"),
          item("/support/stores", "Stores", "Each store's support in figures: counts and rates only, never a conversation.", "store", "support"),
          item("/support/replies", "Saved replies", "Texts Kaizena Flow's people put in an answer with / in the inbox, filled in with names.", "message-text", "support"),
          item("/chat", "Chat assistant", "Kaizena Flow's public site chat assistant and its knowledge base.", "bot", "support"),
          item("/support/widgets", "Website chat", "Kaizena Flow's chat on its other websites: widgets with their own look, each with a tag to paste on its sites.", "globe", "support"),
          item("/support/settings", "Support settings", "Who answers Kaizena Flow's visitors (the assistant alone, the AI first, or people only), opening hours, email follow-up and how long conversations are kept.", "settings-2", "support"),
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
    intro: "How Kaizena Flow's site is found, what it sets, how it takes payment, its AI, emails and languages.",
    area: "settings",
    groups: [
      {
        heading: "Settings",
        items: [
          item("/navigation", "Header and footer", "Kaizena Flow's logos, icon, business details and which menus its standard header and footer show.", "panels-top-left", "settings"),
          item("/experiments", "A/B tests", "Every store's A/B tests: what is running, what needs a look and what waits for a decision.", "flask", "settings"),
          // Named apart from the store's pages (ecosystem plan E3.7, D718): a store's Search is its search, its VAT its VAT reports.
          item("/search-test", "Search test", "The search experiment: keyword against hybrid search.", "search", "settings"),
          item("/seo", "SEO", "How search engines and AI crawlers see Kaizena Flow's site.", "trending-up", "settings"),
          item("/cookies", "Cookies", "Kaizena Flow's cookies, tracking tools and consents.", "cookie", "settings"),
          item("/vat", "VAT rates", "VAT categories and rates per country with history, the rates nobody has verified yet, and how shipping is taxed.", "percent", "settings"),
          item("/duty-rates", "Duty rates", "The duty rates and thresholds per country that stores' customs estimates are worked out from, each with its source and whether a person verified it.", "container", "settings"),
          item("/retention", "Data retention", "How long each kind of personal data is kept, where each period comes from, and what the daily job removed.", "clock", "settings"),
          item("/processing", "Record of processing", "What Kaizena Flow does with personal data, purpose by purpose (GDPR Art. 30), drawn from the register.", "shield-check", "settings"),
          item("/google-reviews", "Google reviews", "Kaizena Flow's own Google reviews for testimonials.", "star", "settings"),
          item("/instagram", "Instagram", "Kaizena Flow's own Instagram account, for the Instagram feeds on its pages.", "image", "settings"),
          item("/stripe", "Stripe", "Kaizena Flow's Stripe webhooks per mode, the default fee per sale and the checkout's look.", "credit-card", "settings"),
          item("/ai", "AI", "Kaizena Flow's default AI provider and models.", "sparkles", "settings", true),
          item("/ai/usage", "AI usage", "What every store, owner and Kaizena Flow itself used of the AI.", "chart-column", "settings"),
          item("/status", "Status page", "The public status page: each part's checks every five minutes, incidents to post and update, and their subscribers.", "activity", "settings"),
          item("/integrations", "Integrations", "Kaizena Flow's own news to Slack, Zapier or Make: a store asked for, made or opened, a plan started or ended, a notice of illegal content.", "puzzle", "settings"),
          item("/workflows", "Workflows", "When something happens on the platform, or at a set time: check and act. An email to the owners, a Slack message or a signed request.", "workflow", "settings"),
          item("/oauth", "AI assistants and apps", "The AI assistants and apps people connected through Kaizena Flow's sign-in, to verify or block.", "plug", "settings"),
          item("/apps", "App listings", "Apps that ask to be listed in the app directory, to approve or decline.", "puzzle", "settings"),
          // Notices of illegal content (DSA), named apart from Reports and the AI manager's notices (ecosystem plan E3.7, D718).
          item("/reports", "Content notices", "Notices people sent about illegal content on stores, each decided with its reason (DSA).", "flag", "settings"),
          item("/challenges", "100-day challenge", "Every store the autopilot runs alone for 100 days: what holds it up, what waits on its owner, its AI cost and the three ratios; setting and ending a challenge.", "target", "settings"),
          item("/capacity", "Usage and limits", "What every store used this month against its limits: storage, products, staff, visits, emails and AI.", "gauge", "settings"),
          item("/domains", "Domains", "Domains stores buy through Kaizena Flow: prices per currency, which stores may buy, registrations and purchases that need a look.", "link", "settings"),
          item("/ai/prices", "AI prices", "What each model costs per million tokens, per picture, per audio minute and per million characters, so the usage pages can show cost.", "coins", "settings"),
          item("/emails", "Emails", "Every email Kaizena Flow and the stores sent, and email setup.", "mail", "settings"),
          item("/languages", "Languages", "The languages stores can offer, and where each one's interface text stands.", "languages", "settings"),
          item("/team", "Team", "Who runs Kaizena Flow: the platform admins, whether each has two-step sign-in, and adding or removing one.", "user-cog", "settings"),
          // The audit log, as a store's is named (ecosystem plan E3.7, D718).
          item("/activity", "Change log", "What platform admins and the platform did: two-step sign-in events, approvals and settings, with who did it and when.", "file-clock", "settings"),
        ],
      },
    ],
  },
];

/**
 * Pages with no section, Home's as a store's AI manager is (`HOME_PATHS`): the AI manager, the platform's tool from every page. It can do
 * anything on the platform, so its area is the owners' (D510).
 */
export const PLATFORM_HOME_PATHS: readonly PlatformNavArea[] = [{ path: "/assistant", area: "settings" }];

/** Kaizena Flow's own store (D466): made by its migration at this address, never moved (`HOUSE_SLUG`). */
export const HOUSE_STORE_SLUG = HOUSE_SLUG;

/**
 * Kaizena Flow's own store as the first card of the Website hub (D466): a store's admin of its own, where its customers, subscribers and
 * email are kept and its site moves step by step. A card only, outside the sidebar: it leads to another level.
 */
export const HOUSE_STORE_CARD = {
  path: "",
  href: `/admin/${HOUSE_STORE_SLUG}`,
  label: "Kaizena Flow's store",
  description: "Kaizena Flow's own store, with every page a store's admin has: its customers, subscribers, email and, step by step, its site.",
  icon: "store" as NavIconName,
};

/** A section's pages, in its sidebar's order. */
export const platformItemsOf = (section: Pick<PlatformSection, "groups">): PlatformItem[] => section.groups.flatMap((g) => g.items);

/** One section by its key. */
export const platformSection = (key: PlatformSection["key"]): PlatformSection => PLATFORM_SECTIONS.find((s) => s.key === key)!;

/** Whether the section's tab opens a page of its own, not a page of its sidebar: a page of cards, or a section with no sidebar. */
const ownStart = (section: PlatformSection) => !platformItemsOf(section).some((i) => i.path === section.start);

/** Addresses inside a section, after the platform's: its own page, the addresses no page of its sidebar holds (`also`) and its sidebar's pages. */
export const platformSectionPaths = (section: PlatformSection): string[] => [
  ...(ownStart(section) ? [section.start] : []),
  ...(section.also ?? []),
  ...platformItemsOf(section).map((i) => i.path),
];

/**
 * Every address the platform's navigation names, with the area of the page there (D851): Home's pages, each section's own page and `also`
 * (the section's area), and every page of a sidebar (its own). The section a page is listed in decides nothing for it.
 */
export function platformNavAreas(sections: readonly PlatformSection[] = PLATFORM_SECTIONS): PlatformNavArea[] {
  return [
    ...PLATFORM_HOME_PATHS,
    ...sections.flatMap((s) => [
      ...(ownStart(s) ? [{ path: s.start, area: s.area }] : []),
      ...(s.also ?? []).map((path) => ({ path, area: s.area })),
      ...platformItemsOf(s).map(({ path, area }) => ({ path, area })),
    ]),
  ];
}

/** The navigation's addresses with their areas, read once: `platformAreaOfPath()` serves the role notice and the guards' scan test. */
export const PLATFORM_NAV_AREAS: readonly PlatformNavArea[] = platformNavAreas();

const at = (path: string) => `${PLATFORM_BASE}${path}`;

type Link = { href: string; label: string; icon: NavIconName; exact?: true };

/** A tab of the platform's menu, as a store's (`StoreTab`): a section's tab names its section, whose sidebar carries its addresses. */
export type PlatformTab = Link & { also?: string[]; section?: string; badge?: number; foot?: true; home?: true };

/** A section's sidebar, by the addresses inside it (`prefixes`; a page of cards in `exact`), keyed as its tab is (`section`, Home's `home`). */
export type PlatformPlace = { section: string; prefixes: string[]; exact?: string[]; groups: { heading: string; items: Link[] }[] };

/**
 * The platform's sections as tabs, or as the rail's tiles (D219): Home, then each section, Settings at the rail's foot. A count puts a
 * number on a section's tab, by its key: `requests` the access requests waiting, `support` Kaizen's own desk's conversations (D216).
 */
export function platformTabs(counts: Partial<Record<PlatformSection["key"], number>> = {}): PlatformTab[] {
  return [
    // Home is no section: its pages' headers name none (`home`, D873); the AI manager is its, as a store's is.
    { href: PLATFORM_BASE, label: "Home", icon: "home", exact: true, home: true, also: PLATFORM_HOME_PATHS.map((p) => at(p.path)) },
    ...PLATFORM_SECTIONS.map((s) => ({
      href: at(s.start),
      label: s.label,
      icon: s.icon,
      ...(s.hub && { exact: true as const }),
      ...(counts[s.key] ? { badge: counts[s.key] } : {}),
      // Settings sit at the foot of the rail (docs/admin-style.md 5.3); in the tabs and the menu they keep their place.
      ...(s.key === "settings" && { foot: true as const }),
      // The addresses inside it are its sidebar's `prefixes`, looked up by this key in the browser (`currentIndex()`, bloat review step 2.28).
      section: s.key,
    })),
  ];
}

/**
 * The platform's sections (D144), each with its own sidebar or none. Every page of the level is in exactly one, by its address, which also
 * marks the section's tab (D873). A function, so a browser part that reads this file for its areas (the role notice) carries none of it.
 */
export function platformAreas(): PlatformPlace[] {
  return [
    { section: "home", prefixes: PLATFORM_HOME_PATHS.map((p) => at(p.path)), exact: [PLATFORM_BASE], groups: [] },
    ...PLATFORM_SECTIONS.map((s) => ({
      section: s.key,
      // A page of cards matches only itself (`exact`); its pages are inside their own section.
      prefixes: platformSectionPaths(s)
        .filter((p) => !(s.hub && p === s.start))
        .map(at),
      ...(s.hub && { exact: [at(s.start)] }),
      groups: s.groups.map((g) => ({
        heading: g.heading,
        items: g.items.map((i) => ({ href: at(i.path), label: i.label, icon: i.icon, ...(i.exact && { exact: true as const }) })),
      })),
    })),
  ];
}

/** The tabs (with their counts) and the sidebars from one reading of the sections, as `storeNav()` gives a store's layout. */
export function platformNav(counts: Partial<Record<PlatformSection["key"], number>> = {}): { tabs: PlatformTab[]; areas: PlatformPlace[] } {
  return { tabs: platformTabs(counts), areas: platformAreas() };
}
