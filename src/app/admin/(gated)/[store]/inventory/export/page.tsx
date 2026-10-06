import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { DataSkeleton, Notice, ProblemAlert } from "@/components/admin/data/page-parts";
import { ExportSection } from "@/components/admin/data/export-section";
import { InventoryHead } from "@/components/admin/inventory/inventory-head";
import { StockExportForm } from "@/components/admin/inventory/stock-export-form";
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
  const { store } = await requirePermission((await params).store, "products:read");
  return (
    <div className="flex flex-col gap-6">
      <InventoryHead
        slug={store.slug}
        active="export"
        title="Export stock"
        intro={`One row for each variant at each active location, with on hand, committed, available, the policy at zero stock and the low-stock level. A store with more than ${DIRECT_EXPORT_MAX_ROWS.toLocaleString("en-GB")} rows gets the file as a job.`}
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
  return (
    <>
      <ProblemAlert text={problem} />
      <StockExportForm slug={member.store.slug} />
      <Notice title="About the file">
        <ul className="list-disc pl-5">
          <li>
            The file holds a row for each variant that is shipped at each active location, written as the figures stood when the file was made: <code>on_hand</code> is the figure to change, <code>committed</code> is what checkouts in progress hold
            and <code>available</code> is the difference.
          </li>
          <li>
            To count from it, change <code>on_hand</code> and bring the file back with{" "}
            <Link className="underline underline-offset-2" href={base.import}>
              Import stock
            </Link>
            . To make a row that is out of date become a conflict instead of undoing a sale, first copy the <code>on_hand</code> column into a new column named <code>on_hand_was</code>: the import then leaves a row alone when the stock has changed since
            the file was made.
          </li>
          <li>A figure below zero is exported as it is (it is stock that was sold on backorder and is still owed); an import never writes a figure below zero.</li>
        </ul>
      </Notice>
      <ExportSection member={member} kind="inventory_export" jobId={first(query.job)} base={base.export} now={new Date()} />
    </>
  );
}
