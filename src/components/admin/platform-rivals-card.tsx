import type { FormState } from "@/components/admin/action-form";
import { adminDay } from "@/lib/admin-date";
import { fillWords } from "@/lib/admin-fill";
import type { AdminLang } from "@/lib/admin-lang";
import type { PlatformMessages } from "@/lib/admin-messages/platform.en";
import { formatPercent } from "@/lib/analytics-core";
import { priceGap } from "@/lib/market-rivals";
import { formatMoney } from "@/lib/money";
import type { PlatformRivalPrice } from "@/server/market-rivals";

import { KeptPrices } from "./kept-prices";
import { CARD_CLASS } from "./ui/card";
import { Field, Select, TextInput } from "./ui/field";

/**
 * Other store platforms' prices on Platform → Plans (D900 M4, `docs/market-check.md` 6): each as a platform admin read it on its platform's
 * own pricing page, the difference from Kaizena Flow's plan it is held against worked out by code (`priceGap()`, one currency and interval),
 * and whether code still finds the price on its page (`KeptPrices`, shared with rivals' service prices). Adding one is a step in (Lisa's),
 * open while there are none. Drawn on the server; the forms post to the page's one action, bound for each form.
 */

type Action = (state: FormState, form: FormData) => Promise<FormState>;
type W = PlatformMessages["plans"]["rivals"];

export type PlatformRivalsCardProps = {
  lang: AdminLang;
  locale: string;
  w: W;
  prices: readonly PlatformRivalPrice[];
  /** Kaizena Flow's plans, for the plan a price is held against. */
  plans: readonly { id: string; name: string }[];
  currencies: readonly string[];
  /** Null for a platform reader: the card shows the prices without its forms. */
  actions: { keep: Action; remove: Action } | null;
};

export function PlatformRivalsCard({ lang, locale, w, prices, plans, currencies, actions }: PlatformRivalsCardProps) {
  const money = (minor: number, currency: string) => formatMoney(minor, currency, locale);
  const per = (interval: "month" | "year") => (interval === "year" ? w.perYear : w.perMonth);
  const against = (p: PlatformRivalPrice) => {
    if (!p.planName) return null;
    if (p.oursMinor === null) return w.notComparable;
    const gap = priceGap({ priceMinor: p.oursMinor, currency: p.currency }, p);
    const said = gap === null || gap === 0 ? w.same : fillWords(gap > 0 ? w.dearer : w.cheaper, { gap: formatPercent(Math.abs(gap), 0) });
    return `${fillWords(w.against, { plan: p.planName, price: `${money(p.oursMinor, p.currency)} ${per(p.interval)}` })}: ${said}`;
  };
  const rows = prices.map((p) => ({
    id: p.id,
    name: `${p.platform} ${p.plan}`,
    price: `${money(p.priceMinor, p.currency)} ${per(p.interval)}`,
    onPage: p.onPage,
    goneAt: p.goneAt,
    details: [p.feeBps === null ? w.noFee : fillWords(w.fee, { fee: formatPercent(p.feeBps / 10_000, 1) }), against(p), fillWords(w.checked, { date: adminDay(p.checkedOn, "day", lang) })]
      .filter(Boolean)
      .join(" · "),
    source: p.source,
  }));
  return (
    <section aria-labelledby="platform-rivals" className={`flex flex-col gap-4 p-5 ${CARD_CLASS}`} data-platform-rivals>
      <div>
        <h2 id="platform-rivals" className="text-title text-ink">
          {w.title}
        </h2>
        <p className="text-sm text-muted">{w.lead}</p>
      </div>
      <KeptPrices rows={rows} w={w} dataName="data-platform-price" remove={actions?.remove ?? null} keep={actions?.keep ?? null}>
        <Field label={w.platform} required>
          {(control) => <TextInput name="platform" maxLength={80} placeholder={w.platformHint} autoComplete="off" full {...control} />}
        </Field>
        <Field label={w.plan} required>
          {(control) => <TextInput name="plan" maxLength={80} placeholder={w.planHint} autoComplete="off" full {...control} />}
        </Field>
        <Field label={w.price} required>
          {(control) => <TextInput name="price" inputMode="decimal" maxLength={20} autoComplete="off" full {...control} />}
        </Field>
        <Field label={w.currency} required>
          {(control) => (
            <Select name="currency" defaultValue={currencies.includes("EUR") ? "EUR" : currencies[0]} full {...control}>
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={w.interval} required>
          {(control) => (
            <Select name="interval" defaultValue="month" full {...control}>
              <option value="month">{w.month}</option>
              <option value="year">{w.year}</option>
            </Select>
          )}
        </Field>
        <Field label={w.feeLabel}>
          {(control) => <TextInput name="fee" inputMode="decimal" maxLength={8} autoComplete="off" full {...control} />}
        </Field>
        <Field label={w.ours}>
          {(control) => (
            <Select name="ours" defaultValue="" full {...control}>
              <option value="">{w.oursNone}</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={w.source} required>
          {(control) => <TextInput name="source" inputMode="url" maxLength={2000} placeholder={w.sourceHint} autoComplete="off" full {...control} />}
        </Field>
      </KeptPrices>
    </section>
  );
}
