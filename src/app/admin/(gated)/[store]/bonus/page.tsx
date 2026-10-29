import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { requireFeature } from "@/components/admin/feature-off";
import { BonusOverviewCard } from "@/components/admin/bonus-overview";
import { BonusRewardsCard } from "@/components/admin/bonus-rewards-card";
import { BonusSettingsForm } from "@/components/admin/bonus-settings-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { mainCurrency } from "@/lib/markets";
import { memberCan, requirePermission } from "@/server/permissions";
import { bonusOverview, getBonusSettings } from "@/server/bonus";
import { listRewards } from "@/server/bonus-rewards";
import { listProductChoices } from "@/server/discounts";
import { PageHeader } from "@/components/admin/ui";

import { saveBonusAction, saveRewardAction, switchRewardAction } from "./actions";

export const metadata: Metadata = { title: "Bonus credits" };

/**
 * The store's bonus program (D130): signed-in customers earn credits on what they pay and use them on a later order.
 * Owners set the rules; staff see them and what the program owes.
 */
export default async function BonusPage({ params }: PageProps<"/admin/[store]/bonus">) {
  const current = await requirePermission((await params).store, "marketing:read");
  const off = requireFeature(current, "bonus");
  if (off) return off;
  const { store } = current;
  const lang = adminLangOf(current.account.adminLocale);
  const words = adminText(lang, "loyalty");
  const w = words.bonusPage;
  const locale = store.markets[0]?.locale ?? "nb-NO";
  const [settings, overview, rewards, products] = await Promise.all([
    getBonusSettings(store.id),
    bonusOverview(store.id),
    listRewards(store.id),
    listProductChoices(store.id, locale),
  ]);

  return (
    <AdminTextScope texts={adminTexts(lang, ["loyalty"])}>
      <div className="flex flex-col gap-6">
        <PageHeader title={w.title} description={<>{settings.enabled ? w.on : w.off} {w.description}</>} />
        <BonusOverviewCard overview={overview} locale={locale} words={words} />
        <BonusSettingsForm
          initial={settings}
          currency={mainCurrency(store)}
          locale={locale}
          canEdit={memberCan(current, "owner")}
          save={saveBonusAction.bind(null, store.slug)}
        />
        <BonusRewardsCard
          rewards={rewards}
          currency={mainCurrency(store)}
          products={products}
          markets={store.markets.map((m) => ({ code: m.code, currency: m.nativeCurrency, name: m.name }))}
          canEdit={memberCan(current, "marketing:write")}
          save={saveRewardAction.bind(null, store.slug)}
          toggle={switchRewardAction.bind(null, store.slug)}
          locale={locale}
        />
      </div>
    </AdminTextScope>
  );
}
