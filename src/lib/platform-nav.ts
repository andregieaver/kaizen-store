/**
 * The platform admin's sections (D144), pure data for its layout, its hub pages and the tests that keep them in step
 * with the admin map. Each section has a tab and, where it has pages of its own, a sidebar; Home, Stores, Themes, Customers
 * and Requests have none. Themes is a section of its own beneath Website (D285): its page holds the themes, the demo stores,
 * the starting content and the theme store's own pages.
 */

import type { NavIconName } from "@/components/admin/nav-icons";
import { HOUSE_SLUG } from "@/lib/house-routing";

import type { PlatformArea } from "./platform-access";

export const PLATFORM_BASE = "/admin/platform";

/**
 * A page in a section's sidebar and on its page of cards, with the icon drawn beside its label (D454) and its own permission area (D851):
 * what `platformAreaOfPath()` reads for the page and the pages under it, whichever section's list it is in.
 */
export type SectionItem = { path: string; label: string; description: string; icon: NavIconName; area: PlatformArea; exact?: boolean };

/** A sidebar's page: its address, label, card line, icon and area (D851: its own; moving it to another list moves it in the menu only). */
const item = (path: string, label: string, description: string, icon: NavIconName, area: PlatformArea, exact = false): SectionItem => ({ path, label, description, icon, area, exact });

export const WEBSITE_ITEMS: SectionItem[] = [
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
];

/** Kaizena Flow's own store (D466, `docs/platform-parity-plan.md`): made by its migration at this address, never moved (`HOUSE_SLUG`). */
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

export const PLAN_ITEMS: SectionItem[] = [
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
];

/** Support (D216): Kaizen's own desk, and the chat assistant that answers its visitors first. */
export const SUPPORT_ITEMS: SectionItem[] = [
  item("/support", "Inbox", "Kaizena Flow's support desk: conversations with visitors of Kaizena Flow's site and owners asking Kaizena Flow, live.", "inbox", "support", true),
  // The same names as a store's support (ecosystem plan E3.7, D718).
  item("/support/reports", "Support reports", "How Kaizena Flow's own desk did: conversations, the AI alone, waiting times, ratings and topics.", "chart-column", "support"),
  item("/support/stores", "Stores", "Each store's support in figures: counts and rates only, never a conversation.", "store", "support"),
  item("/support/replies", "Saved replies", "Texts Kaizena Flow's people put in an answer with / in the inbox, filled in with names.", "message-text", "support"),
  item("/chat", "Chat assistant", "Kaizena Flow's public site chat assistant and its knowledge base.", "bot", "support"),
  item("/support/widgets", "Website chat", "Kaizena Flow's chat on its other websites: widgets with their own look, each with a tag to paste on its sites.", "globe", "support"),
  item("/support/settings", "Support settings", "Who answers Kaizena Flow's visitors (the assistant alone, the AI first, or people only), opening hours, email follow-up and how long conversations are kept.", "settings-2", "support"),
];

export const SETTINGS_ITEMS: SectionItem[] = [
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
];

/** What the platform's pages of cards say at the top (D144), shown through `navWord()` like the rest of the navigation (D312 A2). */
/** The two hubs' titles, as the navigation names them (shown through `navWord()`, so in the account's language). */
export const PLATFORM_HUB_TITLES = { website: "Website", settings: "Settings" } as const;

export const PLATFORM_HUB_INTROS = {
  website: "Everything that makes Kaizena Flow's own site: build its pages and blog, keep its pictures, menus, header, footer and fonts.",
  settings: "How Kaizena Flow's site is found, what it sets, how it takes payment, its AI, emails and languages.",
};

/**
 * The platform's pages outside a sidebar, each with its own area (D851), as a sidebar's page names its own: the two pages of cards, the tabs
 * with no sidebar (Themes is the website's; Stores, Customers and Access requests the stores') and the docs portal's folder (the website's).
 * Step 1.18 of the code review puts them on one structure with the sections; until then their area is written here. Home is `home`, and an
 * address in none of these or the sidebars is the owners' (`settings`): the AI manager's, and a new folder until it is given one.
 */
export const PLATFORM_PAGE_AREAS: readonly { path: string; area: PlatformArea }[] = [
  { path: "/website", area: "website" },
  { path: "/themes", area: "website" },
  { path: "/docs", area: "website" },
  { path: "/stores", area: "stores" },
  { path: "/customers", area: "stores" },
  { path: "/requests", area: "stores" },
  { path: "/settings", area: "settings" },
];

/** Addresses inside a section: its hub page and every page in its sidebar. */
export const sectionPrefixes = (hub: string | null, items: SectionItem[]) => [...(hub ? [`${PLATFORM_BASE}${hub}`] : []), ...items.map((i) => `${PLATFORM_BASE}${i.path}`)];

export const withBase = (items: SectionItem[]) =>
  items.map((i) => ({ href: `${PLATFORM_BASE}${i.path}`, label: i.label, icon: i.icon, ...(i.exact && { exact: true as const }) }));

type Tab = { href: string; label: string; icon: NavIconName; exact?: boolean; also?: string[]; badge?: number; foot?: boolean };

/**
 * The platform's sections as tabs, or as the rail's tiles (D219): Home, then each section with the addresses inside it, and Settings at
 * the rail's foot. `requests` and `support` are the counts waiting (access requests, and Kaizen's own desk's conversations, D216).
 */
export function platformTabs(counts: { requests?: number; support?: number } = {}): Tab[] {
  const base = PLATFORM_BASE;
  return [
    { href: base, label: "Home", exact: true, icon: "home" },
    { href: `${base}/website`, label: PLATFORM_HUB_TITLES.website, icon: "monitor", also: sectionPrefixes("/website", WEBSITE_ITEMS) },
    // Themes (D285): a section of its own beneath Website, with no sidebar; the theme store's pages are edited from its page.
    { href: `${base}/themes`, label: "Themes", icon: "palette" },
    { href: `${base}/stores`, label: "Stores", icon: "shopping-bag" },
    { href: `${base}/customers`, label: "Customers", icon: "users" },
    { href: `${base}/plans`, label: "Plans", icon: "credit-card", also: sectionPrefixes(null, PLAN_ITEMS) },
    // Access requests, named apart from a store's support Requests (ecosystem plan E3.7, D718).
    { href: `${base}/requests`, label: "Access requests", icon: "bell", ...(counts.requests ? { badge: counts.requests } : {}) },
    { href: `${base}/support`, label: "Support", icon: "chat", also: sectionPrefixes(null, SUPPORT_ITEMS), ...(counts.support ? { badge: counts.support } : {}) },
    { href: `${base}/settings`, label: PLATFORM_HUB_TITLES.settings, icon: "cog", also: sectionPrefixes("/settings", SETTINGS_ITEMS), foot: true },
  ];
}
