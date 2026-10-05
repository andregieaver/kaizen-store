/**
 * The store owner's level (D147), pure data for its layout and the tests that keep it in step with the admin map, built like
 * the platform's (D144): a tab for each section with an icon, and a sidebar where the section has pages of its own. Home,
 * Stores and Work have none (Work has its own sub-navigation); Account has its pages in a sidebar. Someone who only works
 * in stores sees Stores, Work (where a store has it on) and their account, without the owner's pages.
 */

import type { NavIconName } from "@/components/admin/nav-icons";

import { WORK_ROOT } from "./work-paths";

export const OWNER_BASE = "/admin";

export type OwnerItem = { path: string; label: string; description: string; exact?: boolean; owner?: boolean };

/** The Account section's pages, after `/admin`: the person's own first, then what concerns the stores they own. */
export const ACCOUNT_ITEMS: OwnerItem[] = [
  { path: "/account", label: "Your account", description: "Your name, picture, password, light or dark, and Kaizen Life.", exact: true },
  { path: "/account/billing", label: "Billing", description: "The plan of each store you own, what it costs and when it renews.", owner: true },
  { path: "/account/usage", label: "AI usage", description: "What the AI used for the stores you own, with what it cost.", owner: true },
  { path: "/account/referrals", label: "Referrals", description: "Your referral link, the stores that opened through it and your credit.", owner: true },
  { path: "/account/wordpress", label: "WordPress", description: "The WordPress plugin, and the sites connected to show your products.", owner: true },
];

/** Addresses inside the Account section besides its pages: Kaizen Life's sign-in return. */
export const ACCOUNT_EXTRA = ["/account/kaizen-life"];

type Link = { href: string; label: string; exact?: boolean };
export type OwnerWho = { owner: boolean; work: boolean };

const accountItems = (who: OwnerWho) => ACCOUNT_ITEMS.filter((i) => who.owner || !i.owner);
const accountPaths = (who: OwnerWho) => [...accountItems(who).map((i) => i.path), ...ACCOUNT_EXTRA];

/** The tabs: Home (owners), Stores, Work (owners, or where a store has it on) and Account. */
export function ownerTabs(who: OwnerWho): (Link & { icon: NavIconName; also?: string[] })[] {
  return [
    ...(who.owner ? [{ href: OWNER_BASE, label: "Home", exact: true, icon: "home" as const }] : []),
    { href: `${OWNER_BASE}/stores`, label: "Stores", icon: "shopping-bag" as const },
    ...(who.work ? [{ href: WORK_ROOT, label: "Work", icon: "briefcase" as const }] : []),
    { href: `${OWNER_BASE}/account`, label: "Account", exact: true, icon: "user" as const, also: accountPaths(who).map((p) => `${OWNER_BASE}${p}`) },
  ];
}

/** The sidebar of each section: none but Account's (for owners), which holds the pages that concern the person and their stores. */
export function ownerAreas(who: OwnerWho): { prefixes: string[]; exact?: string[]; groups: { heading: string; items: Link[] }[] }[] {
  return [
    { prefixes: [], exact: [OWNER_BASE], groups: [] },
    { prefixes: [`${OWNER_BASE}/stores`], groups: [] },
    { prefixes: [WORK_ROOT], groups: [] },
    {
      prefixes: accountPaths(who).map((p) => `${OWNER_BASE}${p}`),
      groups: who.owner ? [{ heading: "Account", items: accountItems(who).map((i) => ({ href: `${OWNER_BASE}${i.path}`, label: i.label, ...(i.exact && { exact: true as const }) })) }] : [],
    },
  ];
}
