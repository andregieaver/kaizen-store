import Link from "next/link";

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
export function GiftCardsView({ base, locale, lines }: { base: string; locale: string; lines: LiabilityLine[] }) {
  if (lines.length === 0) return null;
  const in_ = (l: LiabilityLine) => safeMoney(l.currency, locale);
  const columns: Column<LiabilityLine>[] = [
    { key: "currency", label: "Currency", cell: (l) => l.currency },
    { key: "outstanding", label: "Held now", align: "right", cell: (l) => in_(l)(l.outstandingMinor) },
    { key: "cards", label: "Cards", align: "right", cell: (l) => formatCount(l.cards) },
    { key: "issued", label: "Issued", align: "right", cell: (l) => in_(l)(l.issuedMinor) },
    { key: "spent", label: "Spent", align: "right", cell: (l) => in_(l)(l.spentMinor) },
    { key: "refunded", label: "Refunded back", align: "right", cell: (l) => in_(l)(l.refundedMinor) },
    { key: "adjusted", label: "Changed by staff", align: "right", cell: (l) => (l.adjustedMinor === 0 ? in_(l)(0) : signedMoney(in_(l), l.adjustedMinor)) },
    { key: "expired", label: "Expired", align: "right", cell: (l) => in_(l)(l.expiredMinor) },
    { key: "voided", label: "Deactivated", align: "right", cell: (l) => in_(l)(l.voidedMinor) },
  ];
  return (
    <AnalyticsSection
      id="gift-cards"
      title="Gift cards"
      description="What customers hold on your gift cards now, and what happened to them in the period, in each card's own currency."
      action={
        <Link href={`${base}/gift-cards`} className="underline-offset-2 hover:underline">
          All gift cards
        </Link>
      }
    >
      <DataTable
        caption="Gift cards per currency: held now, cards, and the period's issued, spent, refunded back, changed by staff, expired and deactivated"
        columns={columns}
        rows={lines}
        rowKey={(l) => l.currency}
        exportId="finance.gift_cards"
      />
      <Note>
        Gift cards sold are money you owe until they are spent: they are not in the sales above. What customers buy with them is. While the store takes
        test payments, only test cards are counted; once it is live, only real ones.
      </Note>
    </AnalyticsSection>
  );
}
