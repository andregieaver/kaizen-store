import Link from "next/link";

import { AffiliateBlockForm } from "@/components/admin/affiliate-block-form";
import { fillWords } from "@/lib/admin-fill";
import { loyaltyEn, type LoyaltyMessages } from "@/lib/admin-messages/loyalty.en";
import { attributionStatus, personLabel } from "@/lib/affiliate-admin";
import type { AffiliateResult, CustomerAffiliate } from "@/lib/affiliates";
import { moneyIn } from "@/lib/bonus-admin";
import { Card } from "@/components/admin/ui";

/** Whether a customer's page shows the referral program: they have a link, were referred, or an order came through one. */
export const showsAffiliate = (data: CustomerAffiliate): boolean => data.code !== null || data.referredBy !== null || data.attributions.length > 0;

/**
 * A customer in the referral program (D131), on their page: who referred them, their own link with how many friends
 * ordered and what it earned, the orders it is part of, and a form to block or unblock them. Staff may see names and
 * emails here; the shopper never sees a friend's.
 */
export function CustomerAffiliateSection({
  data,
  storeSlug,
  locale,
  who,
  block,
  words = loyaltyEn,
}: {
  data: CustomerAffiliate;
  storeSlug: string;
  locale: string;
  /** The customer as the block buttons name them. */
  who: string;
  block: (blocked: boolean, note: string) => Promise<AffiliateResult>;
  /** The `loyalty` catalogue in the account's language; the block form reads its own through `useAdminText()`. */
  words?: LoyaltyMessages;
}) {
  const w = words.customerAffiliate;
  const credits = moneyIn(data.currency, locale);
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: "medium", timeZone: "Europe/Oslo" });
  return (
    <Card title={w.title} compact>
      {data.referredBy && (
        <p className="mb-3 text-sm">
          {w.cameThrough}
          <Link href={`/admin/${storeSlug}/customers/${data.referredBy.customerId}`} className="underline">
            {personLabel(data.referredBy.name, data.referredBy.email)}
          </Link>{" "}
          <span className="font-mono text-xs">{data.referredBy.code}</span>.
        </p>
      )}
      {data.code && (
        <>
          <dl className="mb-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
            <div className="flex flex-col gap-0.5">
              <dt className="text-muted">{w.code}</dt>
              <dd className="font-mono">{data.code}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-muted">{w.friends}</dt>
              <dd className="text-xl font-medium">{data.friends}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-muted">{w.earned}</dt>
              <dd className="text-xl font-medium">{credits(data.earnedMinor)}</dd>
            </div>
          </dl>
          {data.blocked && (
            <p role="note" className="mb-3 rounded-md bg-sunken p-3 text-sm">
              {w.blocked} {data.blockedReason && fillWords(w.reason, { reason: data.blockedReason })}
            </p>
          )}
          <div className="mb-4">
            <AffiliateBlockForm blocked={data.blocked} who={who} act={block} />
          </div>
        </>
      )}
      {data.attributions.length > 0 && (
        <>
          <h3 className="mb-2 text-body-strong text-ink">{w.attributions}</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {data.attributions.map((row) => (
              <li key={row.id}>
                {date(row.at)} ·{" "}
                <Link href={`/admin/${storeSlug}/orders/${row.orderId}`} className="underline">
                  #{row.orderNumber}
                </Link>{" "}
                · {attributionStatus(row, { statuses: words.affiliateStatus, reasons: words.affiliateRejection })}
                {row.rewardMinor > 0 && fillWords(w.inCredits, { amount: moneyIn(row.creditsCurrency, locale)(row.rewardMinor) })}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
