/**
 * The VAT rate shipping is charged at (D157, docs/wave-1a-tax.md section 4.2). By default shipping takes the
 * destination country's standard rate, everywhere, as it always has. A country may have a rule that a person verified
 * (`commerce.shipping_vat_rules`, answered by `commerce.shipping_vat_rule()`: an unverified rule is `standard`):
 *
 * - `standard`: the country's standard rate.
 * - `follows_goods`: the rate the taxable goods share when every taxable goods line has the same one; goods that are all
 *   exempt give 0; goods with different rates, or no goods lines at all, give the standard rate.
 * - `highest`: the highest rate among the goods lines (never below zero); no goods lines give the standard rate.
 *
 * Source (from memory, NOT read, *needs review by an accountant*): that ancillary charges such as transport follow the
 * supply they belong to (Directive 2006/112/EC Art. 78(a) and the case law on ancillary supplies). Each state's practice
 * differs, which is why `standard` is the default until a person verifies a country.
 */
export const SHIPPING_VAT_RULES = ["standard", "follows_goods", "highest"] as const;
export type ShippingVatRule = (typeof SHIPPING_VAT_RULES)[number];

export const SHIPPING_VAT_RULE_LABELS: Record<ShippingVatRule, { label: string; hint: string }> = {
  standard: { label: "Standard rate", hint: "Shipping takes the country's standard rate, whatever the goods." },
  follows_goods: {
    label: "Follows the goods",
    hint: "Shipping takes the goods' rate when all taxable goods share one; otherwise the standard rate.",
  },
  highest: { label: "Highest rate in the basket", hint: "Shipping takes the highest rate among the goods." },
};

export const parseShippingVatRule = (value: unknown): ShippingVatRule =>
  SHIPPING_VAT_RULES.includes(value as ShippingVatRule) ? (value as ShippingVatRule) : "standard";

/**
 * The rate for shipping. `goodsRates` are the rates the goods lines of the basket were charged at (0 for an exempt
 * line), as fractions such as `0.25`; `standard` is the destination country's standard rate.
 */
export function shippingRate(rule: ShippingVatRule, goodsRates: readonly number[], standard: number): number {
  if (rule === "standard" || goodsRates.length === 0) return standard;
  if (rule === "highest") return Math.max(0, ...goodsRates);
  // follows_goods
  const taxable = goodsRates.filter((rate) => rate > 0);
  if (taxable.length === 0) return 0;
  return taxable.every((rate) => rate === taxable[0]) ? taxable[0] : standard;
}
