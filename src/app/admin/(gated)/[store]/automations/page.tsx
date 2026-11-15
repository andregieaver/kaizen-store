import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { AutomationSwitch } from "@/components/admin/automation-editor";
import { ButtonLink, Card, Chip, PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { LIFECYCLE_KINDS } from "@/lib/automations";
import { automationDays } from "@/lib/marketing-words";
import { formatMoney } from "@/lib/money";
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
  const startKind = LIFECYCLE_KINDS.find((kind) => !automations[kind].enabled) ?? null;
  const shop = featureOn(store, "shop");
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "marketing");
  const wa = w.automations;
  const n = (v: number) => v.toLocaleString(ADMIN_LANG_FACTS[lang].locale);
  const onNames = [
    ...LIFECYCLE_KINDS.filter((kind) => automations[kind].enabled).map((kind) => wa.kinds[kind].title),
    ...(stock.enabled ? [wa.backInStock.title] : []),
  ];
  const joinNames = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} ${wa.and} ${names.at(-1)}`);
  const money = (minor: Record<string, number>) =>
    Object.entries(minor)
      .map(([currency, amount]) => formatMoney(amount, currency, ADMIN_LANG_FACTS[lang].locale))
      .join(" + ");

  return (
    <div className="flex flex-col gap-6">
      {/* Round 13 (D639): which are on in a sentence; the first one still off is the one to start with, the only green button. */}
      <PageHeader
        title={wa.title}
        meta={[
          <span key="lead">
            <span className="text-ink">
              {onNames.length === 0
                ? wa.leadNone
                : fillWords(wa.leadSome, { names: `${joinNames(onNames)} ${onNames.length === 1 ? wa.isOne : wa.areMany}` })}
            </span>
            {onNames.length === 0 ? fillWords(wa.leadNoneRest, { first: wa.kinds[LIFECYCLE_KINDS[0]].title }) : wa.leadSomeRest}
          </span>,
        ]}
      />
      <AdminTextScope texts={adminTexts(lang, ["marketing"])}>
      <div className="grid gap-4 lg:grid-cols-2">
        {LIFECYCLE_KINDS.map((kind) => {
          const a = automations[kind];
          const words = wa.kinds[kind];
          const after = stats.revenue[kind];
          const first = kind === startKind;
          return (
            <Card
              key={kind}
              title={words.title}
              compact
              className={first ? "ring-[1.5px] ring-brand" : undefined}
              aside={
                first ? (
                  <Chip signal="positive">{wa.startHere}</Chip>
                ) : (
                  <Chip signal={a.enabled ? "positive" : "neutral"} dot>
                    {a.enabled ? w.common.on : w.common.off}
                  </Chip>
                )
              }
            >
              <div className="flex flex-col gap-3">
                <p className="text-body text-ink">{words.does}</p>
                <p className="text-body text-ink-2">
                  {automationDays(kind, a.delayDays ?? 0, wa)} {a.enabled ? fillWords(wa.sentLately, { n: n(stats.sent[kind]) }) : ""}{" "}
                  {after.orders > 0 ? countWords(after.orders, wa.ordersAfter, { n: n(after.orders), amount: money(after.minor) }) : ""}
                </p>
                <div className="flex flex-wrap items-start gap-2">
                  <ButtonLink href={`${base}/${kind}`} kind={a.saved ? "quiet" : first ? "main" : "secondary"}>
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
