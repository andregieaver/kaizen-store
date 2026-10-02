import type { ReactNode } from "react";

import { AbMarker } from "@/components/ab/ab-marker";
import { PageEditLink } from "@/components/page-edit-link";
import { StorePageArticle } from "@/components/store-page-article";
import type { Market } from "@/lib/markets";
import { localizePage } from "@/lib/page-translation";
import type { PageRole } from "@/lib/page-roles";
import { adminOrigin } from "@/lib/paths";
import type { StoreRoute } from "@/lib/store-parts";
import type { GridPlace } from "@/server/content-grid";
import { rolePageForVisitor } from "@/server/role-pages";
import type { Store } from "@/server/stores";

/**
 * A store's place on its site that an owner may build in the page builder
 * (D112, D113): the page chosen for the role, drawn with the route it stands
 * in for so its working components (the cart, the checkout, …) know where
 * they are; else `children`, the standard page.
 */
export async function RolePage({
  store,
  market,
  role,
  route,
  place,
  ab,
  children,
}: {
  store: Store;
  market: Market;
  role: PageRole;
  route?: StoreRoute;
  /** More about where the page is shown, such as the listing a search reads. */
  place?: Partial<GridPlace>;
  /** The visitor's versions of tests of working pages, from `resolveShop()` (D148, phase 9). */
  ab?: Record<string, string>;
  children: ReactNode;
}) {
  const { page, test, version } = await rolePageForVisitor(store, role, ab);
  if (!page) return children;
  return (
    <>
      <StorePageArticle
        content={localizePage(page.content, market.locale)}
        place={{ ...place, pageId: page.id, owner: store.id, market: market.slug, route }}
      />
      <PageEditLink pageId={page.id} store={store.slug} adminOrigin={adminOrigin(store.slug)} />
      {/* A test of this working page (D148): which version this is, for the exposure. */}
      {test && <AbMarker storeId={store.id} store={store.slug} market={market.slug} experiment={test.id} variant={version} goalBlock={test.goalBlock} />}
    </>
  );
}
