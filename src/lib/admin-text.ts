import type { AdminLang } from "./admin-lang";
import { commonEn, type CommonMessages } from "./admin-messages/common.en";
import { commonNb } from "./admin-messages/common.nb";
import { domainsEn, type DomainsMessages } from "./admin-messages/domains.en";
import { domainsNb } from "./admin-messages/domains.nb";
import { ordersEn, type OrdersMessages } from "./admin-messages/orders.en";
import { ordersNb } from "./admin-messages/orders.nb";
import { orderEn, type OrderMessages } from "./admin-messages/order.en";
import { orderNb } from "./admin-messages/order.nb";
import { draftsEn, type DraftsMessages } from "./admin-messages/drafts.en";
import { draftsNb } from "./admin-messages/drafts.nb";
import { returnsEn, type ReturnsMessages } from "./admin-messages/returns.en";
import { returnsNb } from "./admin-messages/returns.nb";
import { invoicesEn, type InvoicesMessages } from "./admin-messages/invoices.en";
import { invoicesNb } from "./admin-messages/invoices.nb";
import { homeEn, type HomeMessages } from "./admin-messages/home.en";
import { homeNb } from "./admin-messages/home.nb";
import { platformLegalEn, type PlatformLegalMessages } from "./admin-messages/platform-legal.en";
import { platformLegalNb } from "./admin-messages/platform-legal.nb";
import { shellEn, type ShellMessages } from "./admin-messages/shell.en";
import { shellNb } from "./admin-messages/shell.nb";
import { setupEn, type SetupMessages } from "./admin-messages/setup.en";
import { setupNb } from "./admin-messages/setup.nb";
import { signInEn, type SignInMessages } from "./admin-messages/sign-in.en";
import { signInNb } from "./admin-messages/sign-in.nb";

/**
 * The admin's words by area and language (D312, `docs/platform-admin-i18n.md` 3.3): one pair of catalogues per area in
 * `src/lib/admin-messages/{area}.{lang}.ts`, English the type. A new area is its two files and an entry here; an area is converted with
 * the screens that show it, and `admin-strings.scan.test.ts` holds what is converted.
 */
export type AdminAreaMessages = {
  common: CommonMessages;
  domains: DomainsMessages;
  home: HomeMessages;
  orders: OrdersMessages;
  order: OrderMessages;
  drafts: DraftsMessages;
  returns: ReturnsMessages;
  invoices: InvoicesMessages;
  platformLegal: PlatformLegalMessages;
  setup: SetupMessages;
  shell: ShellMessages;
  signIn: SignInMessages;
};

export type AdminArea = keyof AdminAreaMessages;

const CATALOGUES: { [A in AdminArea]: Record<AdminLang, AdminAreaMessages[A]> } = {
  common: { en: commonEn, nb: commonNb },
  domains: { en: domainsEn, nb: domainsNb },
  home: { en: homeEn, nb: homeNb },
  orders: { en: ordersEn, nb: ordersNb },
  order: { en: orderEn, nb: orderNb },
  drafts: { en: draftsEn, nb: draftsNb },
  returns: { en: returnsEn, nb: returnsNb },
  invoices: { en: invoicesEn, nb: invoicesNb },
  platformLegal: { en: platformLegalEn, nb: platformLegalNb },
  setup: { en: setupEn, nb: setupNb },
  shell: { en: shellEn, nb: shellNb },
  signIn: { en: signInEn, nb: signInNb },
};

/** An area's words in `lang`, on the server; a client part reads its area's slice through `useAdminText()`. */
export function adminText<A extends AdminArea>(lang: AdminLang, area: A): AdminAreaMessages[A] {
  return CATALOGUES[area][lang];
}

/** The slices a layout hands to its client parts (`AdminTextProvider`): the areas named, in `lang`. */
export function adminTexts<A extends AdminArea>(lang: AdminLang, areas: readonly A[]): Pick<AdminAreaMessages, A> {
  return Object.fromEntries(areas.map((area) => [area, adminText(lang, area)])) as Pick<AdminAreaMessages, A>;
}

