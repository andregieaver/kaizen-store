import { formatMoney } from "@/lib/money";
import { ratePercent } from "@/lib/vat";
import { reasonStaffText, type OrderVatTreatment, type VatKind } from "@/lib/vat-treatment";

const KIND_WORDS: Record<VatKind, string> = {
  standard: "Standard: VAT charged",
  reverse_charge: "Reverse charge: no VAT charged",
  ioss: "IOSS: VAT charged and marked with the IOSS number",
};

const VIES_WORDS: Record<OrderVatTreatment["vies"]["status"], string> = {
  valid: "Registered",
  invalid: "Not accepted",
  unavailable: "Could not be checked",
  not_checked: "Not checked",
};

const when = (iso: string, locale: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });

/**
 * The row of an order's totals that gives back the VAT a reverse-charge order did not charge (D157). It is inside the order's discount,
 * so the lines above do not add up to the total without it, as with bonus credits. Nothing for any other order.
 */
export function VatReliefRow({ kind, reliefMinor, money }: { kind: VatKind; reliefMinor: number; money: (minor: number) => string }) {
  if (kind !== "reverse_charge" || reliefMinor <= 0) return null;
  return (
    <div className="flex justify-between">
      <dt>VAT not charged (reverse charge)</dt>
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
}: {
  treatment: OrderVatTreatment | null;
  kind: VatKind;
  reliefMinor: number;
  shippingReliefMinor: number;
  currency: string;
  locale: string;
  /** The company name the buyer typed at checkout, or null. */
  typedCompany: string | null;
}) {
  if (!treatment) return null;
  const money = (minor: number) => formatMoney(minor, currency, locale);
  const { vies } = treatment;
  const rows: { term: string; value: string; mono?: boolean; block?: boolean }[] = [];
  if (treatment.sellerVatNumber) rows.push({ term: "Seller's VAT number", value: treatment.sellerVatNumber, mono: true });
  if (treatment.buyerVatNumber) {
    rows.push({ term: "Buyer's VAT number", value: treatment.buyerVatNumber, mono: true });
    rows.push({ term: "VIES", value: `${VIES_WORDS[vies.status]}${vies.checkedAt ? `, checked ${when(vies.checkedAt, locale)}` : ""}` });
  }
  if (vies.requestIdentifier) rows.push({ term: "Consultation number", value: vies.requestIdentifier, mono: true });
  if (vies.registeredName) rows.push({ term: "Registered name (VIES)", value: vies.registeredName });
  if (vies.registeredAddress) rows.push({ term: "Registered address (VIES)", value: vies.registeredAddress, block: true });
  if (typedCompany && treatment.buyerVatNumber) rows.push({ term: "Company the buyer typed", value: typedCompany });
  if (kind === "reverse_charge" && reliefMinor > 0) {
    rows.push({ term: "VAT not charged", value: money(reliefMinor) });
    if (shippingReliefMinor > 0) rows.push({ term: "of which on shipping", value: money(shippingReliefMinor) });
  }
  if (treatment.iossNumber) rows.push({ term: "IOSS number", value: treatment.iossNumber, mono: true });
  if (treatment.consignmentEurMinor !== null && (kind === "ioss" || treatment.reason === "ioss_over_limit")) {
    rows.push({ term: "Consignment value (EUR, without VAT)", value: formatMoney(treatment.consignmentEurMinor, "EUR", locale) });
  }
  if (treatment.shippingRate !== null) {
    rows.push({ term: "Shipping VAT", value: `${ratePercent(treatment.shippingRate)}${treatment.shippingRule !== "standard" ? ` (rule: ${treatment.shippingRule.replace("_", " ")})` : ""}` });
  }
  const nameDiffers =
    vies.registeredName !== null && typedCompany !== null && vies.registeredName.trim().toLowerCase() !== typedCompany.trim().toLowerCase();
  return (
    <section aria-labelledby="vat-treatment" className="rounded-lg border border-border bg-background p-5">
      <h2 id="vat-treatment" className="mb-1 font-medium">
        VAT treatment
      </h2>
      <p className="text-sm font-medium">{KIND_WORDS[kind]}</p>
      <p className="mb-3 text-sm text-muted">{reasonStaffText(treatment.reason)}</p>
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
        <p className="mt-3 text-sm text-muted">
          The name VIES holds is not the company the buyer typed. That can be harmless (a trading name). Nothing was blocked because of it: compare them if the order looks wrong.
        </p>
      )}
      <p className="mt-3 text-xs text-muted">Frozen when the order was placed. The buyer&apos;s number and VIES&apos;s answer are shown only to staff and to the buyer on their own order.</p>
    </section>
  );
}
