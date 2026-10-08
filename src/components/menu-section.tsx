import { SMALLER_SIZES } from "@/lib/breakpoints";
import type { MenuBlock } from "@/lib/page-content";
import { MENU_JUSTIFY_CLASS } from "@/lib/part-css";
import type { GridPlace } from "@/server/content-grid";
import { storeSlugOf } from "@/server/menus";
import { getPlatformChrome } from "@/server/platform-navigation";
import { getOpenStore } from "@/server/stores";

import { MenuLinks as KaizenMenuLinks, platformMenu } from "./platform-layout";
import { MenuLinks as StoreMenuLinks, storeMenu } from "./store-layout";
import { marketIn } from "@/server/shop";

export const MENU_ROW_LINK = "flex min-h-11 items-center rounded-button px-3 text-sm font-medium hover:bg-current/5";
export const MENU_COLUMN_LINK = "inline-flex min-h-10 items-center hover:underline";

/**
 * A menu component on the site (D85): the owner's menu it names, drawn with
 * the store in the shopper's country (names, addresses and texts in its
 * language) or with Kaizen's pages. A menu that is gone, or has no links
 * to show, draws nothing.
 */
export async function MenuSection({ block, place }: { block: MenuBlock; place: GridPlace }) {
  if (!block.menuId) return null;
  const layout = block.direction === "column" ? "column" : "row";
  const linkClassName = layout === "row" ? MENU_ROW_LINK : MENU_COLUMN_LINK;
  // Side-by-side links sit along the line as the component's text alignment says at each size (D179, the part stylesheet).
  const justify = block.align || SMALLER_SIZES.some((size) => block.at?.[size]?.align) ? MENU_JUSTIFY_CLASS : "";

  if (place.owner) {
    // Cached reads only: a store's pages are prerendered with their menus.
    const slug = await storeSlugOf(place.owner);
    const store = slug ? await getOpenStore(slug) : null;
    const market = store ? marketIn(store, place.market) : undefined;
    const menu = store?.menus.find((m) => m.id === block.menuId);
    if (!store || !market || !menu || menu.items.length === 0) return null;
    return (
      <nav aria-label={menu.name}>
        <StoreMenuLinks
          items={storeMenu(store, menu.id)}
          store={store}
          market={market}
          layout={layout}
          linkClassName={linkClassName}
          justify={justify}
        />
      </nav>
    );
  }
  const chrome = await getPlatformChrome();
  const menu = chrome.menus.find((m) => m.id === block.menuId);
  if (!menu || menu.items.length === 0) return null;
  return (
    <nav aria-label={menu.name}>
      <KaizenMenuLinks items={platformMenu(chrome, menu.id)} chrome={chrome} layout={layout} linkClassName={linkClassName} justify={justify} />
    </nav>
  );
}
