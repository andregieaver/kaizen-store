import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { requireFeature } from "@/components/admin/feature-off";
import { DataSkeleton, Notice } from "@/components/admin/data/page-parts";
import { card, hint, tableShell, td, th } from "@/components/admin/data/ui";
import { InventoryHead } from "@/components/admin/inventory/inventory-head";
import { StockUpload } from "@/components/admin/inventory/stock-import-flow";
import { KIND_TITLES, momentText } from "@/lib/data-admin";
import { ACTIVE_IMPORT_STATUSES, STATUS_WORDS } from "@/lib/data-job";
import { IMPORT_FILE_KEEP_DAYS } from "@/lib/data-limits";
import { INVENTORY_FILE_ROWS_MAX, STOCK_MAX } from "@/lib/inventory";
import { inventoryPaths } from "@/lib/inventory-admin";
import { listJobs } from "@/server/data-jobs";
import { memberCan, requirePermission } from "@/server/permissions";

import { registerStockUploadAction, startStockUploadAction } from "./actions";

export const metadata: Metadata = { title: "Import stock" };

type Props = PageProps<"/admin/[store]/inventory/import">;

/**
 * The stock import (wave 3, D172, `docs/wave-3-inventory.md` 2.4): choose a CSV file of counted stock, see what it would do row by row, then import it.
 * Needs the right to change products. One import is open per store at a time; an import that was started is continued from its own page. An import never
 * creates a variant or a location and never writes a figure below zero.
 */
export default async function StockImportPage({ params }: Props) {
  const gated = await requirePermission((await params).store, "products:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  return (
    <div className="flex flex-col gap-6">
      <InventoryHead
        slug={store.slug}
        active="import"
        title="Import stock"
        intro="Set stock from a counted CSV file. You see what the import would do, row by row, before anything is changed, and every change is kept in the history with the file's reference."
      />
      <Suspense fallback={<DataSkeleton />}>
        <Body storeSlug={store.slug} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug }: { storeSlug: string }) {
  const member = await requirePermission(storeSlug, "products:read");
  if (!memberCan(member, "products:write")) notFound();
  const { store } = member;
  const jobs = await listJobs(member, "inventory_import", 10);
  const open = jobs.find((j) => (ACTIVE_IMPORT_STATUSES as readonly string[]).includes(j.status)) ?? null;
  const base = inventoryPaths(store.slug).import;
  return (
    <>
      {open ? (
        <Notice title="An import is already open">
          <p>
            {open.inputName ?? "A file"} ({STATUS_WORDS[open.status].toLowerCase()}). Only one stock import is open at a time.{" "}
            <Link href={`${base}/${open.id}`} className="underline underline-offset-2">
              Continue it
            </Link>{" "}
            or cancel it there to start another.
          </p>
        </Notice>
      ) : (
        <StockUpload slug={store.slug} start={startStockUploadAction.bind(null, store.slug)} register={registerStockUploadAction.bind(null, store.slug)} />
      )}
      <Notice title="What an import does and does not do">
        <ul className="list-disc pl-5">
          <li>A variant is found by its SKU and a location by its name. The location column may be left empty only when the store has one active location.</li>
          <li>
            <code>on_hand</code> is the counted figure, a whole number from 0 to {STOCK_MAX.toLocaleString("en-GB")}: it is set as it is. With a column <code>on_hand_was</code> (the figure the file was made from) a row whose stock has changed since is left alone
            and listed, so a sale made while you counted is never undone.
          </li>
          <li>
            <code>reason</code> is one of received, correction, count, damaged, lost or promotion; without it a row is a count. <code>stock_policy</code> (deny or continue), <code>backorder_days</code> (1 to 90, required with continue) and{" "}
            <code>low_stock_threshold</code> may be set in the same file.
          </li>
          <li>An unknown SKU, a SKU that is not goods that are shipped, an unknown location, the same SKU and location twice, or a figure that is not allowed makes that row a problem: it is skipped and the others go on. At most {INVENTORY_FILE_ROWS_MAX.toLocaleString("en-GB")} rows in a file.</li>
          <li>
            An import never creates a variant, a location or a product, never deletes anything and never writes a figure below zero. Start from an export to see the layout:{" "}
            <Link href={inventoryPaths(store.slug).export} className="underline underline-offset-2">
              Export stock
            </Link>
            .
          </li>
        </ul>
      </Notice>
      {jobs.length > 0 && (
        <section aria-labelledby="recent-stock-imports" className="flex flex-col gap-2">
          <h2 id="recent-stock-imports" className="text-base font-semibold">
            Recent imports
          </h2>
          <div className={tableShell}>
            <table className="w-full text-sm">
              <caption className="sr-only">Recent stock imports of this store</caption>
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className={th}>
                    File
                  </th>
                  <th scope="col" className={th}>
                    Started
                  </th>
                  <th scope="col" className={th}>
                    State
                  </th>
                  <th scope="col" className={th}>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-b border-border last:border-0">
                    <td className={`${td} break-all`}>{job.inputName ?? KIND_TITLES.inventory_import}</td>
                    <td className={td}>{momentText(job.createdAt, store.timeZone)}</td>
                    <td className={td}>{STATUS_WORDS[job.status]}</td>
                    <td className={`${td} text-right`}>
                      <Link href={`${base}/${job.id}`} className="underline underline-offset-2">
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <p className={`${hint} ${card} !p-3`}>Your file is kept privately for {IMPORT_FILE_KEEP_DAYS} days after the import ends, then deleted. The history of the stock it changed stays.</p>
    </>
  );
}
