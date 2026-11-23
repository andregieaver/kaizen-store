/**
 * Kaizena Flow's own store (D466) as the platform admin links to it: its address and its card on the Website hub. Apart from the platform's
 * navigation (`platform-nav.ts`), which every route that checks a platform admin reaches, so those routes do not reach the host routing
 * it is named from (`house-routing.ts`, D881).
 */

import type { NavIconName } from "@/components/admin/nav-icons";

import { HOUSE_SLUG } from "./house-routing";

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
