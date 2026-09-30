import Link from "next/link";

import { attributionStatus } from "@/lib/affiliate-admin";
import type { AffiliateAttributionRow } from "@/lib/affiliates";
import { moneyIn } from "@/lib/bonus-admin";

/** The friend's welcome discount (D131) among an order's totals; nothing when the order had none. */
export function ReferralDiscountRow({ minor, currency, locale }: { minor: number; currency: string; locale: string }) {
  if (minor <= 0) return null;
  return (
    <div className="flex justify-between">
      <dt>Welcome discount (referral)</dt>
      <dd>−{moneyIn(currency, locale)(minor)}</dd>
    </div>
  );
}

/**
 * Whose friend an order is (D131), for the order's page: the referrer and their code, what the friend was given, what the
 * referrer earned and, when a guard stopped the reward, why. Nothing for an order no link led to.
 */
export function OrderAttributionCard({
  attribution,
  storeSlug,
  locale,
}: {
  attribution: AffiliateAttributionRow | null;
  storeSlug: string;
  locale: string;
}) {
  if (!attribution) return null;
  const credits = moneyIn(attribution.creditsCurrency, locale);
  return (
    <section aria-labelledby="order-referral-heading" className="rounded-lg border border-border p-4">
      <h2 id="order-referral-heading" className="mb-3 font-medium">
        Referral
      </h2>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted">Shared by</dt>
          <dd>
            <Link href={`/admin/${storeSlug}/customers/${attribution.affiliateId}`} className="underline">
              {attribution.affiliateName}
            </Link>{" "}
            <span className="font-mono text-xs">{attribution.code}</span>
          </dd>
        </div>
        <div>
          <dt className="text-muted">Status</dt>
          <dd>{attributionStatus(attribution)}</dd>
        </div>
        <div>
          <dt className="text-muted">Welcome discount given</dt>
          <dd>{attribution.discountMinor > 0 ? moneyIn(attribution.orderCurrency, locale)(attribution.discountMinor) : "None"}</dd>
        </div>
        <div>
          <dt className="text-muted">Credits earned by the referrer</dt>
          <dd>{attribution.rewardMinor > 0 ? credits(attribution.rewardMinor) : "None"}</dd>
        </div>
      </dl>
    </section>
  );
}
