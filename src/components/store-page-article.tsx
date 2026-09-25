import type { PageContent } from "@/lib/page-content";
import type { GridPlace } from "@/server/content-grid";

import { PageArticle } from "./page-article";

/**
 * A store's page (D54) inside the storefront's `<main>`, which keeps to the
 * content's width with room around it: the marker class lets `<main>` drop
 * both for pages, so rows can span the whole window and keep to the width
 * themselves (`PageArticle`).
 */
export function StorePageArticle({ content, place }: { content: PageContent; place: GridPlace }) {
  return (
    <div className="store-page py-8">
      <PageArticle content={content} place={place} />
    </div>
  );
}
