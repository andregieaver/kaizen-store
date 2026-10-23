import type { Metadata } from "next";
import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { formatMoney } from "@/lib/money";
import { ENOUGH_VISITORS, percentOf, perVisitor, REPORT_PERIODS, reportDays } from "@/lib/recommendations";
import { memberCan, requirePermission } from "@/server/permissions";
import { aiFor } from "@/server/ai";
import { recommendationReport } from "@/server/recommend-events";
import { REPLAY_ORDERS, replayOnOrders } from "@/server/recommend-eval";
import { costWords } from "@/lib/ai-usage";
import { getRecommendSettingsFresh, listRules, ruleProducts, usedThisMonth, type RuleKind } from "@/server/recommend-settings";
import { Card, CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

import { addRuleAction, removeRuleAction, saveRecommendSettingsAction } from "./actions";

export const metadata: Metadata = { title: "Recommendations" };

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

/**
 * Product recommendations (D139): switched on here, then placed with the page builder's content grids ("Recommend products
 * for each shopper"). Owners set whether the store's AI may re-rank, how much dearer than a product an upsell may be, the
 * share of visitors who see the plain ranking to compare against, and the AI's monthly token cap; owners and staff set which
 * products go together, never go together, or are never recommended; and see what shoppers did.
 */
export default async function RecommendationsPage({ params, searchParams }: PageProps<"/admin/[store]/recommendations">) {
  const current = await requirePermission((await params).store, "marketing:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(current, "shop");
  if (shopOff) return shopOff;
  const { store } = current;
  const lang = adminLangOf(current.account.adminLocale);
  const w = adminText(lang, "bookings").recommendations;
  const KIND_WORDS: Record<RuleKind, string> = w.kinds;
  const query = await searchParams;
  const days = reportDays((query.days as string | undefined) ?? undefined);
  const replayMarket = store.markets[0];
  // The check against past orders is run when asked for: it replays recent orders against the engine.
  const replay = query.replay === "1" && replayMarket ? await replayOnOrders(store, replayMarket, REPLAY_ORDERS) : null;
  const [settings, used, report, rules, products, ai] = await Promise.all([
    getRecommendSettingsFresh(store.id),
    usedThisMonth(store.id),
    recommendationReport(store.id, days),
    listRules(store.id),
    ruleProducts(store.id),
    aiFor(store.id, { feature: "recommendations" }),
  ]);
  const base = `/admin/${store.slug}`;
  const locale = lang === "en" ? (store.markets[0]?.locale ?? "nb-NO") : ADMIN_LANG_FACTS[lang].locale;
  const canEdit = memberCan(current, "owner");
  const aiOn = Boolean(ai?.textModel);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={w.title}
        description={<>{settings.enabled ? w.on : w.off} {w.intro}{" "}<Link href={`${base}/pages`} className="underline">{w.pageLink}</Link>{w.introEnd}</>}
      />

      <Card title={w.settings} className="flex max-w-2xl flex-col gap-3" compact>
        <ActionForm action={saveRecommendSettingsAction.bind(null, store.slug)} className="flex flex-col gap-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" name="enabled" defaultChecked={settings.enabled} disabled={!canEdit} className="size-4" />
            {w.enabled}
          </label>
          <label className="flex items-start gap-2 text-sm font-medium">
            <input type="checkbox" name="ai" defaultChecked={settings.ai} disabled={!canEdit} className="mt-0.5 size-4" />
            <span>
              {w.ai}
              <span className="block text-xs font-normal text-muted">
                {aiOn
                  ? w.aiOn
                  : w.aiOff}
              </span>
            </span>
          </label>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {w.ceiling}
              <input name="upsellCeilingPercent" type="number" min={0} max={500} step={1} defaultValue={settings.upsellCeilingPercent} disabled={!canEdit} className={control} />
              <span className="text-xs font-normal text-muted">{w.ceilingHint}</span>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              {w.holdout}
              <input name="holdoutPercent" type="number" min={0} max={50} step={1} defaultValue={settings.holdoutPercent} disabled={!canEdit} className={control} />
              <span className="text-xs font-normal text-muted">{w.holdoutHint}</span>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              {w.cap}
              <input name="monthlyTokenCap" type="number" min={0} step={1} defaultValue={settings.monthlyTokenCap === null ? "" : settings.monthlyTokenCap / 1000} placeholder={w.noCap} disabled={!canEdit} className={control} />
              <span className="text-xs font-normal text-muted">
                {fillWords(settings.monthlyTokenCap === null ? w.used : w.usedOf, {
                  used: Math.round(used.tokens / 1000).toLocaleString(locale),
                  cap: settings.monthlyTokenCap === null ? "" : (settings.monthlyTokenCap / 1000).toLocaleString(locale),
                  cost: costWords({ costMicros: used.costMicros, unpricedRequests: used.unpriced ? 1 : 0 }),
                })}
              </span>
            </label>
          </div>
          {canEdit ? <SubmitButton>{w.save}</SubmitButton> : <p className="text-sm text-muted">{w.ownersOnly}</p>}
        </ActionForm>
      </Card>

      <section aria-labelledby="rules" className="flex flex-col gap-3">
        <h2 id="rules" className="text-title text-ink">{w.rules}</h2>
        <p className="text-sm text-muted">{w.rulesHint}</p>
        {rules.length === 0 ? (
          <p className={`p-6 text-center text-sm text-muted ${CARD_CLASS}`}>{w.noRules}</p>
        ) : (
          <ul className={`divide-y divide-line ${CARD_CLASS}`}>
            {rules.map((rule) => (
              <li key={rule.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm">
                <span>
                  <strong className="font-medium">{rule.product.title}</strong> {KIND_WORDS[rule.kind]}
                  {rule.other ? <> <strong className="font-medium">{rule.other.title}</strong></> : null}
                </span>
                <ActionForm action={removeRuleAction.bind(null, store.slug)} className="flex items-center gap-2">
                  <input type="hidden" name="ruleId" value={rule.id} />
                  <SubmitButton>{w.remove}</SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={addRuleAction.bind(null, store.slug)} className={`flex flex-wrap items-end gap-3 p-4 ${CARD_CLASS}`}>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.product}
            <select name="productId" required className={control} defaultValue="">
              <option value="" disabled>{w.choose}</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.rule}
            <select name="kind" className={control} defaultValue="goes_with">
              <option value="goes_with">{w.kinds.goes_with}</option>
              <option value="never_with">{w.kinds.never_with}</option>
              <option value="hide">{w.kinds.hide}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.other} <span className="font-normal text-muted">{w.otherHint}</span>
            <select name="otherProductId" className={control} defaultValue="">
              <option value="">{w.none}</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </label>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" name="both" className="size-4" /> {w.both}
          </label>
          <SubmitButton>{w.addRule}</SubmitButton>
        </ActionForm>
      </section>

      <section aria-labelledby="replay" className="flex flex-col gap-3">
        <h2 id="replay" className="text-title text-ink">{w.replay}</h2>
        <p className="text-sm text-muted">{fillWords(w.replayHint, { n: REPLAY_ORDERS })}</p>
        {replay ? (
          replay.evaluated === 0 ? (
            <p className={`p-6 text-center text-sm text-muted ${CARD_CLASS}`}>
              {fillWords(w.replayNone, { found: replay.considered, off: replay.skipped.notOnSaleNow })}
            </p>
          ) : (
            <div className={`overflow-x-auto ${CARD_CLASS}`}>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th scope="col" className="px-4 py-2 font-medium">{w.shownAll}</th>
                    <th scope="col" className="px-4 py-2 font-medium">{w.first}</th>
                    <th scope="col" className="px-4 py-2 font-medium">{w.first4}</th>
                    <th scope="col" className="px-4 py-2 font-medium">{w.first12}</th>
                    <th scope="col" className="px-4 py-2 font-medium">{w.mrr}</th>
                  </tr>
                </thead>
                <tbody>
                  {([[w.engine, replay.engine], [w.bestSellers, replay.bestSellers]] as const).map(([name, r]) => (
                    <tr key={name} className="border-b border-line last:border-0">
                      <td className="px-4 py-2 font-medium">{name}</td>
                      <td className="px-4 py-2 tabular-nums">{r.hit[1]} %</td>
                      <td className="px-4 py-2 tabular-nums">{r.hit[4]} %</td>
                      <td className="px-4 py-2 tabular-nums">{r.hit[12]} %</td>
                      <td className="px-4 py-2 tabular-nums">{r.mrr} %</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="border-t border-line px-4 py-2 text-xs text-muted">
                {fillWords(w.checked, { n: replay.evaluated, off: replay.skipped.notOnSaleNow })}
                {replay.liftAt4 !== null && ` ${fillWords(w.lift, { n: replay.liftAt4 })}`}
                {replay.evaluated < 30 && ` ${w.few}`}
              </p>
            </div>
          )
        ) : (
          <p>
            <Link href={`${base}/recommendations?replay=1&days=${days}`} className="underline">{w.run}</Link>
          </p>
        )}
      </section>

      <section aria-labelledby="results" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="results" className="text-title text-ink">{w.results}</h2>
          <nav aria-label={w.period} className="flex gap-2 text-sm">
            {REPORT_PERIODS.map((d) => (
              <Link key={d} href={`${base}/recommendations?days=${d}`} aria-current={d === days ? "page" : undefined} className={`rounded-button border border-line px-3 py-1 ${d === days ? "bg-sunken font-medium" : ""}`}>
                {fillWords(w.days, { n: d })}
              </Link>
            ))}
          </nav>
        </div>
        <p className="text-sm text-muted">{w.resultsHint}</p>
        <div className={`overflow-x-auto ${CARD_CLASS}`}>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="px-4 py-2 font-medium">{w.ranking}</th>
                <th scope="col" className="px-4 py-2 font-medium">{w.visitors}</th>
                <th scope="col" className="px-4 py-2 font-medium">{w.shown}</th>
                <th scope="col" className="px-4 py-2 font-medium">{w.clicked}</th>
                <th scope="col" className="px-4 py-2 font-medium">{w.ctr}</th>
                <th scope="col" className="px-4 py-2 font-medium">{w.added}</th>
                <th scope="col" className="px-4 py-2 font-medium">{w.addRate}</th>
                <th scope="col" className="px-4 py-2 font-medium">{w.revenue}</th>
                <th scope="col" className="px-4 py-2 font-medium">{w.perVisitor}</th>
              </tr>
            </thead>
            <tbody>
              {report.arms.map((arm) => {
                const ctr = percentOf(arm.clicks, arm.impressions);
                const addRate = percentOf(arm.adds, arm.clicks);
                return (
                  <tr key={arm.arm} className="border-b border-line align-top last:border-0">
                    <td className="px-4 py-2 font-medium">{arm.arm === "ai" ? w.withAi : w.plain}</td>
                    <td className="px-4 py-2 tabular-nums">{arm.visitors}</td>
                    <td className="px-4 py-2 tabular-nums">{arm.impressions}</td>
                    <td className="px-4 py-2 tabular-nums">{arm.clicks}</td>
                    <td className="px-4 py-2 tabular-nums">{ctr === null ? "–" : `${ctr} %`}</td>
                    <td className="px-4 py-2 tabular-nums">{arm.adds}</td>
                    <td className="px-4 py-2 tabular-nums">{addRate === null ? "–" : `${addRate} %`}</td>
                    <td className="px-4 py-2 tabular-nums">
                      {arm.revenue.length === 0 ? "–" : arm.revenue.map((r) => <span key={r.currency} className="block">{formatMoney(r.minor, r.currency, locale)} <span className="text-muted">({fillWords(w.orders, { n: r.orders })})</span></span>)}
                    </td>
                    <td className="px-4 py-2 tabular-nums">
                      {arm.revenue.length === 0 ? "–" : arm.revenue.map((r) => <span key={r.currency} className="block">{perVisitor(r.minor, arm.visitors) === null ? "–" : formatMoney(perVisitor(r.minor, arm.visitors)!, r.currency, locale)}</span>)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="rounded-panel border border-line bg-card p-4 text-sm" role="status">
          <strong className="font-medium">{w.against} </strong>
          {report.comparison.words}
          {report.comparison.clicked.p !== null && (
            <span className="block text-xs text-muted">
              {fillWords(w.tabsClicked, { a: report.comparison.clicked.a ?? "", b: report.comparison.clicked.b ?? "", p: report.comparison.clicked.p })}
              {report.comparison.added.p !== null && ` ${fillWords(w.tabsAdded, { a: report.comparison.added.a ?? "", b: report.comparison.added.b ?? "", p: report.comparison.added.p })}`}
              {" "}{fillWords(w.clear, { n: ENOUGH_VISITORS })}
            </span>
          )}
        </p>
        {report.placements.length > 0 && (
          <div className={`overflow-x-auto ${CARD_CLASS}`}>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="px-4 py-2 font-medium">{w.where}</th>
                  <th scope="col" className="px-4 py-2 font-medium">{w.shown}</th>
                  <th scope="col" className="px-4 py-2 font-medium">{w.clicked}</th>
                  <th scope="col" className="px-4 py-2 font-medium">{w.added}</th>
                </tr>
              </thead>
              <tbody>
                {report.placements.map((p) => (
                  <tr key={p.placement} className="border-b border-line last:border-0">
                    <td className="px-4 py-2">{w.places[p.placement]}</td>
                    <td className="px-4 py-2 tabular-nums">{p.impressions}</td>
                    <td className="px-4 py-2 tabular-nums">{p.clicks}</td>
                    <td className="px-4 py-2 tabular-nums">{p.adds}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {report.topProducts.length > 0 && (
          <div className={`overflow-x-auto ${CARD_CLASS}`}>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="px-4 py-2 font-medium">{w.mostClicked}</th>
                  <th scope="col" className="px-4 py-2 font-medium">{w.shown}</th>
                  <th scope="col" className="px-4 py-2 font-medium">{w.clicked}</th>
                  <th scope="col" className="px-4 py-2 font-medium">{w.added}</th>
                </tr>
              </thead>
              <tbody>
                {report.topProducts.map((p) => (
                  <tr key={p.productId} className="border-b border-line last:border-0">
                    <td className="px-4 py-2">{p.title}</td>
                    <td className="px-4 py-2 tabular-nums">{p.impressions}</td>
                    <td className="px-4 py-2 tabular-nums">{p.clicks}</td>
                    <td className="px-4 py-2 tabular-nums">{p.adds}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
