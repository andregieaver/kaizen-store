/**
 * Which VAT rate a product takes (D65): the market's standard rate, the
 * rate for accommodation (reduced in some countries), or none (exempt, such
 * as health care). Rates per country are in `commerce.vat_rates`, read
 * through `commerce.vat_rate(country, category)`.
 */
export const VAT_CATEGORIES = ["standard", "accommodation", "exempt"] as const;
export type VatCategory = (typeof VAT_CATEGORIES)[number];

export const VAT_CATEGORY_LABELS: Record<VatCategory, { label: string; hint: string }> = {
  standard: { label: "Standard rate", hint: "Most goods and services." },
  accommodation: { label: "Accommodation", hint: "Hotel rooms, holiday homes and camping: a reduced rate where the country has one." },
  exempt: { label: "Exempt from VAT", hint: "No VAT, such as health care. Check with your accountant that it applies to you." },
};

export const parseVatCategory = (value: unknown): VatCategory =>
  VAT_CATEGORIES.includes(value as VatCategory) ? (value as VatCategory) : "standard";

/** A rate as a percentage for people, e.g. 0.255 → "25.5 %". */
export const ratePercent = (rate: number) => `${Math.round(rate * 1000) / 10} %`;
