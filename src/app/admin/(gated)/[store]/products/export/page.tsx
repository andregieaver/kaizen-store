import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { DataPageHead, DataSkeleton, Notice, ProblemAlert } from "@/components/admin/data/page-parts";
import { ExportSection } from "@/components/admin/data/export-section";
import { ProductExportForm } from "@/components/admin/data/export-forms";
import { NOT_IN_PRODUCT_FILE } from "@/lib/data-admin";
import { DIRECT_EXPORT_MAX_ROWS } from "@/lib/data-limits";
import { EXPORT_PROBLEM_TEXT, type ExportProblemCode } from "@/server/data-jobs";
import { requirePermission } from "@/server/permissions";
import { listTerms } from "@/server/taxonomy";

export const metadata: Metadata = { title: "Export products" };

type Props = PageProps<"/admin/[store]/products/export">;

const first = (value: string | string[] | undefined): string | null => (typeof value === "string" ? value : null);

/**
 * The product file (wave 2, D165, `docs/wave-2-data.md` 2.1): choose which products and the file's format, and download it at once (a small store) or
 * follow the job (a large one). Needs the right to read products. The file is in Kaizen's layout, which an import reads back as it is.
 */
export default async function ProductExportPage({ params, searchParams }: Props) {
  const { store } = await requirePermission((await params).store, "products:read");
  return (
    <div className="flex flex-col gap-6">
      <DataPageHead
        backHref={`/admin/${store.slug}/products`}
        backLabel="Products"
        title="Export products"
        intro={`One row for each variant of a product, with its texts in every language, options, prices for each country, stock, cost, product safety details, categories, tags and pictures. A store with more than ${DIRECT_EXPORT_MAX_ROWS.toLocaleString("en-GB")} rows gets the file as a job.`}
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
  const terms = await listTerms({ storeId: member.store.id, contentType: "product" });
  return (
    <>
      <ProblemAlert text={problem} />
      <ProductExportForm slug={member.store.slug} terms={terms.map((t) => ({ id: t.id, name: t.name, kind: t.kind }))} />
      <Notice title="What the file does not carry">
        <ul className="list-disc pl-5">
          {NOT_IN_PRODUCT_FILE.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-2">An import leaves these as they are. The file reads back into Kaizen as it is: <Link className="underline underline-offset-2" href={`/admin/${member.store.slug}/products/import`}>import products</Link>.</p>
      </Notice>
      <ExportSection member={member} kind="product_export" jobId={first(query.job)} base={`/admin/${member.store.slug}/products/export`} now={new Date()} />
    </>
  );
}
