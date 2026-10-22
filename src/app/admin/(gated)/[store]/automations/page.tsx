import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { AutomationSwitch } from "@/components/admin/automation-editor";
import { ButtonLink, Card, Chip, PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { LIFECYCLE_KINDS } from "@/lib/automations";
import { automationDays } from "@/lib/marketing-words";
import { featureOn } from "@/lib/store-features";
import { automationStats, getAutomations } from "@/server/automations";
import { memberCan, requirePermission } from "@/server/permissions";

import { switchAutomationAction } from "./actions";

export const metadata: Metadata = { title: "Email automations" };

/**
 * The store's automations (wave 5 unit D, D298, `docs/wave-5-marketing.md` 6.6): four emails that go by themselves once switched on, each saying
 * what it does, whether it is on and how many it sent lately, with one main action.
 */
export default async function AutomationsPage({ params }: PageProps<"/admin/[store]/automations">) {
  const member = await requirePermission((await params).store, "marketing:read");
  const { store } = member;
  const base = `/admin/${store.slug}/automations`;
  const mayWrite = memberCan(member, "marketing:write");
  const [automations, stats] = await Promise.all([getAutomations(store), automationStats(store.id)]);
  const stock = automations.back_in_stock;
  const shop = featureOn(store, "shop");
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "marketing");
  const wa = w.automations;
  const n = (v: number) => v.toLocaleString(ADMIN_LANG_FACTS[lang].locale);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={wa.title}
        description={wa.description}
      />
      <AdminTextScope texts={adminTexts(lang, ["marketing"])}>
      <div className="grid gap-4 lg:grid-cols-2">
        {LIFECYCLE_KINDS.map((kind) => {
          const a = automations[kind];
          const words = wa.kinds[kind];
          return (
            <Card
              key={kind}
              title={words.title}
              compact
              aside={
                <Chip signal={a.enabled ? "positive" : "neutral"} dot>
                  {a.enabled ? w.common.on : w.common.off}
                </Chip>
              }
            >
              <div className="flex flex-col gap-3">
                <p className="text-body text-ink">{words.does}</p>
                <p className="text-body text-ink-2">
                  {automationDays(kind, a.delayDays ?? 0, wa)} {a.enabled ? fillWords(wa.sentLately, { n: n(stats.sent[kind]) }) : ""}
                </p>
                <div className="flex flex-wrap items-start gap-2">
                  <ButtonLink href={`${base}/${kind}`} kind={a.saved ? "quiet" : "main"}>
                    {a.saved ? wa.edit : wa.setUp}
                  </ButtonLink>
                  {mayWrite && a.saved && <AutomationSwitch storeSlug={store.slug} kind={kind} on={a.enabled} toggle={switchAutomationAction} />}
                </div>
              </div>
            </Card>
          );
        })}
        <Card
          title={wa.backInStock.title}
          compact
          aside={
            <Chip signal={stock.enabled ? "positive" : "neutral"} dot>
              {stock.enabled ? w.common.on : w.common.off}
            </Chip>
          }
        >
          <div className="flex flex-col gap-3">
            <p className="text-body text-ink">{wa.backInStock.does}</p>
            {!shop ? (
              <p className="text-body text-muted">{wa.needsShop}</p>
            ) : (
              <>
                <p className="text-body text-ink-2">
                  {stats.waiting === 0
                    ? wa.nobodyWaiting
                    : `${countWords(stats.waiting, wa.waiting, { n: n(stats.waiting) })}${stock.enabled ? "." : wa.waitingOff}`}
                </p>
                {stats.topWaiting.length > 0 && (
                  <ul className="flex flex-col gap-1 text-body text-ink-2">
                    {stats.topWaiting.map((p) => (
                      <li key={p.productId} className="flex justify-between gap-4">
                        <span className="truncate text-ink">{p.title || wa.aProduct}</span>
                        <span className="tabular-nums">{n(p.waiting)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {mayWrite && <AutomationSwitch storeSlug={store.slug} kind="back_in_stock" on={stock.enabled} toggle={switchAutomationAction} />}
              </>
            )}
          </div>
        </Card>
      </div>
      </AdminTextScope>
    </div>
  );
}
