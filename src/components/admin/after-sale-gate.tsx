import "server-only";

import Link from "next/link";
import type { ReactElement } from "react";

import { can, type PermissionHolder } from "@/lib/permissions";
import { afterSaleIsOpen, featureOn } from "@/lib/store-features";
import { afterSaleOf, afterSaleOpen } from "@/server/after-sale";

import { FeatureOff } from "./feature-off";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import { requestAdminLang } from "@/server/admin-request-lang";

/**
 * The gate of an admin page of what was sold (D178 step 5, the owner's decision; `AFTER_SALE_ADMIN_PATHS`): the orders, an order, its slips
 * and terms, the returns and the invoices. Null while the online shop is on, and while it is off as long as an order can still be withdrawn
 * from or has a return open (`afterSaleOpen()`); then the `FeatureOff` notice the page returns in place of itself. Called after the page's
 * permission check: `const off = await requireShopOrAfterSale(member); if (off) return off;`.
 */
export async function requireShopOrAfterSale(
  member: { store: { id: string; slug: string; features: readonly string[] } } & PermissionHolder,
): Promise<ReactElement | null> {
  if (featureOn(member.store, "shop") || (await afterSaleOpen(member.store.id))) return null;
  return <FeatureOff storeSlug={member.store.slug} feature="shop" features={member.store} owner={can(member, "owner")} />;
}


/**
 * The way to what was sold while the online shop is off (D178 step 5): Orders is not in the menu of a website, so Home and the Features page
 * say what is still open after the sale and link to the orders and the returns. Nothing while the shop is on or nothing is open.
 */
export async function AfterSaleNote({ store }: { store: { id: string; slug: string; features: readonly string[] } }) {
  if (featureOn(store, "shop")) return null;
  const after = await afterSaleOf(store.id);
  if (!afterSaleIsOpen(after)) return null;
  const base = `/admin/${store.slug}`;
  const w = adminText(await requestAdminLang(), "settings").afterSale;
  const parts = [
    after.withdrawable > 0 && countWords(after.withdrawable, w.withdrawable),
    after.openReturns > 0 && countWords(after.openReturns, w.openReturns),
  ].filter(Boolean);
  return (
    <p role="status" className="rounded-panel bg-sunken p-4 text-sm">
      {fillWords(w.note, { parts: parts.join(w.and) })}{" "}
      <Link href={`${base}/orders`} className="underline">
        {w.orders}
      </Link>
      {" · "}
      <Link href={`${base}/returns`} className="underline">
        {w.returns}
      </Link>
    </p>
  );
}
