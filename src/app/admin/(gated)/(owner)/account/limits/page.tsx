import type { Metadata } from "next";

import { UsageLines } from "@/components/admin/usage-limits";
import { Card, PageHeader } from "@/components/admin/ui";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { requireAccount } from "@/server/auth";
import { ownerUsage } from "@/server/usage";

export const metadata: Metadata = { title: "Usage and limits" };

/**
 * The owner's usage and limits (D314, `docs/capacity.md` step 1.6): each store they own, this month, against what its plan includes.
 * Only stores the account owns are shown; each store's Billing page has the same lines and its plans.
 */
export default async function OwnerLimitsPage() {
  const account = await requireAccount();
  const lang = adminLangOf(account.adminLocale);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const w = adminText(lang, "capacity");
  const { stores } = await ownerUsage(account.id);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.owner.title} description={w.owner.description} />
      {stores.length === 0 ? (
        <Card compact>
          <p className="text-body text-muted">{w.owner.none}</p>
        </Card>
      ) : (
        stores.map((store) => (
          <Card key={store.id} title={store.name} description={w.usage.month} compact>
            <UsageLines lines={store.lines} words={w} locale={locale} plansHref={`/admin/${store.slug}/billing`} />
          </Card>
        ))
      )}
    </div>
  );
}
