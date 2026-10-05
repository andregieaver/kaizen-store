import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ImportUpload } from "@/components/admin/data/import-flow";
import { DataPageHead, DataSkeleton, Notice } from "@/components/admin/data/page-parts";
import { card, hint, tableShell, td, th } from "@/components/admin/data/ui";
import { COMPARE_AT_NOTE, KIND_TITLES, momentText } from "@/lib/data-admin";
import { IMPORT_FILE_KEEP_DAYS, IMPORT_MAX_PRODUCTS, IMPORT_MAX_ROWS } from "@/lib/data-limits";
import { ACTIVE_IMPORT_STATUSES, STATUS_WORDS } from "@/lib/data-job";
import { listJobs } from "@/server/data-jobs";
import { memberCan, requirePermission } from "@/server/permissions";

import { registerUploadAction, startUploadAction } from "./actions";

export const metadata: Metadata = { title: "Import products" };

type Props = PageProps<"/admin/[store]/products/import">;

/**
 * The product import (wave 2, D165, `docs/wave-2-data.md` 2.2): choose a Kaizen or Shopify product file, see what it would do, then import it. Needs the
 * right to change products. One import is open per store at a time; an import that was started is continued from its own page.
 */
export default async function ProductImportPage({ params }: Props) {
  const { store } = await requirePermission((await params).store, "products:read");
  return (
    <div className="flex flex-col gap-6">
      <DataPageHead
        backHref={`/admin/${store.slug}/products`}
        backLabel="Products"
        title="Import products"
        intro="Bring products in from a CSV file: the file Kaizen exports, or a Shopify product file. You see what the import would do, row by row, before anything is changed. An import never deletes a product and never changes an address."
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
  const jobs = await listJobs(member, "product_import", 10);
  const open = jobs.find((j) => (ACTIVE_IMPORT_STATUSES as readonly string[]).includes(j.status)) ?? null;
  const base = `/admin/${store.slug}/products/import`;
  return (
    <>
      {open ? (
        <Notice title="An import is already open">
          <p>
            {open.inputName ?? "A file"} ({STATUS_WORDS[open.status].toLowerCase()}). Only one import is open at a time.{" "}
            <Link href={`${base}/${open.id}`} className="underline underline-offset-2">
              Continue it
            </Link>{" "}
            or cancel it there to start another.
          </p>
        </Notice>
      ) : (
        <ImportUpload slug={store.slug} start={startUploadAction.bind(null, store.slug)} register={registerUploadAction.bind(null, store.slug)} />
      )}
      <Notice title="What an import does and does not do">
        <ul className="list-disc pl-5">
          <li>A product is found by its handle and a variant by its SKU. A SKU that belongs to another product is an error, never a move.</li>
          <li>A column in the file with an empty cell clears that value. A column that is not in the file is left alone.</li>
          <li>Prices are read in each country&apos;s own currency and never converted. A price that is the same as today&apos;s is not written.</li>
          <li>{COMPARE_AT_NOTE}</li>
          <li>Pictures at other websites are fetched and kept in your media library. At most {IMPORT_MAX_PRODUCTS.toLocaleString("en-GB")} products and {IMPORT_MAX_ROWS.toLocaleString("en-GB")} rows in one file.</li>
          <li>
            Subscriptions, download files, booking settings and custom fields that are not plain values are neither read nor changed. Start from an export to see the layout:{" "}
            <Link href={`/admin/${store.slug}/products/export`} className="underline underline-offset-2">
              Export products
            </Link>
            .
          </li>
        </ul>
      </Notice>
      {jobs.length > 0 && (
        <section aria-labelledby="recent-imports" className="flex flex-col gap-2">
          <h2 id="recent-imports" className="text-base font-semibold">
            Recent imports
          </h2>
          <div className={tableShell}>
            <table className="w-full text-sm">
              <caption className="sr-only">Recent product imports of this store</caption>
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
                    <td className={`${td} break-all`}>{job.inputName ?? KIND_TITLES.product_import}</td>
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
      <p className={`${hint} ${card} !p-3`}>Your file is kept privately for {IMPORT_FILE_KEEP_DAYS} days after the import ends, then deleted. Pictures fetched from other websites stay in your media library.</p>
    </>
  );
}
