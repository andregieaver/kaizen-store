/**
 * The store owner's level (D147), pure data for its layout and the tests that keep it in step with the admin map, built like
 * the platform's (D144): a tab for each section with an icon, and a sidebar where the section has pages of its own. Home,
 * Stores and Work have none (Work has its own sub-navigation); Account has its pages in a sidebar, in groups (D884). Someone
 * who only works in stores sees Stores, Work (where a store has it on) and their account, without the owner's pages.
 */

import type { NavIconName } from "@/components/admin/nav-icons";

import { advancedIn } from "./admin-view";
import { WORK_ROOT } from "./work-paths";

export const OWNER_BASE = "/admin";

/**
 * A page of the Account section, with the icon drawn beside its label (D454). `basic` puts it in the Basic view (D884, as a store's
 * `StoreItem.basic`); Your account, where the tab leads, is in it whatever it says (`advancedIn()`).
 */
export type OwnerItem = { path: string; label: string; description: string; icon: NavIconName; exact?: boolean; owner?: boolean; holder?: boolean; basic?: true };

/**
 * The Account section's pages, after `/admin`, in three groups (code review step 2.3, D884): the person's own first, then what they pay for
 * and use across the stores they own, then what they build or connect.
 */
export const ACCOUNT_GROUPS: { heading: string; items: OwnerItem[] }[] = [
  {
    heading: "Personal",
    items: [
      { path: "/account", icon: "user", label: "Your account", description: "Your name, picture, password, light or dark, and Kaizen Life.", exact: true, basic: true },
      { path: "/account/appearance", icon: "palette", label: "Appearance", description: "Light or dark and the admin's colour scheme, with every scheme shown side by side." },
      { path: "/account/notices", icon: "bell", label: "AI manager notices", description: "What the AI manager finished or waits on while you were away, in every store.", owner: true },
      { path: "/account/kaizen-support", icon: "life-buoy", label: "Kaizena Flow support", description: "Ask Kaizena Flow for help with your stores or your account, and read the answers.", basic: true },
    ],
  },
  {
    heading: "Billing and usage",
    items: [
      { path: "/account/domains", icon: "globe", label: "Your domains", description: "Every domain you hold, which store uses it, renewal, DNS and moving it.", holder: true, basic: true },
      { path: "/account/billing", icon: "receipt-text", label: "Billing", description: "The plan of each store you own, what it costs and when it renews.", owner: true, basic: true },
      { path: "/account/extensions", icon: "blocks", label: "Extensions", description: "The extensions your account has, their trials and prices, and adding or ending one.", owner: true },
      { path: "/account/add", icon: "list-plus", label: "Add to your account", description: "An online store or another extension, one press each to start its free trial.", owner: true, basic: true },
      { path: "/account/usage", icon: "sparkles", label: "AI usage", description: "What the AI used for the stores you own, with what it cost.", owner: true },
      { path: "/account/limits", icon: "gauge", label: "Usage and limits", description: "What each store you own has used this month, against what its plan includes.", owner: true },
      { path: "/account/referrals", icon: "share", label: "Referrals", description: "Your referral link, the stores that opened through it and your credit.", owner: true },
    ],
  },
  {
    heading: "Apps and themes",
    items: [
      { path: "/account/themes", icon: "paintbrush", label: "Your themes", description: "The looks you shared as themes, their review, and how many stores use your themes." },
      { path: "/account/connected", icon: "plug", label: "Connected apps and assistants", description: "The AI assistants and apps you let work with your stores, and Disconnect." },
      { path: "/account/developer", icon: "braces", label: "Developer", description: "Developer mode and your apps for many stores: make one, its secrets, and how many stores installed it." },
      { path: "/account/wordpress", icon: "blocks", label: "WordPress", description: "The WordPress plugin, and the sites connected to show your products.", owner: true },
    ],
  },
];

/** The Account section's pages, in its sidebar's order. */
export const ACCOUNT_ITEMS: OwnerItem[] = ACCOUNT_GROUPS.flatMap((g) => g.items);

/** Where the Account tab leads: Your account, which the Basic view always lists. */
const ACCOUNT_START = { start: "/account" };

/**
 * Addresses inside the Account section besides its pages: Kaizen Life's sign-in return, deleting one's account (D377), changing one's email
 * (D836), and where the theme store's *Try it in your store* lands.
 */
export const ACCOUNT_EXTRA = ["/account/kaizen-life", "/account/delete", "/account/email"];

type Link = { href: string; label: string; exact?: boolean; icon?: NavIconName; advanced?: true };
/** Who the person is at this level: an owner of a store, someone with Work in a store, someone who may read a store's support inbox (D216). */
export type OwnerWho = { owner: boolean; work: boolean; support?: boolean; domains?: boolean; books?: boolean };

/** The owner's combined support inbox (D216): every store where the person may read support. */
export const SUPPORT_PATH = "/account/support";

/** An accountant's clients (B6, D512): the books of every store whose books the person keeps or reads, with what each needs. */
export const BOOKS_PATH = "/account/books";

const shownTo = (who: OwnerWho, item: OwnerItem) => (item.holder ? who.owner || Boolean(who.domains) : who.owner || !item.owner);
const accountItems = (who: OwnerWho) => ACCOUNT_ITEMS.filter((i) => shownTo(who, i));
const accountPaths = (who: OwnerWho) => [...accountItems(who).map((i) => i.path), ...ACCOUNT_EXTRA];

const within = (path: string, root: string) => path === root || path.startsWith(`${root}/`);

/**
 * Whether the page finder offers this person a page of the owner's level (ecosystem plan E2.2, D713), by its path after `/admin`: what
 * the tabs and Account's sidebar show them. The control center is the owners' Home; Support, Books and Work go with their tabs; a page
 * of Account follows its item there (its own pages, such as a domain's purchase, with it); the rest (Stores, your account) is everyone's.
 */
export function ownerOpens(who: OwnerWho, path: string): boolean {
  if (path === "") return who.owner;
  if (within(path, SUPPORT_PATH)) return Boolean(who.support);
  if (within(path, BOOKS_PATH)) return Boolean(who.books);
  if (within(`${OWNER_BASE}${path}`, WORK_ROOT)) return who.work;
  const item = ACCOUNT_ITEMS.filter((i) => !i.exact && within(path, i.path)).sort((a, b) => b.path.length - a.path.length)[0];
  return item ? shownTo(who, item) : true;
}

/** The tabs: Home (owners), Stores, Support (where the person may read a store's inbox, with the number waiting), Books (an accountant's clients, D512), Work (owners, or where a store has it on) and Account. */
export function ownerTabs(who: OwnerWho, counts: { support?: number } = {}): (Link & { icon: NavIconName; also?: string[]; badge?: number; foot?: boolean; home?: true })[] {
  return [
    // Home is no section: its page's header names none (`home`, D873).
    ...(who.owner ? [{ href: OWNER_BASE, label: "Home", exact: true, icon: "home" as const, home: true as const }] : []),
    { href: `${OWNER_BASE}/stores`, label: "Stores", icon: "shopping-bag" as const },
    ...(who.support ? [{ href: `${OWNER_BASE}${SUPPORT_PATH}`, label: "Support", icon: "chat" as const, ...(counts.support ? { badge: counts.support } : {}) }] : []),
    ...(who.books ? [{ href: `${OWNER_BASE}${BOOKS_PATH}`, label: "Books", icon: "book-open" as const }] : []),
    ...(who.work ? [{ href: WORK_ROOT, label: "Work", icon: "briefcase" as const }] : []),
    // Account sits at the rail's foot (D219), as Settings does in a store.
    { href: `${OWNER_BASE}/account`, label: "Account", exact: true, icon: "user" as const, also: accountPaths(who).map((p) => `${OWNER_BASE}${p}`), foot: true },
  ];
}

/** Someone shown every tab of the level: the section a page is in is the same for everyone, whatever each person is shown. */
export const OWNER_EVERY_TAB: OwnerWho = { owner: true, work: true, support: true, books: true, domains: true };
let marking: ReturnType<typeof ownerTabs> | undefined;

/**
 * The section a page after `/admin` is in: the label of the tab the frame marks on it, by its rule (`currentIndex()`, D873: the tab whose
 * address the page is deepest inside, an exact tab's own address for itself only). The admin map's groups (D881), so a page's section in
 * the map is the word above its title; `page-names.test.ts` holds the two equal. Home for the control center; undefined in no tab.
 */
export function ownerSectionOf(path: string): string | undefined {
  marking ??= ownerTabs(OWNER_EVERY_TAB);
  const at = `${OWNER_BASE}${path}`;
  let found: string | undefined;
  let depth = -1;
  for (const tab of marking) {
    for (const [address, below] of [[tab.href, !tab.exact] as const, ...(tab.also ?? []).map((a) => [a, true] as const)]) {
      if (address.length > depth && (at === address || (below && at.startsWith(`${address}/`)))) [found, depth] = [tab.label, address.length];
    }
  }
  return found;
}

/** The sidebar of each section: none but Account's (for owners), which holds the pages that concern the person and their stores, in groups. */
export function ownerAreas(who: OwnerWho): { prefixes: string[]; exact?: string[]; groups: { heading: string; items: Link[] }[] }[] {
  return [
    { prefixes: [], exact: [OWNER_BASE], groups: [] },
    { prefixes: [`${OWNER_BASE}/stores`], groups: [] },
    { prefixes: [`${OWNER_BASE}${SUPPORT_PATH}`], groups: [] },
    { prefixes: [`${OWNER_BASE}${BOOKS_PATH}`], groups: [] },
    { prefixes: [WORK_ROOT], groups: [] },
    {
      prefixes: accountPaths(who).map((p) => `${OWNER_BASE}${p}`),
      // Its groups (D884) with the pages shown to this person; a page the Basic view leaves out is `advanced`, as a store's.
      groups:
        who.owner || who.domains
          ? ACCOUNT_GROUPS.map((group) => ({
              heading: group.heading,
              items: group.items
                .filter((i) => shownTo(who, i))
                .map((i) => ({ href: `${OWNER_BASE}${i.path}`, label: i.label, icon: i.icon, ...(i.exact && { exact: true as const }), ...(advancedIn(ACCOUNT_START, i) && { advanced: true as const }) })),
            })).filter((group) => group.items.length > 0)
          : [],
    },
  ];
}
