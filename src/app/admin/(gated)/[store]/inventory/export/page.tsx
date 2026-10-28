import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { requireFeature } from "@/components/admin/feature-off";
import { DataSkeleton, Notice, ProblemAlert } from "@/components/admin/data/page-parts";
import { ExportSection } from "@/components/admin/data/export-section";
import { InventoryHead } from "@/components/admin/inventory/inventory-head";
import { StockExportForm } from "@/components/admin/inventory/stock-export-form";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { DIRECT_EXPORT_MAX_ROWS } from "@/lib/data-limits";
import { inventoryPaths } from "@/lib/inventory-admin";
import { EXPORT_PROBLEM_TEXT, type ExportProblemCode } from "@/server/data-jobs";
import { requirePermission } from "@/server/permissions";

export const metadata: Metadata = { title: "Export stock" };

type Props = PageProps<"/admin/[store]/inventory/export">;

const first = (value: string | string[] | undefined): string | null => (typeof value === "string" ? value : null);

/**
 * The stock file (wave 3, D172, `docs/wave-3-inventory.md` 2.4): one row for each variant that is shipped at each active location, downloaded at once
 * (a small store) or followed as a job. `products:read`. Count from it and bring it back with Import stock.
 */
export default async function StockExportPage({ params, searchParams }: Props) {
  const gated = await requirePermission((await params).store, "products:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const lang = adminLangOf(gated.account.adminLocale);
  const w = adminText(lang, "inventory").pages.export;
  return (
    <div className="flex flex-col gap-6">
      <InventoryHead
        slug={store.slug}
        active="export"
        title={w.title}
        intro={fillWords(w.intro, { max: DIRECT_EXPORT_MAX_ROWS.toLocaleString(ADMIN_LANG_FACTS[lang].locale) })}
        lang={lang}
      />
      <Suspense fallback={<DataSkeleton />}>
        <Body storeSlug={store.slug} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug, searchParams }: { storeSlug: string; searchParams: Props["searchParams"] }) {
  const member = await requirePermission(storeSlug, "products:read");
  const query = await searchParams;
  const code = first(query.problem);
  const problem = code && Object.hasOwn(EXPORT_PROBLEM_TEXT, code) ? EXPORT_PROBLEM_TEXT[code as ExportProblemCode] : code ? EXPORT_PROBLEM_TEXT.failed : null;
  const base = inventoryPaths(member.store.slug);
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "inventory").export;
  const a = w.about;
  return (
    <>
      <ProblemAlert text={problem} />
      <StockExportForm slug={member.store.slug} lang={lang} />
      <Notice title={w.aboutTitle}>
        <ul className="list-disc pl-5">
          <li>
            {a.holds} <code>on_hand</code> {a.onHand} <code>committed</code> {a.committed} <code>available</code> {a.available}
          </li>
          <li>
            {a.countStart} <code>on_hand</code> {a.countBack}{" "}
            <Link className="underline underline-offset-2" href={base.import}>
              {a.importLink}
            </Link>
            {a.conflictStart} <code>on_hand_was</code>
            {a.conflictEnd}
          </li>
          <li>{a.negative}</li>
        </ul>
      </Notice>
      <ExportSection member={member} kind="inventory_export" jobId={first(query.job)} base={base.export} now={new Date()} />
    </>
  );
}
