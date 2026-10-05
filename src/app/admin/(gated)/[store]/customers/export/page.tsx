import type { Metadata } from "next";
import { Suspense } from "react";

import { DataPageHead, DataSkeleton, Notice, ProblemAlert } from "@/components/admin/data/page-parts";
import { ExportSection } from "@/components/admin/data/export-section";
import { CustomerExportForm } from "@/components/admin/data/export-forms";
import { NEVER_EMAILED_NOTE, NO_CONSENT_NOTE, PERSONAL_DATA_WARNING } from "@/lib/data-admin";
import { DIRECT_EXPORT_MAX_ROWS } from "@/lib/data-limits";
import { EXPORT_PROBLEM_TEXT, type ExportProblemCode } from "@/server/data-jobs";
import { requireOwnerRole } from "@/server/permissions";

export const metadata: Metadata = { title: "Export customers" };

type Props = PageProps<"/admin/[store]/customers/export">;

const first = (value: string | string[] | undefined): string | null => (typeof value === "string" ? value : null);

/**
 * The customer file (wave 2, D165, `docs/wave-2-data.md` 2.4, 2.5): one row for each customer, with the custom fields staff entered about them. The
 * owner's only. The consent column says `not_recorded`, because Kaizen has no record of a customer's consent to marketing yet, and the page says so.
 */
export default async function CustomerExportPage({ params, searchParams }: Props) {
  const { store } = await requireOwnerRole((await params).store);
  return (
    <div className="flex flex-col gap-6">
      <DataPageHead
        backHref={`/admin/${store.slug}/customers`}
        backLabel="Customers"
        title="Export customers"
        intro={`A spreadsheet of the store's customers: name, email, phone, address, company, customer group, language, when they joined, how many paid orders they have and whether their address unsubscribed. More than ${DIRECT_EXPORT_MAX_ROWS.toLocaleString("en-GB")} customers are made as a job.`}
      />
      <Notice title="Personal data" tone="warning">
        <p>{PERSONAL_DATA_WARNING}</p>
        <p className="mt-1">{NEVER_EMAILED_NOTE}</p>
      </Notice>
      <Notice title="Marketing consent">
        <p>{NO_CONSENT_NOTE}</p>
        <p className="mt-1">The column marketing_consent always says not_recorded. The column email_opt_out says true for an address that unsubscribed from the store&apos;s emails.</p>
      </Notice>
      <Suspense fallback={<DataSkeleton />}>
        <Body storeSlug={store.slug} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug, searchParams }: { storeSlug: string; searchParams: Props["searchParams"] }) {
  const member = await requireOwnerRole(storeSlug);
  const query = await searchParams;
  const code = first(query.problem);
  const problem = code && Object.hasOwn(EXPORT_PROBLEM_TEXT, code) ? EXPORT_PROBLEM_TEXT[code as ExportProblemCode] : code ? EXPORT_PROBLEM_TEXT.failed : null;
  return (
    <>
      <ProblemAlert text={problem} />
      <CustomerExportForm slug={member.store.slug} />
      <ExportSection member={member} kind="customer_export" jobId={first(query.job)} base={`/admin/${member.store.slug}/customers/export`} now={new Date()} />
    </>
  );
}
