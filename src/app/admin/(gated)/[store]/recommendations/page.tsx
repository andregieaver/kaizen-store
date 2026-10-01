import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { formatMoney } from "@/lib/money";
import { ENOUGH_VISITORS, percentOf, perVisitor, REPORT_PERIODS, reportDays } from "@/lib/recommendations";
import { requireMember } from "@/server/auth";
import { aiFor } from "@/server/ai";
import { recommendationReport } from "@/server/recommend-events";
import { getRecommendSettingsFresh, listRules, ruleProducts, tokensUsedThisMonth, type RuleKind } from "@/server/recommend-settings";

import { addRuleAction, removeRuleAction, saveRecommendSettingsAction } from "./actions";

export const metadata: Metadata = { title: "Recommendations" };

const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";
const KIND_WORDS: Record<RuleKind, string> = { goes_with: "goes with", never_with: "is never shown with", hide: "is never recommended" };

/**
 * Product recommendations (D139): switched on here, then placed with the page builder's content grids ("Recommend products
 * for each shopper"). Owners set whether the store's AI may re-rank, how much dearer than a product an upsell may be, the
 * share of visitors who see the plain ranking to compare against, and the AI's monthly token cap; owners and staff set which
 * products go together, never go together, or are never recommended; and see what shoppers did.
 */
export default async function RecommendationsPage({ params, searchParams }: PageProps<"/admin/[store]/recommendations">) {
  const { store, role } = await requireMember((await params).store);
  const days = reportDays(((await searchParams).days as string | undefined) ?? undefined);
  const [settings, used, report, rules, products, ai] = await Promise.all([
    getRecommendSettingsFresh(store.id),
    tokensUsedThisMonth(store.id),
    recommendationReport(store.id, days),
    listRules(store.id),
    ruleProducts(store.id),
    aiFor(store.id, { feature: "recommendations" }),
  ]);
  const base = `/admin/${store.slug}`;
  const locale = store.markets[0]?.locale ?? "nb-NO";
  const canEdit = role === "owner";
  const aiOn = Boolean(ai?.textModel);

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Recommendations</h1>
        <p className="text-sm text-muted">
          {settings.enabled ? "Recommendations are on." : "Recommendations are off."} Shoppers are shown products that suit what they are looking at,
          searched for, saved or put in the cart, never what they have already bought. Place them with a{" "}
          <Link href={`${base}/pages`} className="underline">page</Link>&apos;s content grid: choose &ldquo;Recommend products for each
          shopper&rdquo; for a product grid, in a product layout, an article, the All products page or any page.
        </p>
      </div>

      <section aria-labelledby="settings" className="flex max-w-2xl flex-col gap-3 rounded-lg border border-border bg-background p-5">
        <h2 id="settings" className="font-medium">Settings</h2>
        <ActionForm action={saveRecommendSettingsAction.bind(null, store.slug)} className="flex flex-col gap-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" name="enabled" defaultChecked={settings.enabled} disabled={!canEdit} className="size-4" />
            Recommend products on the store
          </label>
          <label className="flex items-start gap-2 text-sm font-medium">
            <input type="checkbox" name="ai" defaultChecked={settings.ai} disabled={!canEdit} className="mt-0.5 size-4" />
            <span>
              Let the store&apos;s AI re-rank the best candidates
              <span className="block text-xs font-normal text-muted">
                {aiOn
                  ? "The AI can only reorder products the store itself picked; it never adds a product, a price or a claim. Without it, or when it is late or over its cap, the plain ranking is shown."
                  : "The store has no text model set up under AI, so the plain ranking is used."}
              </span>
            </span>
          </label>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Upsell ceiling, percent
              <input name="upsellCeilingPercent" type="number" min={0} max={500} step={1} defaultValue={settings.upsellCeilingPercent} disabled={!canEdit} className={control} />
              <span className="text-xs font-normal text-muted">An upsell costs at most this much more than the product it is an upsell of.</span>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Plain ranking for, percent of visitors
              <input name="holdoutPercent" type="number" min={0} max={50} step={1} defaultValue={settings.holdoutPercent} disabled={!canEdit} className={control} />
              <span className="text-xs font-normal text-muted">These visitors never get the AI&apos;s order, so the two can be compared below.</span>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Monthly AI cap, thousands of tokens
              <input name="monthlyTokenCap" type="number" min={0} step={1} defaultValue={settings.monthlyTokenCap === null ? "" : settings.monthlyTokenCap / 1000} placeholder="No cap" disabled={!canEdit} className={control} />
              <span className="text-xs font-normal text-muted">
                Used this month: {Math.round(used / 1000).toLocaleString(locale)} thousand
                {settings.monthlyTokenCap === null ? "" : ` of ${(settings.monthlyTokenCap / 1000).toLocaleString(locale)} thousand`}. At the cap the plain ranking is shown. The store&apos;s own AI key is used when one is set.
              </span>
            </label>
          </div>
          {canEdit ? <SubmitButton>Save</SubmitButton> : <p className="text-sm text-muted">Only an owner can change these.</p>}
        </ActionForm>
      </section>

      <section aria-labelledby="rules" className="flex flex-col gap-3">
        <h2 id="rules" className="font-medium">Your rules</h2>
        <p className="text-sm text-muted">
          A pairing is offered with the product ahead of what the engine finds, as a complement. A product is never shown with another when you say so,
          and a hidden product is never recommended anywhere. Margins are not part of the catalogue, so the ceiling above is the upsell rule.
        </p>
        {rules.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-background p-6 text-center text-sm text-muted">No rules yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-background">
            {rules.map((rule) => (
              <li key={rule.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm">
                <span>
                  <strong className="font-medium">{rule.product.title}</strong> {KIND_WORDS[rule.kind]}
                  {rule.other ? <> <strong className="font-medium">{rule.other.title}</strong></> : null}
                </span>
                <ActionForm action={removeRuleAction.bind(null, store.slug)} className="flex items-center gap-2">
                  <input type="hidden" name="ruleId" value={rule.id} />
                  <SubmitButton>Remove</SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={addRuleAction.bind(null, store.slug)} className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-background p-4">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Product
            <select name="productId" required className={control} defaultValue="">
              <option value="" disabled>Choose a product</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Rule
            <select name="kind" className={control} defaultValue="goes_with">
              <option value="goes_with">goes with</option>
              <option value="never_with">is never shown with</option>
              <option value="hide">is never recommended</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Other product <span className="font-normal text-muted">(not for “never recommended”)</span>
            <select name="otherProductId" className={control} defaultValue="">
              <option value="">None</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </label>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" name="both" className="size-4" /> Both ways (for “goes with”)
          </label>
          <SubmitButton>Add rule</SubmitButton>
        </ActionForm>
      </section>

      <section aria-labelledby="results" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="results" className="font-medium">What shoppers did</h2>
          <nav aria-label="Period" className="flex gap-2 text-sm">
            {REPORT_PERIODS.map((d) => (
              <Link key={d} href={`${base}/recommendations?days=${d}`} aria-current={d === days ? "page" : undefined} className={`rounded-button border border-border px-3 py-1 ${d === days ? "bg-surface font-medium" : ""}`}>
                {d} days
              </Link>
            ))}
          </nav>
        </div>
        <p className="text-sm text-muted">
          Visitors are browser tabs that were shown a recommendation (a random id kept in the tab, never joined to a person). Revenue is what the
          recommended products&apos; lines came to, with VAT and after discounts, in orders of a cart they were added to from a recommendation, placed within 14 days; per currency, never added across them.
        </p>
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="px-4 py-2 font-medium">Ranking</th>
                <th scope="col" className="px-4 py-2 font-medium">Visitors</th>
                <th scope="col" className="px-4 py-2 font-medium">Shown</th>
                <th scope="col" className="px-4 py-2 font-medium">Clicked</th>
                <th scope="col" className="px-4 py-2 font-medium">Click-through</th>
                <th scope="col" className="px-4 py-2 font-medium">Added to cart</th>
                <th scope="col" className="px-4 py-2 font-medium">Add-to-cart rate</th>
                <th scope="col" className="px-4 py-2 font-medium">Revenue</th>
                <th scope="col" className="px-4 py-2 font-medium">Revenue per visitor</th>
              </tr>
            </thead>
            <tbody>
              {report.arms.map((arm) => {
                const ctr = percentOf(arm.clicks, arm.impressions);
                const addRate = percentOf(arm.adds, arm.clicks);
                return (
                  <tr key={arm.arm} className="border-b border-border align-top last:border-0">
                    <td className="px-4 py-2 font-medium">{arm.arm === "ai" ? "With the AI" : "Plain ranking"}</td>
                    <td className="px-4 py-2 tabular-nums">{arm.visitors}</td>
                    <td className="px-4 py-2 tabular-nums">{arm.impressions}</td>
                    <td className="px-4 py-2 tabular-nums">{arm.clicks}</td>
                    <td className="px-4 py-2 tabular-nums">{ctr === null ? "–" : `${ctr} %`}</td>
                    <td className="px-4 py-2 tabular-nums">{arm.adds}</td>
                    <td className="px-4 py-2 tabular-nums">{addRate === null ? "–" : `${addRate} %`}</td>
                    <td className="px-4 py-2 tabular-nums">
                      {arm.revenue.length === 0 ? "–" : arm.revenue.map((r) => <span key={r.currency} className="block">{formatMoney(r.minor, r.currency, locale)} <span className="text-muted">({r.orders} orders)</span></span>)}
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
        {report.arms.some((a) => a.visitors < ENOUGH_VISITORS) && (
          <p className="text-sm text-muted">With fewer than {ENOUGH_VISITORS} visitors in a ranking the two say little about each other yet; keep a share of visitors on the plain ranking and let it run.</p>
        )}
        {report.placements.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border bg-background">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="px-4 py-2 font-medium">Where</th>
                  <th scope="col" className="px-4 py-2 font-medium">Shown</th>
                  <th scope="col" className="px-4 py-2 font-medium">Clicked</th>
                  <th scope="col" className="px-4 py-2 font-medium">Added to cart</th>
                </tr>
              </thead>
              <tbody>
                {report.placements.map((p) => (
                  <tr key={p.placement} className="border-b border-border last:border-0">
                    <td className="px-4 py-2">{{ product: "Product pages", listing: "All products page", article: "Articles", page: "Other pages", other: "Working pages" }[p.placement]}</td>
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
          <div className="overflow-x-auto rounded-lg border border-border bg-background">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="px-4 py-2 font-medium">Most clicked products</th>
                  <th scope="col" className="px-4 py-2 font-medium">Shown</th>
                  <th scope="col" className="px-4 py-2 font-medium">Clicked</th>
                  <th scope="col" className="px-4 py-2 font-medium">Added to cart</th>
                </tr>
              </thead>
              <tbody>
                {report.topProducts.map((p) => (
                  <tr key={p.productId} className="border-b border-border last:border-0">
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
