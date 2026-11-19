import { extensionsIn } from "@/lib/extension-words";
import type { ExtensionsBlock } from "@/lib/page-content";
import type { GridPlace } from "@/server/content-grid";
import { sitePlaceLang } from "@/server/place-lang";
import { getPublicExtensions } from "@/server/public-extensions";

import { ExtensionsView } from "./extensions-view";

/**
 * Kaizena Flow's extensions on one of its pages (D748 E8): the catalogue read where the page is shown (cached, refreshed when the platform
 * changes an extension, a bundle, what a plan includes or the founding offer), in the page's language (its words, and the catalogue's where
 * they are written in it, `extensionsIn()`). Draws nothing when no extension has a price.
 */
export async function ExtensionsSection({ block, place }: { block: ExtensionsBlock; place: GridPlace }) {
  // Kaizena Flow's own page's language, or its own store's market's (D484), as the Plans block.
  const lang = await sitePlaceLang(place);
  return <ExtensionsView block={block} data={extensionsIn(await getPublicExtensions(), lang)} lang={lang} />;
}
