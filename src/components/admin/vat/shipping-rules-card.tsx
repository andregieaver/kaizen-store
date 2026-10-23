import type { FormState } from "@/components/admin/action-form";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { SHIPPING_VAT_RULE_LABELS, SHIPPING_VAT_RULES } from "@/lib/shipping-vat";
import type { ShippingRuleRow } from "@/server/vat-admin";

import { fillWords } from "@/lib/admin-fill";

import { card, dayText, hint, input, label, VAT_EN, type VatWords } from "./styles";

/**
 * How shipping is taxed per country (D157). The default is the destination country's standard rate. Only a verified rule
 * (with its source and the date it was checked) changes what is charged: a rule saved without verifying is a draft and is ignored,
 * and any change replaces the verification. Needs an accountant's review.
 */
export function ShippingRulesCard({
  rules,
  countries,
  country,
  action,
  words: w = VAT_EN,
  locale,
}: {
  rules: ShippingRuleRow[];
  countries: { code: string; name: string }[];
  /** Fixed on a country's own page. */
  country?: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  words?: VatWords;
  locale?: string;
}) {
  const sw = w.shipping;
  const ruleLabel = (rule: keyof typeof SHIPPING_VAT_RULE_LABELS) => sw.rules[rule] ?? SHIPPING_VAT_RULE_LABELS[rule].label;
  const [beforeFollows, rest] = sw.text.split("{follows}");
  const [betweenHighest, afterHighest] = (rest ?? "").split("{highest}");
  const shown = country ? rules.filter((r) => r.country === country) : rules.filter((r) => r.rule !== "standard" || r.verified || r.source !== "");
  const current = country ? rules.find((r) => r.country === country) : undefined;
  return (
    <section aria-labelledby="shipping-rule" className={card}>
      <div>
        <h2 id="shipping-rule" className="text-title text-ink">
          {sw.title}
        </h2>
        <p className="text-sm text-muted">
          {beforeFollows}
          <em>{sw.follows}</em>
          {betweenHighest}
          <em>{sw.highest}</em>
          {afterHighest}
        </p>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted">{sw.none}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <caption className="sr-only">{sw.caption}</caption>
            <thead className="text-muted">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">{w.country}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{sw.rule}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{sw.applied}</th>
                <th scope="col" className="py-2 font-medium">{w.source}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((rule) => (
                <tr key={rule.country} className="align-top">
                  <td className="py-2 pr-3">{rule.name}</td>
                  <td className="py-2 pr-3">
                    {ruleLabel(rule.rule)}
                    <span className="block text-xs text-muted">{rule.verified ? w.verified : sw.draft}</span>
                  </td>
                  <td className="py-2 pr-3">{ruleLabel(rule.applied)}</td>
                  <td className="py-2">
                    {rule.source || <span className="text-muted">{sw.noSource}</span>}
                    {rule.checkedOn && <span className="block text-xs text-muted">{fillWords(w.checked, { date: dayText(rule.checkedOn, locale) })}</span>}
                    {rule.note && <span className="block text-xs text-muted">{rule.note}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ActionForm action={action} successMessage={sw.saved} className="flex flex-col gap-4 border-t border-line pt-4">
        <h3 className="text-body-strong text-ink">{sw.set}</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {country ? (
            <input type="hidden" name="country" value={country} />
          ) : (
            <label className={label}>
              {w.country}
              <select name="country" required defaultValue="" className={input}>
                <option value="" disabled>
                  {w.choose}
                </option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className={label}>
            {sw.rule}
            <select name="rule" required defaultValue={current?.rule ?? "standard"} className={input}>
              {SHIPPING_VAT_RULES.map((rule) => (
                <option key={rule} value={rule}>
                  {ruleLabel(rule)}
                </option>
              ))}
            </select>
          </label>
          <label className={`${label} sm:col-span-2`}>
            {w.source} <span className={hint}>{sw.sourceHint}</span>
            <input name="source" maxLength={400} defaultValue={current?.source ?? ""} autoComplete="off" className={input} />
          </label>
          <label className={label}>
            {w.checkedOn}
            <input name="checkedOn" type="date" defaultValue={current?.checkedOn ?? ""} className={input} />
          </label>
          <label className={label}>
            {w.note}
            <input name="note" maxLength={400} defaultValue={current?.note ?? ""} autoComplete="off" className={input} />
          </label>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="verified" className="mt-0.5 size-4" />
          <span>
            {sw.verifiedBox}
            <span className={`block ${hint}`}>{sw.verifiedHint}</span>
          </span>
        </label>
        <div>
          <SubmitButton>{sw.save}</SubmitButton>
        </div>
      </ActionForm>
    </section>
  );
}
