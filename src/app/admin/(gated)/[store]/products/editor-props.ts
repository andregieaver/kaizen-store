import "server-only";

import { isoCountries } from "@/lib/iso-countries";
import { marketPath, storeHref, storeOrigin } from "@/lib/paths";
import { siteUrl } from "@/lib/site";
import type { Store } from "@/server/stores";
import type { EditorContext } from "@/server/products";
import { uploadsEnabled } from "@/server/media";

/** The props every editor page passes along, besides the product itself. */
export function editorProps(store: Store, context: EditorContext) {
  const names = new Intl.DisplayNames(["en"], { type: "language" });
  return {
    storeSlug: store.slug,
    context,
    languageNames: Object.fromEntries(context.locales.map((l) => [l, names.of(l) ?? l])),
    countries: isoCountries(),
    uploads: uploadsEnabled(),
    // Full addresses once the store has its own host (P7), so siteOrigin is then empty.
    storefrontPath: store.markets[0] ? storeHref(store.slug, marketPath(store.slug, store.markets[0].slug)) : null,
    siteOrigin: storeOrigin(store.slug) ? "" : siteUrl(),
  };
}
