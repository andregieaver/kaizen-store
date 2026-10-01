/**
 * The platform admin's sections (D144), pure data for its layout, its hub pages and the tests that keep them in step
 * with the admin map. Each section has a tab and, where it has pages of its own, a sidebar; Home, Stores, Customers and
 * Requests have none.
 */

export const PLATFORM_BASE = "/admin/platform";

export type SectionItem = { path: string; label: string; description: string; exact?: boolean };

const item = (path: string, label: string, description: string, exact = false): SectionItem => ({ path, label, description, exact });

export const WEBSITE_ITEMS: SectionItem[] = [
  item("/pages", "Pages", "Kaizen's own pages, built in the page builder: draft, publish, and choose the front page, blog page and 404 page."),
  item("/articles", "Blog", "Kaizen's blog: articles, their categories and tags."),
  item("/media", "Media", "Pictures and videos for Kaizen's pages, searchable, with alt texts."),
  item("/templates", "Templates", "The marketplace's templates, store owners' and Kaizen's own: hide one from every store's list, or show it again."),
  item("/menus", "Menus", "Lists of links for Kaizen's header, footer and pages."),
  item("/headers", "Header", "Headers built from components; choose the one Kaizen's site shows."),
  item("/footers", "Footer", "Footers built from components; choose the one Kaizen's site shows."),
  item("/fonts", "Fonts", "The self-hosted fonts Kaizen's pages use."),
];

export const PLAN_ITEMS: SectionItem[] = [
  item("/plans", "Editor", "Kaizen's plans, their prices and fees, synced to Stripe.", true),
  item("/plans/features", "Features", "Every feature with a tick for each plan that includes it: the comparison stores see."),
  item("/plan-reminders", "Reminders", "Emails to owners who left a plan checkout."),
  item("/discounts", "Discounts", "Discount codes for stores' plans."),
  item("/referrals", "Referrals", "Kaizen's referral program: commission, referrers, referred stores."),
];

export const SETTINGS_ITEMS: SectionItem[] = [
  item("/navigation", "Header and footer", "Kaizen's logos, icon, business details and which menus its standard header and footer show."),
  item("/search-test", "Search", "The search experiment: keyword against hybrid search."),
  item("/seo", "SEO", "How search engines and AI crawlers see Kaizen's site."),
  item("/cookies", "Cookies", "Kaizen's cookies, tracking tools and consents."),
  item("/google-reviews", "Google reviews", "Kaizen's own Google reviews for testimonials."),
  item("/stripe", "Stripe", "Kaizen's Stripe webhooks per mode, the default fee per sale and the checkout's look."),
  item("/ai", "AI", "Kaizen's default AI provider and models.", true),
  item("/ai/usage", "AI usage", "What every store, owner and Kaizen itself used of the AI."),
  item("/ai/prices", "AI prices", "What each model costs per million tokens, so the usage pages can show cost."),
  item("/chat", "Chat agent", "Kaizen's public site chat agent and its knowledge base."),
  item("/emails", "Emails", "Every email Kaizen and the stores sent, and email setup."),
  item("/languages", "Languages", "The languages stores can offer, and where each one's interface text stands."),
];

/** Addresses inside a section: its hub page and every page in its sidebar. */
export const sectionPrefixes = (hub: string | null, items: SectionItem[]) => [...(hub ? [`${PLATFORM_BASE}${hub}`] : []), ...items.map((i) => `${PLATFORM_BASE}${i.path}`)];

export const withBase = (items: SectionItem[]) =>
  items.map((i) => ({ href: `${PLATFORM_BASE}${i.path}`, label: i.label, ...(i.exact && { exact: true as const }) }));
