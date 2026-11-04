import { fillWords } from "@/lib/admin-fill";
import type { OrderMessages } from "@/lib/admin-messages/order.en";
import { orderEn } from "@/lib/admin-messages/order.en";
import { formatMoney } from "@/lib/money";
import { ratePercent } from "@/lib/vat";
import { reasonStaffText, type OrderVatTreatment, type VatKind } from "@/lib/vat-treatment";
import { Card } from "@/components/admin/ui";

/** The panel's words (`order.vatTreatment`): English unless the page hands in the admin's. */
export type VatTreatmentWords = OrderMessages["vatTreatment"];

const when = (iso: string, locale: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });

/**
 * The row of an order's totals that gives back the VAT a reverse-charge order did not charge (D157). It is inside the order's discount,
 * so the lines above do not add up to the total without it, as with bonus credits. Nothing for any other order.
 */
export function VatReliefRow({ kind, reliefMinor, money, words = orderEn.vatTreatment }: { kind: VatKind; reliefMinor: number; money: (minor: number) => string; words?: VatTreatmentWords }) {
  if (kind !== "reverse_charge" || reliefMinor <= 0) return null;
  return (
    <div className="flex justify-between">
      <dt>{words.reliefRow}</dt>
      <dd>−{money(reliefMinor)}</dd>
    </div>
  );
}

/**
 * An order's VAT treatment for staff with access to the order (D157): what kind it was, why in plain words, both VAT numbers, what
 * VIES said and when (with the name and address it holds, beside the company the buyer typed, only as a hint: nothing is blocked
 * because they differ), the VAT not charged, and the IOSS number. It is frozen when the order is placed and never changes. Nothing for an
 * order with no treatment (a host's order, copied history, or one placed before it was kept) unless it carried none.
 */
export function VatTreatmentPanel({
  treatment,
  kind,
  reliefMinor,
  shippingReliefMinor,
  currency,
  locale,
  typedCompany,
  words = orderEn.vatTreatment,
}: {
  treatment: OrderVatTreatment | null;
  kind: VatKind;
  reliefMinor: number;
  shippingReliefMinor: number;
  currency: string;
  locale: string;
  /** The company name the buyer typed at checkout, or null. */
  typedCompany: string | null;
  words?: VatTreatmentWords;
}) {
  if (!treatment) return null;
  const money = (minor: number) => formatMoney(minor, currency, locale);
  const { vies } = treatment;
  const rows: { term: string; value: string; mono?: boolean; block?: boolean }[] = [];
  if (treatment.sellerVatNumber) rows.push({ term: words.sellerNumber, value: treatment.sellerVatNumber, mono: true });
  if (treatment.buyerVatNumber) {
    rows.push({ term: words.buyerNumber, value: treatment.buyerVatNumber, mono: true });
    rows.push({ term: words.viesTerm, value: vies.checkedAt ? fillWords(words.checked, { status: words.vies[vies.status], when: when(vies.checkedAt, locale) }) : words.vies[vies.status] });
  }
  if (vies.requestIdentifier) rows.push({ term: words.consultation, value: vies.requestIdentifier, mono: true });
  if (vies.registeredName) rows.push({ term: words.registeredName, value: vies.registeredName });
  if (vies.registeredAddress) rows.push({ term: words.registeredAddress, value: vies.registeredAddress, block: true });
  if (typedCompany && treatment.buyerVatNumber) rows.push({ term: words.typedCompany, value: typedCompany });
  if (kind === "reverse_charge" && reliefMinor > 0) {
    rows.push({ term: words.notCharged, value: money(reliefMinor) });
    if (shippingReliefMinor > 0) rows.push({ term: words.onShipping, value: money(shippingReliefMinor) });
  }
  if (treatment.iossNumber) rows.push({ term: words.iossNumber, value: treatment.iossNumber, mono: true });
  if (treatment.consignmentEurMinor !== null && (kind === "ioss" || treatment.reason === "ioss_over_limit")) {
    rows.push({ term: words.consignment, value: formatMoney(treatment.consignmentEurMinor, "EUR", locale) });
  }
  if (treatment.shippingRate !== null) {
    const rate = ratePercent(treatment.shippingRate);
    const rule = words.rules[treatment.shippingRule] ?? treatment.shippingRule.replace("_", " ");
    rows.push({ term: words.shippingVat, value: treatment.shippingRule !== "standard" ? fillWords(words.shippingRule, { rate, rule }) : rate });
  }
  const nameDiffers =
    vies.registeredName !== null && typedCompany !== null && vies.registeredName.trim().toLowerCase() !== typedCompany.trim().toLowerCase();
  return (
    <Card title={words.title} compact>
      <p className="text-sm font-medium">{words.kinds[kind]}</p>
      <p className="mb-3 text-sm text-muted">{words.reasons[treatment.reason] ?? reasonStaffText(treatment.reason)}</p>
      {rows.length > 0 && (
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
          {rows.map((row) => (
            <div key={row.term} className="contents">
              <dt className="text-muted">{row.term}</dt>
              <dd className={`${row.mono ? "font-mono" : ""} ${row.block ? "whitespace-pre-line" : ""}`}>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {nameDiffers && (
        <p className="mt-3 text-sm text-muted">{words.nameDiffers}</p>
      )}
      <p className="mt-3 text-xs text-muted">{words.frozen}</p>
    </Card>
  );
}
