import type { AdminLang } from "./admin-lang";
import { commonEn, type CommonMessages } from "./admin-messages/common.en";
import { commonNb } from "./admin-messages/common.nb";
import { domainsEn, type DomainsMessages } from "./admin-messages/domains.en";
import { domainsNb } from "./admin-messages/domains.nb";

/**
 * The admin's words by area and language (D312, `docs/platform-admin-i18n.md` 3.3): one pair of catalogues per area in
 * `src/lib/admin-messages/{area}.{lang}.ts`, English the type. A new area is its two files and an entry here; an area is converted with
 * the screens that show it, and `admin-strings.scan.test.ts` holds what is converted.
 */
export type AdminAreaMessages = {
  common: CommonMessages;
  domains: DomainsMessages;
};

export type AdminArea = keyof AdminAreaMessages;

const CATALOGUES: { [A in AdminArea]: Record<AdminLang, AdminAreaMessages[A]> } = {
  common: { en: commonEn, nb: commonNb },
  domains: { en: domainsEn, nb: domainsNb },
};

/** An area's words in `lang`, on the server; a client part reads its area's slice through `useAdminText()`. */
export function adminText<A extends AdminArea>(lang: AdminLang, area: A): AdminAreaMessages[A] {
  return CATALOGUES[area][lang];
}

/** The slices a layout hands to its client parts (`AdminTextProvider`): the areas named, in `lang`. */
export function adminTexts<A extends AdminArea>(lang: AdminLang, areas: readonly A[]): Pick<AdminAreaMessages, A> {
  return Object.fromEntries(areas.map((area) => [area, adminText(lang, area)])) as Pick<AdminAreaMessages, A>;
}
