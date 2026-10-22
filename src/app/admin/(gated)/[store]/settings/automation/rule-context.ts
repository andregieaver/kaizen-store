import "server-only";

import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import type { DescribeContext } from "@/lib/order-rules";
import { formatMoney } from "@/lib/money";
import { mainCurrency } from "@/lib/markets";
import type { Store } from "@/server/stores";
import { listProductChoices } from "@/server/discounts";

/**
 * What the automation pages need to write a rule's sentence and fill its editor: the main currency, the store's countries and products (wave 3, D238);
 * countries are named and amounts written in the admin's language (D312 A8), English unless given.
 */
export async function ruleContext(store: Store, lang: AdminLang = "en"): Promise<{ currency: string; countries: { code: string; name: string }[]; products: { id: string; title: string }[]; describe: DescribeContext }> {
  const currency = mainCurrency(store);
  const products = await listProductChoices(store.id, store.markets[0]?.ownLocale ?? "en-GB");
  const countryName = (code: string) => {
    try {
      return new Intl.DisplayNames([ADMIN_LANG_FACTS[lang].tag], { type: "region" }).of(code) ?? code;
    } catch {
      return code;
    }
  };
  const countries = [...new Map(store.markets.map((m) => [m.code, { code: m.code, name: countryName(m.code) }])).values()];
  const productNames = new Map(products.map((p) => [p.id, p.title]));
  return {
    currency,
    countries,
    products,
    describe: {
      money: (minor) => formatMoney(minor, currency, ADMIN_LANG_FACTS[lang].locale),
      countryName,
      productName: (id) => productNames.get(id) ?? adminText(lang, "notifications").rules.noLongerSold,
    },
  };
}
