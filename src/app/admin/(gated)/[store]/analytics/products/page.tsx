import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { AnalyticsHeader } from "@/components/admin/analytics/analytics-header";
import { ExportScope } from "@/components/admin/analytics/export-scope";
import { parseProductsSort, ProductsView } from "@/components/admin/analytics/products-view";
import { queryText } from "@/lib/analytics-export";
import { periodQuery } from "@/lib/analytics-period";
import { analyticsContext } from "@/server/analytics-context";
import { productsReport } from "@/server/analytics-products-data";

export const metadata: Metadata = { title: "Product analytics" };

/**
 * What each product brought in, what is left of it and how concentrated the sales are (D152). Every figure is worked out in code from
 * paid orders; the page reads the period and the sort from the address, loads the report and hands it to `ProductsView`.
 */
export default async function AnalyticsProductsPage({ params, searchParams }: PageProps<"/admin/[store]/analytics/products">) {
  const query = await searchParams;
  const ctx = await analyticsContext((await params).store, query);
  // Sales analytics are part of the online shop (D178 step 5): hidden while it is off; traffic stays.
  const shopOff = requireFeature(ctx, "shop");
  if (shopOff) return shopOff;
  const { store } = ctx;
  const { period, compare } = ctx.params;
  const against = compare.previous ?? compare.lastYear;

  const [report] = await Promise.all([productsReport(store, period, against)]);

  const { sort, explicit } = parseProductsSort(query);
  const showAll = query.limit === "all";
  // What a link on the page keeps: the period and comparison, and the sort and "show all" when they were asked for.
  const keep = Object.fromEntries(new URLSearchParams(periodQuery({ period, compare })));
  const preserve: Record<string, string> = { ...(explicit ? { sort: sort.key, dir: sort.dir } : {}), ...(showAll ? { limit: "all" } : {}) };

  return (
    <ExportScope base={ctx.base} query={queryText(query)} owner={ctx.owner} canExport={ctx.canExport}>
      <div className="flex flex-col gap-8">
        <AnalyticsHeader
          ctx={ctx}
          path="/analytics/products"
          title="Products"
          description="What sells, what earns and what is sent back. The best sellers come first, then every product with its revenue, margin, refunds and share of your sales."
          preserve={preserve}
        />
        <ProductsView base={ctx.base} locale={store.markets[0]?.locale ?? "en"} report={report} compareMode={compare.mode} sort={sort} showAll={showAll} keep={keep} />
      </div>
    </ExportScope>
  );
}
