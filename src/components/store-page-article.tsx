import type { PageContent } from "@/lib/page-content";
import { headerOverlays } from "@/lib/site-layout";
import type { GridPlace } from "@/server/content-grid";
import { siteLayoutFor } from "@/server/site-layouts";

import { PageArticle, pageRoomClass } from "./page-article";

/**
 * A store's page (D54) inside the storefront's `<main>`, which keeps to the
 * content's width with room around it: the marker class lets `<main>` drop
 * both for pages, so rows can span the whole window and keep to the width
 * themselves (`PageArticle`). A page the store's header lies over (D80)
 * says so for the stylesheet.
 */
export async function StorePageArticle({ content, place, front = false }: { content: PageContent; place: GridPlace; front?: boolean }) {
  const header = place.owner ? await siteLayoutFor(place.owner, "header") : null;
  const over = headerOverlays(header?.content.overlay, { front, categories: content.categories, tags: content.tags, rows: content.rows });
  return (
    <div className={`store-page ${pageRoomClass(content, "pt-8", "pb-8")}`} data-header-overlay={over ? "" : undefined}>
      <PageArticle content={content} place={place} />
    </div>
  );
}
