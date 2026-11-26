import type { FormState } from "@/components/admin/action-form";
import { adminDay } from "@/lib/admin-date";
import { fillWords } from "@/lib/admin-fill";
import type { AdminLang } from "@/lib/admin-lang";
import type { MarketCheckMessages } from "@/lib/admin-messages/market-check.en";
import { formatPercent } from "@/lib/analytics-core";
import { formatAmount } from "@/lib/analytics-format";
import { priceGap, SERVICE_PER, type ServicePer } from "@/lib/market-rivals";
import type { KeptServicePrice, Rival } from "@/server/market-rivals";

import { KeptPrices } from "../kept-prices";
import { Field, Select, TextInput } from "../ui/field";

/**
 * Rivals' published service prices on Analytics → Markets (D905 M5d, `docs/market-check.md` 7.5): each as a person kept it with the page it
 * is on, whether code still finds it there (`priceOnPage()`, when kept and monthly), and how it stands against the store's own, worked out
 * by `priceGap()` in one currency. Keeping one is a step in, open while there are none. Drawn on the server inside the rivals' section; the
 * forms post to the page's one rivals action. The rows and the form's frame are `KeptPrices`, shared with other platforms' prices (M4).
 */

type Action = (state: FormState, form: FormData) => Promise<FormState>;
type W = MarketCheckMessages["rivals"]["prices"];

export type MarketServicePricesProps = {
  lang: AdminLang;
  locale: string;
  w: W;
  /** A price with what it is for, as the findings say it (`{price} an hour`). */
  per: Record<ServicePer, string>;
  prices: readonly KeptServicePrice[];
  rivals: readonly Rival[];
  /** The store's currencies, its first market's first. */
  currencies: readonly string[];
  /** The store's products a price may be held against (with a shop only), by handle and title. */
  products: readonly { handle: string; title: string }[];
  actions: { keep: Action; remove: Action } | null;
};

export function MarketServicePrices({ lang, locale, w, per, prices, rivals, currencies, products, actions }: MarketServicePricesProps) {
  const at = (minor: number, currency: string, unit: ServicePer) => fillWords(per[unit], { price: formatAmount(minor, currency, locale) });
  const against = (p: KeptServicePrice) => {
    if (!p.own) return w.noOwn;
    const gap = priceGap(p.own, p);
    if (gap === null) return w.notComparable;
    const said = gap === 0 ? w.same : fillWords(gap > 0 ? w.dearer : w.cheaper, { gap: formatPercent(Math.abs(gap), 0) });
    return `${fillWords(w.against, { yours: at(p.own.priceMinor, p.own.currency, p.per) })}: ${said}`;
  };
  const rows = prices.map((p) => ({
    id: p.id,
    name: `${p.rivalName}: ${p.service}`,
    price: at(p.priceMinor, p.currency, p.per),
    onPage: p.onPage,
    goneAt: p.goneAt,
    details: `${against(p)} · ${fillWords(w.checked, { date: adminDay(p.checkedOn, "day", lang) })}`,
    source: p.source,
  }));
  return (
    <div className="flex flex-col gap-3" data-service-prices>
      <div>
        <h4 className="text-body-strong text-ink">{w.title}</h4>
        <p className="text-sm text-muted">{w.lead}</p>
      </div>
      <KeptPrices rows={rows} w={w} dataName="data-service-price" remove={actions?.remove ?? null} keep={actions && rivals.length > 0 ? actions.keep : null}>
        <Field label={w.rival} required>
          {(control) => (
            <Select name="rival" full {...control}>
              {rivals.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={w.service} required>
          {(control) => <TextInput name="service" maxLength={120} placeholder={w.serviceHint} autoComplete="off" full {...control} />}
        </Field>
        <Field label={w.price} required>
          {(control) => <TextInput name="price" inputMode="decimal" maxLength={20} autoComplete="off" full {...control} />}
        </Field>
        <Field label={w.per} required>
          {(control) => (
            <Select name="per" defaultValue="once" full {...control}>
              {SERVICE_PER.map((unit) => (
                <option key={unit} value={unit}>
                  {w.perNames[unit]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={w.currency} required>
          {(control) => (
            <Select name="currency" defaultValue={currencies[0]} full {...control}>
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={w.source} required>
          {(control) => <TextInput name="source" type="url" placeholder={w.sourceHint} maxLength={2000} autoComplete="off" full {...control} />}
        </Field>
        <Field label={w.own}>
          {(control) => <TextInput name="own" inputMode="decimal" maxLength={20} placeholder={w.ownHint} autoComplete="off" full {...control} />}
        </Field>
        {products.length > 0 ? (
          <Field label={w.product}>
            {(control) => (
              <Select name="product" defaultValue="" full {...control}>
                <option value="">{w.noProduct}</option>
                {products.map((p) => (
                  <option key={p.handle} value={p.handle}>
                    {p.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
      </KeptPrices>
    </div>
  );
}
