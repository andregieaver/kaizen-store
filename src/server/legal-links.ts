import "server-only";

import { LEGAL_ROLES, legalRoleNeeded, type LegalRole } from "@/lib/legal-roles";
import type { Market } from "@/lib/markets";
import { localizePage } from "@/lib/page-translation";
import { marketPath } from "@/lib/paths";
import { featureOn } from "@/lib/store-features";

import { listPublishedPages } from "./pages";
import type { Store } from "./stores";

export type LegalLink = { role: LegalRole; title: string; href: string };

/**
 * The store's published legal pages (wave 1, 1e, `docs/wave-1-trust.md` 2.1) as the footer lists them: the page chosen for each legal
 * role, in the role's order, titled in the shopper's market. A page that is not published (a draft starter) is not here. A website (D178
 * step 5: the online shop off) lists only the pages it needs (`legalRoleNeeded()`): the checkout's terms, policies and withdrawal
 * information go, the last two staying while after-sale is open (`afterSaleOpen`).
 */
export async function legalLinksFor(store: Pick<Store, "id" | "slug" | "legalPages" | "features">, market: Market, afterSaleOpen = true): Promise<LegalLink[]> {
  const shopOn = featureOn(store, "shop");
  const chosen = LEGAL_ROLES.filter((role) => store.legalPages[role] && legalRoleNeeded(role, shopOn, afterSaleOpen));
  if (chosen.length === 0) return [];
  const published = await listPublishedPages(store.id);
  return chosen.flatMap((role) => {
    const page = published.find((p) => p.id === store.legalPages[role]);
    if (!page) return [];
    const title = localizePage(page.content, market.locale).title.trim();
    return title ? [{ role, title, href: marketPath(store.slug, market.slug, `/${page.slug}`) }] : [];
  });
}
