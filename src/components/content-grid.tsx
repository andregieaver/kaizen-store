import type { ComponentProps } from "react";

import { t } from "@/lib/i18n";

import { ContentGridTiles } from "./content-grid-tiles";

/**
 * A content grid's tiles (D51) on the site: `ContentGridTiles` with the words of the grid's language. The page builder's canvas draws
 * `ContentGridTiles` itself and loads that language on demand (bloat review step 2.29), so the admin's scripts hold no storefront language.
 */
export function ContentGridView(props: Omit<ComponentProps<typeof ContentGridTiles>, "m">) {
  return <ContentGridTiles {...props} m={t(props.data.lang)} />;
}
