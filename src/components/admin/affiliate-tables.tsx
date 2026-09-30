import Link from "next/link";

import { AffiliateBlockForm } from "@/components/admin/affiliate-block-form";
import { attributionStatus, personLabel } from "@/lib/affiliate-admin";
import type { AffiliateAttributionRow, AffiliateResult, AffiliateRow } from "@/lib/affiliates";
import { formatMoney } from "@/lib/money";

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
}: {
  rows: AffiliateRow[];
  storeSlug: string;
  currency: string;
  locale: string;
  canBlock: boolean;
  block: (customerId: string, blocked: boolean, note: string) => Promise<AffiliateResult>;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted">Nobody has a link yet. Customers get theirs when they open Refer a friend in My account.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <caption className="sr-only">Customers with a referral link</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="py-2 pr-4 font-medium">Customer</th>
            <th scope="col" className="py-2 pr-4 font-medium">Code</th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">Friends</th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">Earned</th>
            <th scope="col" className="py-2 font-medium">{canBlock ? "Block" : "Status"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.customerId} className="border-b border-border align-top last:border-0">
              <td className="py-2 pr-4">
                <Link href={`/admin/${storeSlug}/customers/${row.customerId}`} className="underline">
                  {personLabel(row.name, row.email)}
                </Link>
              </td>
              <td className="py-2 pr-4 font-mono text-xs">{row.code}</td>
              <td className="py-2 pr-4 text-right">{row.friends}</td>
              <td className="py-2 pr-4 text-right whitespace-nowrap">{formatMoney(row.earnedMinor, currency, locale)}</td>
              <td className="py-2">
                {canBlock ? (
                  <AffiliateBlockForm
                    blocked={row.blocked}
                    who={row.name.trim().split(/\s+/)[0] || row.email}
                    act={block.bind(null, row.customerId)}
                  />
                ) : row.blocked ? (
                  "Blocked"
                ) : (
                  "Earning"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The attributed orders (D131): who, what the friend got, what the referrer earned, and why not when a guard stopped it. */
export function AttributionsTable({
  rows,
  storeSlug,
  locale,
}: {
  rows: AffiliateAttributionRow[];
  storeSlug: string;
  locale: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted">No order has come through a link yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[48rem] text-left text-sm">
        <caption className="sr-only">Orders that came through a referral link</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="py-2 pr-4 font-medium">Date</th>
            <th scope="col" className="py-2 pr-4 font-medium">Order</th>
            <th scope="col" className="py-2 pr-4 font-medium">Referrer</th>
            <th scope="col" className="py-2 pr-4 font-medium">Friend</th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">Welcome discount</th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">Credits</th>
            <th scope="col" className="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border align-top last:border-0">
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
                  "Deleted customer"
                )}
              </td>
              <td className="py-2 pr-4 text-right whitespace-nowrap">
                {row.discountMinor > 0 ? formatMoney(row.discountMinor, row.orderCurrency, locale) : "–"}
              </td>
              <td className="py-2 pr-4 text-right whitespace-nowrap">{row.rewardMinor > 0 ? formatMoney(row.rewardMinor, row.creditsCurrency, locale) : "–"}</td>
              <td className="py-2">{attributionStatus(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
