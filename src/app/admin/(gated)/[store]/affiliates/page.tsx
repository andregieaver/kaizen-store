import type { Metadata } from "next";

import { AffiliateOverviewCard } from "@/components/admin/affiliate-overview";
import { AffiliateSettingsForm } from "@/components/admin/affiliate-settings-form";
import { AttributionsTable, ReferrersTable } from "@/components/admin/affiliate-tables";
import { requireMember } from "@/server/auth";
import { affiliateOverview, getAffiliateSettings, listAffiliates, listAttributions } from "@/server/affiliates";
import { getBonusSettings } from "@/server/bonus";

import { blockAffiliateAction, saveAffiliateAction } from "./actions";

export const metadata: Metadata = { title: "Referral program" };

/**
 * The store's referral program (D131): signed-in customers share a link, a friend's first order gets a welcome discount
 * and the customer who shared it earns bonus credits. Owners set the rules; staff see them, the referrers and the orders
 * that came through links, and can block a referrer.
 */
export default async function AffiliatesPage({ params }: PageProps<"/admin/[store]/affiliates">) {
  const { store, role } = await requireMember((await params).store);
  const [settings, overview, referrers, attributions, bonus] = await Promise.all([
    getAffiliateSettings(store.id),
    affiliateOverview(store.id),
    listAffiliates(store.id),
    listAttributions(store.id),
    getBonusSettings(store.id),
  ]);
  const locale = store.markets[0]?.locale ?? "nb-NO";
  const working = settings.enabled && settings.bonusOn;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Referral program</h1>
        <p className="text-sm text-muted">
          {working
            ? "The referral program is on."
            : settings.enabled
              ? "The referral program is paused: the bonus program is off."
              : "The referral program is off."}{" "}
          Signed-in customers share a link; a friend&apos;s first order gets a welcome discount and the customer who shared it earns
          bonus credits.
        </p>
      </div>
      <AffiliateOverviewCard overview={overview} locale={locale} />
      <AffiliateSettingsForm
        initial={settings}
        currency={settings.currency}
        locale={locale}
        bonusOn={settings.bonusOn}
        pendingDays={bonus.pendingDays}
        canEdit={role === "owner"}
        save={saveAffiliateAction.bind(null, store.slug)}
      />
      <section aria-labelledby="referrers-heading" className="flex flex-col gap-3">
        <h2 id="referrers-heading" className="text-lg font-semibold">
          Referrers
        </h2>
        <ReferrersTable
          rows={referrers}
          storeSlug={store.slug}
          currency={settings.currency}
          locale={locale}
          canBlock
          block={blockAffiliateAction.bind(null, store.slug)}
        />
      </section>
      <section aria-labelledby="attributions-heading" className="flex flex-col gap-3">
        <h2 id="attributions-heading" className="text-lg font-semibold">
          Orders through links
        </h2>
        <AttributionsTable rows={attributions} storeSlug={store.slug} locale={locale} />
      </section>
    </div>
  );
}
