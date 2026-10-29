import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { CreatorPayouts, CreatorSettingsForm, CreatorsList } from "@/components/admin/creators-admin";
import { requireFeature } from "@/components/admin/feature-off";
import { PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { getCreatorSettings, listCreatorPayouts, listCreators } from "@/server/creators";
import { memberCan, requirePermission } from "@/server/permissions";
import { listTerms } from "@/server/taxonomy";

import { decideCreatorAction, recordCreatorPayoutAction, saveCreatorSettingsAction, setCreatorRateAction } from "./actions";

export const metadata: Metadata = { title: "Creators" };

/**
 * The store's creator programme (wave 11 unit G, D386): the owner's settings, the creators and their applications (approve, decline, stop),
 * a creator's own rate and the payouts recorded. Staff with `marketing:read` see it; deciding needs `marketing:write`, money the owner.
 */
export default async function CreatorsPage({ params }: PageProps<"/admin/[store]/creators">) {
  const current = await requirePermission((await params).store, "marketing:read");
  const off = requireFeature(current, "shop");
  if (off) return off;
  const { store } = current;
  const lang = adminLangOf(current.account.adminLocale);
  const w = adminText(lang, "loyalty").creators;
  const [settings, creators, payouts, terms] = await Promise.all([
    getCreatorSettings(store.id),
    listCreators(store.id),
    listCreatorPayouts(store.id),
    listTerms({ storeId: store.id, contentType: "product" }),
  ]);
  const locale = store.markets[0]?.locale ?? "nb-NO";
  const isOwner = memberCan(current, "owner");
  const categories = terms.filter((term) => term.kind === "category").map((term) => ({ id: term.id, name: term.name }));

  return (
    <AdminTextScope texts={adminTexts(lang, ["loyalty"])}>
      <div className="flex flex-col gap-6">
        <PageHeader title={w.title} description={<>{settings.enabled ? w.on : w.off} {w.description}</>} />
        <CreatorSettingsForm
          initial={settings}
          categories={categories}
          canEdit={isOwner}
          save={saveCreatorSettingsAction.bind(null, store.slug)}
        />
        <CreatorsList
          rows={creators}
          locale={locale}
          isOwner={isOwner}
          decide={decideCreatorAction.bind(null, store.slug)}
          setRate={setCreatorRateAction.bind(null, store.slug)}
          recordPayout={recordCreatorPayoutAction.bind(null, store.slug)}
        />
        <CreatorPayouts rows={payouts} locale={locale} csvAction={isOwner ? `/admin/${store.slug}/creators/csv` : null} />
      </div>
    </AdminTextScope>
  );
}
