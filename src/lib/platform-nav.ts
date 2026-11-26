/**
 * The platform admin's sections (D144), pure data for its layout, its hub pages and the tests that keep them in step with the admin
 * map, built as a store's are (`STORE_SECTIONS`, D147): one structure, `PLATFORM_SECTIONS` (code review step 1.18, D877), from which the
 * tabs, the sidebars, the pages of cards and every page's permission area are derived. Each section has a tab and, where it has pages of
 * its own, a sidebar; Themes, Stores, Customers and Access requests have none. Themes is a section of its own beneath Website (D285): its
 * page holds the themes, the demo stores, the starting content and the theme store's own pages. A sidebar's pages are in groups under
 * headings (Settings in six), and the everyday ones are in the Basic view, as a store's are (code review step 2.3, D884).
 */

import type { NavIconName } from "@/components/admin/nav-icons";

import { advancedIn } from "./admin-view";
import type { PlatformArea, PlatformNavArea } from "./platform-access";

export const PLATFORM_BASE = "/admin/platform";

/**
 * A page in a section's sidebar and on its page of cards, with the icon drawn beside its label (D454) and its own permission area (D851):
 * what `platformAreaOfPath()` reads for the page and the pages under it, whichever section it is listed in. `basic` puts it in the Basic
 * view (D884, as a store's `StoreItem.basic`): a page Kaizena Flow's team uses every week; the page a section's tab leads to is in Basic
 * whatever it says (`advancedIn()`).
 */
export type PlatformItem = { path: string; label: string; description: string; icon: NavIconName; area: PlatformArea; exact?: boolean; basic?: boolean };
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

/**
 * A sidebar's page: its address, label, card line, icon and area (D851: its own; moving it to another section moves it in the menu only),
 * and whether it matches its own address alone (`exact`) and is an everyday page (`basic`, D884).
 */
const item = (path: string, label: string, description: string, icon: NavIconName, area: PlatformArea, extra: { exact?: true; basic?: true } = {}): PlatformItem => ({
  path,
  label,
  description,
  icon,
  area,
  ...extra,
});

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
          item("/pages", "Pages", "Kaizena Flow's own pages, built in the page builder: draft, publish, and choose the front page, blog page and 404 page.", "files", "website", { basic: true }),
          item("/articles", "Blog", "Kaizena Flow's blog: articles, their categories and tags.", "newspaper", "website", { basic: true }),
          item("/content", "Content", "Kaizena Flow's own kinds of content: entries listed on its pages, each with a page if you like.", "library", "website"),
          item("/media", "Media", "Pictures and videos for Kaizena Flow's pages, searchable, with alt texts.", "image", "website", { basic: true }),
          item("/templates", "Templates", "The marketplace's templates, store owners' and Kaizena Flow's own: hide one from every store's list, or show it again.", "layout-template", "website"),
          item("/menus", "Menus", "Lists of links for Kaizena Flow's header, footer and pages.", "menu", "website", { basic: true }),
          item("/forms", "Forms", "Kaizena Flow's contact forms and newsletter sign-ups to place on any page, and what visitors sent with them.", "clipboard-list", "website", { basic: true }),
          // Headers and Footers, as the pages, their tab titles and a store's menu name them (D881; the menu said Header and Footer).
          item("/headers", "Headers", "Headers built from components; choose the one Kaizena Flow's site shows.", "panel-top", "website"),
          item("/footers", "Footers", "Footers built from components; choose the one Kaizena Flow's site shows.", "panel-bottom", "website"),
          item("/fonts", "Fonts", "The self-hosted fonts Kaizena Flow's pages use.", "type", "website"),
          item("/site-design", "Design", "The themes installed on Kaizena Flow's own site: add a published theme, switch the site to it and back.", "palette", "website", { basic: true }),
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
          item("/plans", "Editor", "Kaizena Flow's plans, their prices and fees, synced to Stripe.", "credit-card", "plans", { exact: true, basic: true }),
          item("/plans/limits", "Limits", "What each plan includes of storage, products, staff, domains, emails, AI and traffic, and the default for stores without a plan.", "gauge", "plans"),
          // Named apart from the store's own pages (ecosystem plan E3.7, D718): a store's Features switch them, its Analytics are its figures.
          item("/plans/features", "Plan features", "Every feature with a tick for each plan that includes it: the comparison stores see.", "toggle", "plans"),
          item("/plans/extensions", "Extensions", "The paid extensions: their sizes and prices, the bundles, and what each plan includes.", "blocks", "plans"),
          item("/plans/accounts", "Accounts", "Each account's billing, and the move of accounts billed store by store to one plan.", "users", "plans", { basic: true }),
          item("/plans/analytics", "Plan analytics", "What the stores' plans earn every month, how that moved, and how many who ask for a store end up paying.", "chart-column", "plans", { basic: true }),
          item("/plan-reminders", "Reminders", "Emails to owners who left a plan checkout.", "bell", "plans"),
          item("/discounts", "Discounts", "Discount codes for stores' plans.", "ticket", "plans", { basic: true }),
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
          item("/support", "Inbox", "Kaizena Flow's support desk: conversations with visitors of Kaizena Flow's site and owners asking Kaizena Flow, live.", "inbox", "support", { exact: true, basic: true }),
          // The same names as a store's support (ecosystem plan E3.7, D718).
          item("/support/reports", "Support reports", "How Kaizena Flow's own desk did: conversations, the AI alone, waiting times, ratings and topics.", "chart-column", "support", { basic: true }),
          item("/support/stores", "Stores", "Each store's support in figures: counts and rates only, never a conversation.", "store", "support"),
          item("/support/replies", "Saved replies", "Texts Kaizena Flow's people put in an answer with / in the inbox, filled in with names.", "message-text", "support"),
          item("/chat", "Chat assistant", "Kaizena Flow's public site chat assistant and its knowledge base.", "bot", "support", { basic: true }),
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
    intro: "Kaizena Flow's own site, money and tax, AI, apps and connections, privacy and law, and how the platform runs.",
    area: "settings",
    // Six groups (code review step 2.3, D884), where one heading stood over every page; the everyday ones are in Basic.
    groups: [
      {
        // Kaizena Flow's own site, as a store's Site group: how it looks, how it is found and what it sets.
        heading: "Site",
        items: [
          item("/navigation", "Header and footer", "Kaizena Flow's logos, icon, business details and which menus its standard header and footer show.", "panels-top-left", "settings", { basic: true }),
          item("/seo", "SEO", "How search engines and AI crawlers see Kaizena Flow's site.", "trending-up", "settings"),
          item("/cookies", "Cookies", "Kaizena Flow's cookies, tracking tools and consents.", "cookie", "settings"),
          item("/google-reviews", "Google reviews", "Kaizena Flow's own Google reviews for testimonials.", "star", "settings"),
          item("/instagram", "Instagram", "Kaizena Flow's own Instagram account, for the Instagram feeds on its pages.", "image", "settings"),
        ],
      },
      {
        // How Kaizena Flow takes payment, the VAT and duty stores' prices and estimates are worked out from, and the domains it sells.
        heading: "Money and tax",
        items: [
          item("/stripe", "Stripe", "Kaizena Flow's Stripe webhooks per mode, the default fee per sale and the checkout's look.", "credit-card", "settings"),
          // Named apart from a store's VAT, its VAT reports (ecosystem plan E3.7, D718).
          item("/vat", "VAT rates", "VAT categories and rates per country with history, the rates nobody has verified yet, and how shipping is taxed.", "percent", "settings", { basic: true }),
          item("/duty-rates", "Duty rates", "The duty rates and thresholds per country that stores' customs estimates are worked out from, each with its source and whether a person verified it.", "container", "settings"),
          item("/domains", "Domains", "Domains stores buy through Kaizena Flow: prices per currency, which stores may buy, registrations and purchases that need a look.", "link", "settings", { basic: true }),
        ],
      },
      {
        // The AI's models, what it used and what it costs, and the stores the autopilot runs alone.
        heading: "AI",
        items: [
          item("/ai", "AI", "Kaizena Flow's default AI provider and models.", "sparkles", "settings", { exact: true }),
          item("/ai/usage", "AI usage", "What every store, owner and Kaizena Flow itself used of the AI.", "chart-column", "settings", { basic: true }),
          item("/ai/prices", "AI prices", "What each model costs per million tokens, per picture, per audio minute and per million characters, so the usage pages can show cost.", "coins", "settings"),
          item("/challenges", "100-day challenge", "Every store the autopilot runs alone for 100 days: what holds it up, what waits on its owner, its AI cost and the three ratios; setting and ending a challenge.", "target", "settings", { basic: true }),
        ],
      },
      {
        // What Kaizena Flow tells other services, what runs by itself, and the apps and assistants that ask to connect or to be listed.
        heading: "Apps and connections",
        items: [
          item("/integrations", "Integrations", "Kaizena Flow's own news to Slack, Zapier or Make: a store asked for, made or opened, a plan started or ended, a notice of illegal content.", "puzzle", "settings"),
          item("/workflows", "Workflows", "When something happens on the platform, or at a set time: check and act. An email to the owners, a Slack message or a signed request.", "workflow", "settings"),
          item("/oauth", "AI assistants and apps", "The AI assistants and apps people connected through Kaizena Flow's sign-in, to verify or block.", "plug", "settings"),
          item("/apps", "App listings", "Apps that ask to be listed in the app directory, to approve or decline.", "puzzle", "settings", { basic: true }),
        ],
      },
      {
        // Personal data and notices of illegal content (GDPR, DSA).
        heading: "Privacy and law",
        items: [
          item("/retention", "Data retention", "How long each kind of personal data is kept, where each period comes from, and what the daily job removed.", "clock", "settings"),
          item("/processing", "Record of processing", "What Kaizena Flow does with personal data, purpose by purpose (GDPR Art. 30), drawn from the register.", "shield-check", "settings"),
          // Notices of illegal content (DSA), named apart from Reports and the AI manager's notices (ecosystem plan E3.7, D718).
          item("/reports", "Content notices", "Notices people sent about illegal content on stores, each decided with its reason (DSA).", "flag", "settings", { basic: true }),
        ],
      },
      {
        // The platform day to day: whether it is up, what every store used and was sent, its languages and experiments, and who runs it.
        heading: "Running the platform",
        items: [
          // The incident log (D895): errors, warnings and improvements, worked by the autopilot; improvements wait for Approve.
          item("/incidents", "Incidents", "Every error and warning the platform meets and every improvement suggested: what needs you, what is being fixed and what was fixed.", "life-buoy", "settings", { basic: true }),
          // How owners who said yes use the admin (D895 phase 3b): heat figures per screen and recordings with every word hidden.
          item("/admin-use", "Admin use", "Where owners find the admin hard.", "flame", "settings"),
          // Kaizena Flow's own projects (D904 P7.1): they live in its store; this opens them there.
          item("/projects", "Projects", "Kaizena Flow's own projects and checklists, in its store.", "folder-kanban", "settings"),
          item("/status", "Status page", "The public status page: each part's checks every five minutes, incidents to post and update, and their subscribers.", "activity", "settings", { basic: true }),
          item("/capacity", "Usage and limits", "What every store used this month against its limits: storage, products, staff, visits, emails and AI.", "gauge", "settings", { basic: true }),
          item("/emails", "Emails", "Every email Kaizena Flow and the stores sent, and email setup.", "mail", "settings", { basic: true }),
          item("/languages", "Languages", "The languages stores can offer, and where each one's interface text stands.", "languages", "settings"),
          item("/experiments", "A/B tests", "Every store's A/B tests: what is running, what needs a look and what waits for a decision.", "flask", "settings"),
          // Named apart from a store's Search, which is its own search (ecosystem plan E3.7, D718).
          item("/search-test", "Search test", "The search experiment: keyword against hybrid search.", "search", "settings"),
          item("/team", "Team", "Who runs Kaizena Flow: the platform admins, whether each has two-step sign-in, and adding or removing one.", "user-cog", "settings", { basic: true }),
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

/** A link of the menu; `advanced` when the Basic view leaves it out (D884). */
type Link = { href: string; label: string; icon: NavIconName; exact?: true; advanced?: true };

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
        // A page Basic leaves out (D884, as a store's): drawn in Advanced, or while it is the page being viewed.
        items: g.items.map((i) => ({ href: at(i.path), label: i.label, icon: i.icon, ...(i.exact && { exact: true as const }), ...(advancedIn(s, i) && { advanced: true as const }) })),
      })),
    })),
  ];
}

/** The tabs (with their counts) and the sidebars from one reading of the sections, as `storeNav()` gives a store's layout. */
export function platformNav(counts: Partial<Record<PlatformSection["key"], number>> = {}): { tabs: PlatformTab[]; areas: PlatformPlace[] } {
  return { tabs: platformTabs(counts), areas: platformAreas() };
}

/**
 * The section a page after the platform's address is in, by the rule the frame marks its tab by (`currentIndex()`, D873): the one whose
 * address the page is deepest inside, a page of cards on its own address only; undefined for Home's pages (Home and the AI manager). The
 * admin map's groups (D881), so a page's section in the map is the word above its title; `page-names.test.ts` holds the two equal.
 */
export function platformSectionOf(path: string): PlatformSection | undefined {
  let found: PlatformSection | undefined;
  let depth = -1;
  const consider = (section: PlatformSection | undefined, address: string, below: boolean) => {
    if (address.length > depth && (path === address || (below && path.startsWith(`${address}/`)))) [found, depth] = [section, address.length];
  };
  for (const home of PLATFORM_HOME_PATHS) consider(undefined, home.path, true);
  for (const section of PLATFORM_SECTIONS) for (const address of platformSectionPaths(section)) consider(section, address, !(section.hub && address === section.start));
  return found;
}
