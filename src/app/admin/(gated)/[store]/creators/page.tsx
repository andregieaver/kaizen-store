import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { CreatorPayouts, CreatorSettingsForm, CreatorsList } from "@/components/admin/creators-admin";
import { requireFeature } from "@/components/admin/feature-off";
import { PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { todayIn } from "@/lib/work-dates";
import { areaTexts } from "@/lib/admin-area";
import { LOYALTY_WORDS } from "@/lib/admin-words/loyalty";
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
  const w = LOYALTY_WORDS[lang].creators;
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
    <AdminTextScope texts={areaTexts(lang, { loyalty: LOYALTY_WORDS })}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={w.title}
          description={
            <>
              <span className="sm:hidden">{w.phone.lead}</span>
              <span className="max-sm:hidden">
                {settings.enabled ? w.on : w.off} {w.description}
              </span>
            </>
          }
        />
        <CreatorSettingsForm
          initial={settings}
          categories={categories}
          canEdit={isOwner}
          save={saveCreatorSettingsAction.bind(null, store.slug)}
        />
        {/* Round 50 (D765): with no creators and no payouts, a phone says both in one line. */}
        {creators.length === 0 && payouts.length === 0 && <p className="text-body text-muted sm:hidden">{w.phone.none}</p>}
        <div className={creators.length === 0 && payouts.length === 0 ? "flex flex-col gap-6 max-sm:hidden" : "flex flex-col gap-6"}>
        <CreatorsList
          today={todayIn(store.timeZone)}
          rows={creators}
          locale={locale}
          isOwner={isOwner}
          decide={decideCreatorAction.bind(null, store.slug)}
          setRate={setCreatorRateAction.bind(null, store.slug)}
          recordPayout={recordCreatorPayoutAction.bind(null, store.slug)}
        />
        <CreatorPayouts rows={payouts} locale={locale} csvAction={isOwner ? `/admin/${store.slug}/creators/csv` : null} />
        </div>
      </div>
    </AdminTextScope>
  );
}
