import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { requireFeature } from "@/components/admin/feature-off";
import { BonusOverviewCard } from "@/components/admin/bonus-overview";
import { BonusSettingsForm } from "@/components/admin/bonus-settings-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { mainCurrency } from "@/lib/markets";
import { memberCan, requirePermission } from "@/server/permissions";
import { bonusOverview, getBonusSettings } from "@/server/bonus";
import { PageHeader } from "@/components/admin/ui";

import { saveBonusAction } from "./actions";

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
  const [settings, overview] = await Promise.all([getBonusSettings(store.id), bonusOverview(store.id)]);
  const locale = store.markets[0]?.locale ?? "nb-NO";

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
      </div>
    </AdminTextScope>
  );
}
