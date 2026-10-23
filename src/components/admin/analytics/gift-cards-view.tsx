import Link from "next/link";

import { financeEn, type FinanceMessages } from "@/lib/admin-messages/finance.en";
import { formatCount } from "@/lib/analytics-core";
import type { LiabilityLine } from "@/lib/gift-card-admin";

import { DataTable, type Column } from "./data-table";
import { AnalyticsSection, Note } from "./section";
import { safeMoney, signedMoney } from "./subscriptions-view";

/**
 * Gift cards on the Finance page (D300 F4, docs/analytics.md "Gift cards"): what customers hold on the store's cards now, and the period's
 * movements, each currency on its own row and never added across currencies or converted. A card sold is money owed, not a sale: Finance's
 * figures above leave gift cards sold out and count what is bought with them. Drawn only when the store has a card.
 */
export function GiftCardsView({ base, locale, lines, words = financeEn }: { base: string; locale: string; lines: LiabilityLine[]; words?: FinanceMessages }) {
  if (lines.length === 0) return null;
  const w = words.giftCards;
  const in_ = (l: LiabilityLine) => safeMoney(l.currency, locale);
  const columns: Column<LiabilityLine>[] = [
    { key: "currency", label: w.currency, cell: (l) => l.currency },
    { key: "outstanding", label: w.held, align: "right", cell: (l) => in_(l)(l.outstandingMinor) },
    { key: "cards", label: w.cards, align: "right", cell: (l) => formatCount(l.cards) },
    { key: "issued", label: w.issued, align: "right", cell: (l) => in_(l)(l.issuedMinor) },
    { key: "spent", label: w.spent, align: "right", cell: (l) => in_(l)(l.spentMinor) },
    { key: "refunded", label: w.refunded, align: "right", cell: (l) => in_(l)(l.refundedMinor) },
    { key: "adjusted", label: w.adjusted, align: "right", cell: (l) => (l.adjustedMinor === 0 ? in_(l)(0) : signedMoney(in_(l), l.adjustedMinor)) },
    { key: "expired", label: w.expired, align: "right", cell: (l) => in_(l)(l.expiredMinor) },
    { key: "voided", label: w.voided, align: "right", cell: (l) => in_(l)(l.voidedMinor) },
  ];
  return (
    <AnalyticsSection
      id="gift-cards"
      title={w.title}
      description={w.description}
      action={
        <Link href={`${base}/gift-cards`} className="underline-offset-2 hover:underline">
          {w.all}
        </Link>
      }
    >
      <DataTable
        caption={w.caption}
        columns={columns}
        rows={lines}
        rowKey={(l) => l.currency}
        exportId="finance.gift_cards"
      />
      <Note>{w.note}</Note>
    </AnalyticsSection>
  );
}
