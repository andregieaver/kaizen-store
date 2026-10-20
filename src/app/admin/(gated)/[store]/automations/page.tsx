import type { Metadata } from "next";

import { AutomationSwitch } from "@/components/admin/automation-editor";
import { ButtonLink, Card, Chip, PageHeader } from "@/components/admin/ui";
import { AUTOMATION_WORDS, LIFECYCLE_KINDS } from "@/lib/automations";
import { featureOn } from "@/lib/store-features";
import { automationStats, getAutomations } from "@/server/automations";
import { memberCan, requirePermission } from "@/server/permissions";

import { switchAutomationAction } from "./actions";

export const metadata: Metadata = { title: "Email automations" };

const n = (v: number) => v.toLocaleString("en-GB");

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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Email automations"
        description="Emails that go by themselves to the people who want your emails, once each. Switching one on never writes to people about what happened before."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {LIFECYCLE_KINDS.map((kind) => {
          const a = automations[kind];
          const words = AUTOMATION_WORDS[kind];
          return (
            <Card
              key={kind}
              title={words.title}
              compact
              aside={
                <Chip signal={a.enabled ? "positive" : "neutral"} dot>
                  {a.enabled ? "On" : "Off"}
                </Chip>
              }
            >
              <div className="flex flex-col gap-3">
                <p className="text-body text-ink">{words.does}</p>
                <p className="text-body text-ink-2">
                  {words.days?.(a.delayDays ?? 0)} {a.enabled ? `Sent ${n(stats.sent[kind])} in the last 30 days.` : ""}
                </p>
                <div className="flex flex-wrap items-start gap-2">
                  <ButtonLink href={`${base}/${kind}`} kind={a.saved ? "quiet" : "main"}>
                    {a.saved ? "Edit" : "Set it up"}
                  </ButtonLink>
                  {mayWrite && a.saved && <AutomationSwitch storeSlug={store.slug} kind={kind} on={a.enabled} toggle={switchAutomationAction} />}
                </div>
              </div>
            </Card>
          );
        })}
        <Card
          title={AUTOMATION_WORDS.back_in_stock.title}
          compact
          aside={
            <Chip signal={stock.enabled ? "positive" : "neutral"} dot>
              {stock.enabled ? "On" : "Off"}
            </Chip>
          }
        >
          <div className="flex flex-col gap-3">
            <p className="text-body text-ink">{AUTOMATION_WORDS.back_in_stock.does}</p>
            {!shop ? (
              <p className="text-body text-muted">It needs the online shop, which is switched off.</p>
            ) : (
              <>
                <p className="text-body text-ink-2">
                  {stats.waiting === 0
                    ? "Nobody is waiting."
                    : `${n(stats.waiting)} ${stats.waiting === 1 ? "request waits" : "requests wait"}${stock.enabled ? "." : ", and would not hear while this is off."}`}
                </p>
                {stats.topWaiting.length > 0 && (
                  <ul className="flex flex-col gap-1 text-body text-ink-2">
                    {stats.topWaiting.map((p) => (
                      <li key={p.productId} className="flex justify-between gap-4">
                        <span className="truncate text-ink">{p.title || "A product"}</span>
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
    </div>
  );
}
