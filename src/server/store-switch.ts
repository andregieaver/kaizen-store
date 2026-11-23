import "server-only";

import { storeExtensionsOn } from "@/lib/extensions";
import { keptPage } from "@/lib/kept-page";
import { can, canOpenPath, permissionOfPath } from "@/lib/permissions";
import { keyAllowedWhenNotOpen } from "@/lib/store-closure";
import { effectiveFeatures } from "@/lib/store-features";

import { holderOf, type Membership } from "./auth";

/**
 * Where a store's Home sends a person who switched here from another store (D873): the page they were on, when this store has it for
 * them, else Home (null). What it has for them is what its menu offers: the page finder's flags (the store's features and extensions, the
 * role's keys, a workspace's own areas) and, while the store is not open (D171), only what may still be done there, as the layout's menu.
 */
export function keptPageFor(member: Membership, asked: unknown): string | null {
  const { store } = member;
  const holder = holderOf(member);
  const open = store.status === "active";
  return keptPage(store.slug, asked, {
    features: effectiveFeatures(store),
    extensions: storeExtensionsOn(store),
    work: store.workOn,
    owner: can(holder, "owner"),
    canOpen: (page) => page.area !== "store" || (canOpenPath(holder, page.path, store.workspace) && (open || keyAllowedWhenNotOpen(permissionOfPath(page.path, "read")))),
  });
}
