import { financeEn, type FinanceMessages } from "@/lib/admin-messages/finance.en";
import { fillWords } from "@/lib/admin-fill";
import type { LiabilityRow } from "@/lib/liabilities";

import { DataTable, type Column } from "./data-table";
import { AnalyticsSection, Note } from "./section";
import { safeMoney, signedMoney } from "./subscriptions-view";

/**
 * What the store owes customers on the Finance page (wave 11 unit B, D381, docs/analytics.md "Owed to customers"): bonus credit and gift
 * cards, each a roll-forward from its ledger's own sums, the period's movements by column, and what customers hold now, each currency on its
 * own row and never added across currencies. Bonus credit in another currency than the main one shows the main one beside it, for display
 * only. Drawn only when the store has either ledger.
 */
export function LiabilitiesView({ locale, rows, words = financeEn }: { locale: string; rows: LiabilityRow[]; words?: FinanceMessages }) {
  if (rows.length === 0) return null;
  const w = words.liabilities;
  const money = (r: LiabilityRow) => safeMoney(r.currency, locale);
  const moved = (r: LiabilityRow, minor: number) => (minor === 0 ? money(r)(0) : signedMoney(money(r), minor));
  const columns: Column<LiabilityRow>[] = [
    { key: "ledger", label: w.ledger, cell: (r) => (r.ledger === "bonus" ? w.bonus : w.giftCards) },
    { key: "currency", label: w.currency, cell: (r) => r.currency },
    { key: "opening", label: w.opening, align: "right", cell: (r) => money(r)(r.openingMinor) },
    { key: "granted", label: w.granted, align: "right", cell: (r) => moved(r, r.columns.granted) },
    { key: "used", label: w.used, align: "right", cell: (r) => moved(r, r.columns.used) },
    { key: "returned", label: w.returned, align: "right", cell: (r) => moved(r, r.columns.returned) },
    { key: "takenBack", label: w.takenBack, align: "right", cell: (r) => moved(r, r.columns.takenBack) },
    { key: "expired", label: w.expired, align: "right", cell: (r) => moved(r, r.columns.expired) },
    { key: "changed", label: w.changed, align: "right", cell: (r) => moved(r, r.columns.changed) },
    ...(rows.some((r) => r.columns.other !== 0) ? [{ key: "other", label: w.other, align: "right" as const, cell: (r: LiabilityRow) => moved(r, r.columns.other) }] : []),
    { key: "closing", label: w.closing, align: "right", cell: (r) => money(r)(r.closingMinor) },
    { key: "addsUp", label: w.addsUp, cell: (r) => (r.addsUp ? w.adds : fillWords(w.off, { amount: signedMoney(money(r), r.differenceMinor) })) },
    {
      key: "owedNow",
      label: w.owedNow,
      align: "right",
      cell: (r) =>
        r.owedNowMinor === null ? (
          "–"
        ) : (
          <>
            {money(r)(r.owedNowMinor)}
            {r.owedNowMain && (
              <span className="block text-xs text-muted">
                {r.owedNowMain.minor === null
                  ? fillWords(w.noRate, { currency: r.owedNowMain.currency })
                  : fillWords(w.inMain, { amount: safeMoney(r.owedNowMain.currency, locale)(r.owedNowMain.minor), currency: r.owedNowMain.currency })}
              </span>
            )}
          </>
        ),
    },
  ];
  return (
    <AnalyticsSection id="owed" title={w.title} description={w.description}>
      <DataTable caption={w.caption} columns={columns} rows={rows} rowKey={(r) => `${r.ledger}-${r.currency}`} exportId="finance.liabilities" />
      <Note>{w.note}</Note>
    </AnalyticsSection>
  );
}
