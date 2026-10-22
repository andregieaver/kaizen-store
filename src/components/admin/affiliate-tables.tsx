import Link from "next/link";

import { AffiliateBlockForm } from "@/components/admin/affiliate-block-form";
import { countWords } from "@/lib/admin-fill";
import { loyaltyEn, type LoyaltyMessages } from "@/lib/admin-messages/loyalty.en";
import { attributionStatus, personLabel } from "@/lib/affiliate-admin";
import type { AffiliateAttributionRow, AffiliateResult, AffiliateRow } from "@/lib/affiliates";
import { formatMoney } from "@/lib/money";
import { Chip, List, ListRow, RowAmount, RowLead } from "@/components/admin/ui";

/**
 * The store's referrers (D131): name and email (staff may see them), their code, how many friends ordered, what they
 * earned and whether they are blocked. `block` is bound to the store by the page, and to a customer here.
 */
export function ReferrersTable({
  rows,
  storeSlug,
  currency,
  locale,
  canBlock,
  block,
  words = loyaltyEn,
}: {
  rows: AffiliateRow[];
  storeSlug: string;
  currency: string;
  locale: string;
  canBlock: boolean;
  block: (customerId: string, blocked: boolean, note: string) => Promise<AffiliateResult>;
  words?: LoyaltyMessages;
}) {
  const w = words.affiliateTables;
  if (rows.length === 0) {
    return <p className="text-sm text-muted">{w.noReferrers}</p>;
  }
  return (
    <List label={w.referrersLabel}>
      {rows.map((row) => (
        <ListRow key={row.customerId}>
          <RowLead
            title={personLabel(row.name, row.email)}
            href={`/admin/${storeSlug}/customers/${row.customerId}`}
            sub={
              <>
                <span className="font-mono">{row.code}</span> · {countWords(row.friends, w.friends)}
              </>
            }
          />
          {canBlock ? (
            <AffiliateBlockForm blocked={row.blocked} who={row.name.trim().split(/\s+/)[0] || row.email} act={block.bind(null, row.customerId)} />
          ) : (
            <Chip signal={row.blocked ? "danger" : "positive"} dot>
              {row.blocked ? w.blocked : w.earning}
            </Chip>
          )}
          <RowAmount>{formatMoney(row.earnedMinor, currency, locale)}</RowAmount>
        </ListRow>
      ))}
    </List>
  );
}

/** The attributed orders (D131): who, what the friend got, what the referrer earned, and why not when a guard stopped it. */
export function AttributionsTable({
  rows,
  storeSlug,
  locale,
  words = loyaltyEn,
}: {
  rows: AffiliateAttributionRow[];
  storeSlug: string;
  locale: string;
  words?: LoyaltyMessages;
}) {
  const w = words.affiliateTables;
  if (rows.length === 0) return <p className="text-sm text-muted">{w.noAttributions}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[48rem] text-left text-sm">
        <caption className="sr-only">{w.caption}</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="py-2 pr-4 font-medium">{w.date}</th>
            <th scope="col" className="py-2 pr-4 font-medium">{w.order}</th>
            <th scope="col" className="py-2 pr-4 font-medium">{w.referrer}</th>
            <th scope="col" className="py-2 pr-4 font-medium">{w.friend}</th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">{w.discount}</th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">{w.credits}</th>
            <th scope="col" className="py-2 font-medium">{w.status}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-line align-top last:border-0">
              <td className="py-2 pr-4 whitespace-nowrap">
                <time dateTime={row.at}>{new Date(row.at).toLocaleDateString(locale, { dateStyle: "medium", timeZone: "Europe/Oslo" })}</time>
              </td>
              <td className="py-2 pr-4">
                <Link href={`/admin/${storeSlug}/orders/${row.orderId}`} className="underline">
                  #{row.orderNumber}
                </Link>
              </td>
              <td className="py-2 pr-4">
                <Link href={`/admin/${storeSlug}/customers/${row.affiliateId}`} className="underline">
                  {row.affiliateName}
                </Link>
                <span className="block font-mono text-xs text-muted">{row.code}</span>
              </td>
              <td className="py-2 pr-4">
                {row.friendId ? (
                  <Link href={`/admin/${storeSlug}/customers/${row.friendId}`} className="underline">
                    {personLabel(row.friendName, row.friendEmail)}
                  </Link>
                ) : (
                  w.deleted
                )}
              </td>
              <td className="py-2 pr-4 text-right whitespace-nowrap">
                {row.discountMinor > 0 ? formatMoney(row.discountMinor, row.orderCurrency, locale) : "–"}
              </td>
              <td className="py-2 pr-4 text-right whitespace-nowrap">{row.rewardMinor > 0 ? formatMoney(row.rewardMinor, row.creditsCurrency, locale) : "–"}</td>
              <td className="py-2">{attributionStatus(row, { statuses: words.affiliateStatus, reasons: words.affiliateRejection })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
