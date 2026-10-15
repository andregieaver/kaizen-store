import "server-only";

import type { DescribeContext } from "@/lib/order-rules";
import { formatMoney } from "@/lib/money";
import { mainCurrency } from "@/lib/markets";
import type { Store } from "@/server/stores";
import { listProductChoices } from "@/server/discounts";

/** What the automation pages need to write a rule's sentence and fill its editor: the main currency, the store's countries and products (wave 3, D238). */
export async function ruleContext(store: Store): Promise<{ currency: string; countries: { code: string; name: string }[]; products: { id: string; title: string }[]; describe: DescribeContext }> {
  const currency = mainCurrency(store);
  const products = await listProductChoices(store.id, store.markets[0]?.ownLocale ?? "en-GB");
  const countryName = (code: string) => {
    try {
      return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
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
      money: (minor) => formatMoney(minor, currency, "en-GB"),
      countryName,
      productName: (id) => productNames.get(id) ?? "a product no longer sold",
    },
  };
}
