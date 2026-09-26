import type { OptionalCategory, TrackingSettings } from "@/lib/cookie-consent";
import { t } from "@/lib/i18n";
import { siteCookies } from "@/server/site-cookies";

import { ConsentManager, type ConsentTexts } from "./consent-manager";

/** The consent widget's words in a language (D58). */
export function consentTexts(lang: string, locale: string, categories: OptionalCategory[]): ConsentTexts {
  const m = t(lang);
  const list = new Intl.ListFormat(locale, { type: "conjunction" }).format(
    categories.map((c) => m.consentCategories[c].name.toLowerCase()),
  );
  return {
    title: m.consentTitle,
    text: m.consentText(list),
    acceptAll: m.acceptAll,
    rejectAll: m.rejectAll,
    choose: m.chooseCookies,
    save: m.saveChoices,
    settings: m.cookieSettings,
    alwaysOn: m.alwaysOn,
    cookiePage: m.cookies,
    categories: m.consentCategories,
  };
}

/**
 * A site's cookie consent (D58): Kaizen's (`storeId` null) or a store's,
 * asking only about the optional categories its tools and its scan's
 * findings use. With none, it shows nothing: necessary cookies need no
 * consent.
 */
export async function SiteConsent({
  storeId,
  tracking,
  lang,
  locale,
  cookiePage,
}: {
  storeId: string | null;
  tracking: TrackingSettings;
  lang: string;
  locale: string;
  cookiePage: string;
}) {
  const { categories } = await siteCookies(storeId, tracking);
  if (categories.length === 0) return null;
  return (
    <ConsentManager
      storeId={storeId}
      tracking={tracking}
      categories={categories}
      texts={consentTexts(lang, locale, categories)}
      cookiePage={cookiePage}
    />
  );
}
