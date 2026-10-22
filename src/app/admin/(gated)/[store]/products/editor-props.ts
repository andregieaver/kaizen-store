import "server-only";

import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import { isoCountries } from "@/lib/iso-countries";
import { marketPath, storeHref, storeOrigin } from "@/lib/paths";
import { siteUrl } from "@/lib/site";
import type { Store } from "@/server/stores";
import type { EditorContext } from "@/server/products";
import { uploadsEnabled } from "@/server/media";

/** The props every editor page passes along, besides the product itself; languages are named in the admin's language (D312 A5). */
export function editorProps(store: Store, context: EditorContext, lang: AdminLang = "en") {
  const names = new Intl.DisplayNames([ADMIN_LANG_FACTS[lang].tag], { type: "language" });
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
