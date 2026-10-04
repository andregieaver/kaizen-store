import type { FormState } from "@/components/admin/action-form";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { SHIPPING_VAT_RULE_LABELS, SHIPPING_VAT_RULES } from "@/lib/shipping-vat";
import type { ShippingRuleRow } from "@/server/vat-admin";

import { card, dayText, hint, input, label } from "./styles";

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
}: {
  rules: ShippingRuleRow[];
  countries: { code: string; name: string }[];
  /** Fixed on a country's own page. */
  country?: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const shown = country ? rules.filter((r) => r.country === country) : rules.filter((r) => r.rule !== "standard" || r.verified || r.source !== "");
  const current = country ? rules.find((r) => r.country === country) : undefined;
  return (
    <section aria-labelledby="shipping-rule" className={card}>
      <div>
        <h2 id="shipping-rule" className="font-medium">
          VAT on shipping
        </h2>
        <p className="text-sm text-muted">
          Shipping is charged the standard rate of the destination country unless a rule has been verified for it. <em>Follows the goods</em> uses the goods&apos; rate when all of them share one, and
          the standard rate otherwise; <em>highest</em> uses the highest rate among the goods. A rule that is not verified is saved as a draft and is not applied.
        </p>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted">No country has a rule of its own: every country uses the standard rate.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <caption className="sr-only">Shipping VAT rules</caption>
            <thead className="text-muted">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">Country</th>
                <th scope="col" className="py-2 pr-3 font-medium">Rule</th>
                <th scope="col" className="py-2 pr-3 font-medium">Applied</th>
                <th scope="col" className="py-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((rule) => (
                <tr key={rule.country} className="align-top">
                  <td className="py-2 pr-3">{rule.name}</td>
                  <td className="py-2 pr-3">
                    {SHIPPING_VAT_RULE_LABELS[rule.rule].label}
                    <span className="block text-xs text-muted">{rule.verified ? "Verified" : "Draft: not applied"}</span>
                  </td>
                  <td className="py-2 pr-3">{SHIPPING_VAT_RULE_LABELS[rule.applied].label}</td>
                  <td className="py-2">
                    {rule.source || <span className="text-muted">None</span>}
                    {rule.checkedOn && <span className="block text-xs text-muted">Checked {dayText(rule.checkedOn)}</span>}
                    {rule.note && <span className="block text-xs text-muted">{rule.note}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ActionForm action={action} successMessage="The rule is saved." className="flex flex-col gap-4 border-t border-border pt-4">
        <h3 className="text-sm font-medium">Set a rule</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {country ? (
            <input type="hidden" name="country" value={country} />
          ) : (
            <label className={label}>
              Country
              <select name="country" required defaultValue="" className={input}>
                <option value="" disabled>
                  Choose …
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
            Rule
            <select name="rule" required defaultValue={current?.rule ?? "standard"} className={input}>
              {SHIPPING_VAT_RULES.map((rule) => (
                <option key={rule} value={rule}>
                  {SHIPPING_VAT_RULE_LABELS[rule].label}
                </option>
              ))}
            </select>
          </label>
          <label className={`${label} sm:col-span-2`}>
            Source <span className={hint}>(the web address or act that says how shipping is taxed there)</span>
            <input name="source" maxLength={400} defaultValue={current?.source ?? ""} autoComplete="off" className={input} />
          </label>
          <label className={label}>
            Checked on
            <input name="checkedOn" type="date" defaultValue={current?.checkedOn ?? ""} className={input} />
          </label>
          <label className={label}>
            Note
            <input name="note" maxLength={400} defaultValue={current?.note ?? ""} autoComplete="off" className={input} />
          </label>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="verified" className="mt-0.5 size-4" />
          <span>
            A person has verified this rule
            <span className={`block ${hint}`}>Needs a source and the date it was checked. Without this the rule is a draft and the standard rate is charged.</span>
          </span>
        </label>
        <div>
          <SubmitButton>Save the rule</SubmitButton>
        </div>
      </ActionForm>
    </section>
  );
}
