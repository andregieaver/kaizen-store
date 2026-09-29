import { publicForm } from "@/lib/forms";
import type { EmailFormBlock, NewsletterBlock } from "@/lib/page-content";
import type { GridPlace } from "@/server/content-grid";
import { storeSlugOf } from "@/server/menus";
import { getOpenStore } from "@/server/stores";

import { SiteForm } from "./site-form";
import { marketIn } from "@/server/shop";

/**
 * A page's form on the site (D93): drawn in the page's language, sending
 * for the page's owner. Only what the visitor needs reaches the browser
 * (`publicForm()`): where it sends stays on the server.
 */
export async function FormSection({ block, place }: { block: EmailFormBlock | NewsletterBlock; place: GridPlace }) {
  let lang = "en";
  if (place.owner) {
    const slug = await storeSlugOf(place.owner);
    const store = slug ? await getOpenStore(slug) : null;
    const market = store ? marketIn(store, place.market) : undefined;
    if (market) lang = market.lang;
  }
  return <SiteForm form={publicForm(block)} store={place.owner} lang={lang} />;
}
