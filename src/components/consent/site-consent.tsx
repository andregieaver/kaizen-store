import type { OptionalCategory, TrackingSettings } from "@/lib/cookie-consent";
import { allowedCode, CODE_PLACES, type CustomCode } from "@/lib/custom-code";
import { t } from "@/lib/i18n";
import { siteCookies } from "@/server/site-cookies";

import { ConsentManager, type ConsentTexts } from "./consent-manager";
import { StoreCustomCode } from "./store-custom-code";

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
 * asking only about the optional categories its tools, its scan's findings
 * and the owner's own code (D61) use. With none, it shows nothing:
 * necessary cookies need no consent. The owner's code marked necessary is
 * added regardless; the rest as the visitor allows.
 */
export async function SiteConsent({
  storeId,
  tracking,
  code = {},
  lang,
  locale,
  cookiePage,
}: {
  storeId: string | null;
  tracking: TrackingSettings;
  /** What `liveCustomCode()` gives: none where it is not added. */
  code?: CustomCode;
  lang: string;
  locale: string;
  cookiePage: string;
}) {
  const { categories } = await siteCookies(storeId, tracking, code);
  const necessary = Object.fromEntries(allowedCode(code, null).map((place) => [place, code[place]])) as CustomCode;
  const optional = Object.fromEntries(
    CODE_PLACES.filter((place) => code[place] && !(place in necessary)).map((place) => [place, code[place]]),
  ) as CustomCode;
  return (
    <>
      {Object.keys(necessary).length > 0 && <StoreCustomCode code={necessary} />}
      {categories.length > 0 && (
        <ConsentManager
          storeId={storeId}
          tracking={tracking}
          code={optional}
          categories={categories}
          texts={consentTexts(lang, locale, categories)}
          cookiePage={cookiePage}
        />
      )}
    </>
  );
}
