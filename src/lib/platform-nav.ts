/**
 * The platform admin's sections (D144), pure data for its layout, its hub pages and the tests that keep them in step
 * with the admin map. Each section has a tab and, where it has pages of its own, a sidebar; Home, Stores, Themes, Customers
 * and Requests have none. Themes is a section of its own beneath Website (D285): its page holds the themes, the demo stores,
 * the starting content and the theme store's own pages.
 */

import type { NavIconName } from "@/components/admin/nav-icons";

export const PLATFORM_BASE = "/admin/platform";

export type SectionItem = { path: string; label: string; description: string; exact?: boolean };

const item = (path: string, label: string, description: string, exact = false): SectionItem => ({ path, label, description, exact });

export const WEBSITE_ITEMS: SectionItem[] = [
  item("/pages", "Pages", "Kaizena Flow's own pages, built in the page builder: draft, publish, and choose the front page, blog page and 404 page."),
  item("/articles", "Blog", "Kaizena Flow's blog: articles, their categories and tags."),
  item("/content", "Content", "Kaizena Flow's own kinds of content: entries listed on its pages, each with a page if you like."),
  item("/media", "Media", "Pictures and videos for Kaizena Flow's pages, searchable, with alt texts."),
  item("/templates", "Templates", "The marketplace's templates, store owners' and Kaizena Flow's own: hide one from every store's list, or show it again."),
  item("/menus", "Menus", "Lists of links for Kaizena Flow's header, footer and pages."),
  item("/headers", "Header", "Headers built from components; choose the one Kaizena Flow's site shows."),
  item("/footers", "Footer", "Footers built from components; choose the one Kaizena Flow's site shows."),
  item("/fonts", "Fonts", "The self-hosted fonts Kaizena Flow's pages use."),
  item("/site-design", "Design", "The themes installed on Kaizena Flow's own site: add a published theme, switch the site to it and back."),
];

export const PLAN_ITEMS: SectionItem[] = [
  item("/plans", "Editor", "Kaizena Flow's plans, their prices and fees, synced to Stripe.", true),
  item("/plans/limits", "Limits", "What each plan includes of storage, products, staff, domains, emails, AI and traffic, and the default for stores without a plan."),
  item("/plans/features", "Features", "Every feature with a tick for each plan that includes it: the comparison stores see."),
  item("/plan-reminders", "Reminders", "Emails to owners who left a plan checkout."),
  item("/discounts", "Discounts", "Discount codes for stores' plans."),
  item("/referrals", "Referrals", "Kaizena Flow's referral program: commission, referrers, referred stores."),
];

/** Support (D216): Kaizen's own desk, and the chat assistant that answers its visitors first. */
export const SUPPORT_ITEMS: SectionItem[] = [
  item("/support", "Inbox", "Kaizena Flow's support desk: conversations with visitors of Kaizena Flow's site and owners asking Kaizena Flow, live.", true),
  item("/support/reports", "Reports", "How Kaizena Flow's own desk did: conversations, the AI alone, waiting times, ratings and topics."),
  item("/support/stores", "Stores", "Each store's support in figures: counts and rates only, never a conversation."),
  item("/support/replies", "Saved replies", "Texts Kaizena Flow's people put in an answer with / in the inbox, filled in with names."),
  item("/chat", "Chat assistant", "Kaizena Flow's public site chat assistant and its knowledge base."),
  item("/support/settings", "Settings", "Who answers Kaizena Flow's visitors (the assistant alone, the AI first, or people only), opening hours, email follow-up and how long conversations are kept."),
];

export const SETTINGS_ITEMS: SectionItem[] = [
  item("/navigation", "Header and footer", "Kaizena Flow's logos, icon, business details and which menus its standard header and footer show."),
  item("/experiments", "A/B tests", "Every store's A/B tests: what is running, what needs a look and what waits for a decision."),
  item("/search-test", "Search", "The search experiment: keyword against hybrid search."),
  item("/seo", "SEO", "How search engines and AI crawlers see Kaizena Flow's site."),
  item("/cookies", "Cookies", "Kaizena Flow's cookies, tracking tools and consents."),
  item("/vat", "VAT", "VAT categories and rates per country with history, the rates nobody has verified yet, and how shipping is taxed."),
  item("/duty-rates", "Duty rates", "The duty rates and thresholds per country that stores' customs estimates are worked out from, each with its source and whether a person verified it."),
  item("/retention", "Data retention", "How long each kind of personal data is kept, where each period comes from, and what the daily job removed."),
  item("/google-reviews", "Google reviews", "Kaizena Flow's own Google reviews for testimonials."),
  item("/stripe", "Stripe", "Kaizena Flow's Stripe webhooks per mode, the default fee per sale and the checkout's look."),
  item("/ai", "AI", "Kaizena Flow's default AI provider and models.", true),
  item("/ai/usage", "AI usage", "What every store, owner and Kaizena Flow itself used of the AI."),
  item("/status", "Status page", "The public status page: each part's checks every five minutes, incidents to post and update, and their subscribers."),
  item("/reports", "Illegal content notices", "Notices people sent about illegal content on stores, each decided with its reason (DSA)."),
  item("/capacity", "Usage and limits", "What every store used this month against its limits: storage, products, staff, visits, emails and AI."),
  item("/domains", "Domains", "Domains stores buy through Kaizena Flow: prices per currency, which stores may buy, registrations and purchases that need a look."),
  item("/ai/prices", "AI prices", "What each model costs per million tokens, per picture, per audio minute and per million characters, so the usage pages can show cost."),
  item("/emails", "Emails", "Every email Kaizena Flow and the stores sent, and email setup."),
  item("/languages", "Languages", "The languages stores can offer, and where each one's interface text stands."),
  item("/activity", "Activity log", "What platform admins and the platform did: two-step sign-in events, approvals and settings, with who did it and when."),
];

/** What the platform's pages of cards say at the top (D144), shown through `navWord()` like the rest of the navigation (D312 A2). */
export const PLATFORM_HUB_INTROS = {
  website: "Everything that makes Kaizena Flow's own site: build its pages and blog, keep its pictures, menus, header, footer and fonts.",
  settings: "How Kaizena Flow's site is found, what it sets, how it takes payment, its AI, emails and languages.",
};

/** Addresses inside a section: its hub page and every page in its sidebar. */
export const sectionPrefixes = (hub: string | null, items: SectionItem[]) => [...(hub ? [`${PLATFORM_BASE}${hub}`] : []), ...items.map((i) => `${PLATFORM_BASE}${i.path}`)];

export const withBase = (items: SectionItem[]) =>
  items.map((i) => ({ href: `${PLATFORM_BASE}${i.path}`, label: i.label, ...(i.exact && { exact: true as const }) }));

type Tab = { href: string; label: string; icon: NavIconName; exact?: boolean; also?: string[]; badge?: number; foot?: boolean };

/**
 * The platform's sections as tabs, or as the rail's tiles (D219): Home, then each section with the addresses inside it, and Settings at
 * the rail's foot. `requests` and `support` are the counts waiting (access requests, and Kaizen's own desk's conversations, D216).
 */
export function platformTabs(counts: { requests?: number; support?: number } = {}): Tab[] {
  const base = PLATFORM_BASE;
  return [
    { href: base, label: "Home", exact: true, icon: "home" },
    { href: `${base}/website`, label: "Website", icon: "monitor", also: sectionPrefixes("/website", WEBSITE_ITEMS) },
    // Themes (D285): a section of its own beneath Website, with no sidebar; the theme store's pages are edited from its page.
    { href: `${base}/themes`, label: "Themes", icon: "palette" },
    { href: `${base}/stores`, label: "Stores", icon: "shopping-bag" },
    { href: `${base}/customers`, label: "Customers", icon: "users" },
    { href: `${base}/plans`, label: "Plans", icon: "credit-card", also: sectionPrefixes(null, PLAN_ITEMS) },
    { href: `${base}/requests`, label: "Requests", icon: "bell", ...(counts.requests ? { badge: counts.requests } : {}) },
    { href: `${base}/support`, label: "Support", icon: "chat", also: sectionPrefixes(null, SUPPORT_ITEMS), ...(counts.support ? { badge: counts.support } : {}) },
    { href: `${base}/settings`, label: "Settings", icon: "cog", also: sectionPrefixes("/settings", SETTINGS_ITEMS), foot: true },
  ];
}
