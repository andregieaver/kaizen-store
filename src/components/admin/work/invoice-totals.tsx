import { formatMoney } from "@/lib/money";
import type { InvoiceTotals } from "@/lib/work-calc";
import { VAT_NOTE_LABELS, vatGroupLabel } from "@/lib/work-invoice-ui";
import type { VatNoteKey } from "@/lib/work-vat";

/**
 * An invoice's totals: the amount before VAT, the discount, the VAT per rate and the total, in the invoice's
 * currency. The figures are sums of what each line rounded to (`totalsOf`), the same on the page, in the editor's
 * live preview and on the document. No `"use client"`: the editor and the issued page both draw it.
 */
export function InvoiceTotalsView({
  totals,
  currency,
  locale,
  notes = [],
  live = false,
  totalLabel = "Total with VAT",
}: {
  totals: InvoiceTotals;
  currency: string;
  locale: string;
  notes?: readonly VatNoteKey[];
  /** A running clock's time is counted in these figures. */
  live?: boolean;
  totalLabel?: string;
}) {
  const money = (minor: number) => formatMoney(minor, currency, locale);
  return (
    <div className="flex flex-col gap-1 text-sm" data-testid="invoice-totals">
      <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 self-end sm:min-w-72">
        <dt className="text-muted">Amount without VAT</dt>
        <dd className="text-right tabular-nums">{money(totals.subtotalMinor)}</dd>
        {totals.discountMinor > 0 && (
          <>
            <dt className="text-muted">Discounts included</dt>
            <dd className="text-right tabular-nums">{money(totals.discountMinor)}</dd>
          </>
        )}
        {totals.vatGroups.map((group) => (
          <VatRow
            key={`${group.category}:${group.vatBp}`}
            label={vatGroupLabel(group)}
            amount={money(group.vatMinor)}
            net={money(group.netMinor)}
          />
        ))}
        <dt className="border-t border-border pt-2 font-medium">{totalLabel}</dt>
        <dd className="border-t border-border pt-2 text-right text-base font-semibold tabular-nums">
          {money(totals.totalMinor)}
        </dd>
      </dl>
      {live && <p className="self-end text-xs text-muted">Includes time from your running clock, until you stop it.</p>}
      {notes.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-muted">
          {notes.map((key) => (
            <li key={key}>{VAT_NOTE_LABELS[key]}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VatRow({ label, amount, net }: { label: string; amount: string; net: string }) {
  return (
    <>
      <dt className="text-muted">
        {label}
        <span className="text-xs"> on {net}</span>
      </dt>
      <dd className="text-right tabular-nums">{amount}</dd>
    </>
  );
}
