import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { DataSkeleton, Notice, ProblemAlert } from "@/components/admin/data/page-parts";
import { ExportSection } from "@/components/admin/data/export-section";
import { RedirectExportForm } from "@/components/admin/redirects/redirect-export-form";
import { RedirectsHead } from "@/components/admin/redirects/redirect-head";
import { DIRECT_EXPORT_MAX_ROWS } from "@/lib/data-limits";
import { redirectPaths } from "@/lib/redirect-admin";
import { EXPORT_PROBLEM_TEXT, type ExportProblemCode } from "@/server/data-jobs";
import { requirePermission } from "@/server/permissions";

export const metadata: Metadata = { title: "Export redirects" };

type Props = PageProps<"/admin/[store]/redirects/export">;

const first = (value: string | string[] | undefined): string | null => (typeof value === "string" ? value : null);

/**
 * The redirect file (wave 2, second run, D168, `docs/wave-2-redirects.md` 2.2.5): choose which redirects and the file's format, and download it at once (up
 * to 2,000 rows) or follow the job (more). Needs the right to read the website. The file has Shopify's two columns first (Redirect from, Redirect to), then the
 * kind, when it was made and how often it was used, and reads back into this store as it is.
 */
export default async function RedirectExportPage({ params, searchParams }: Props) {
  const { store } = await requirePermission((await params).store, "website:read");
  return (
    <div className="flex flex-col gap-6">
      <RedirectsHead
        slug={store.slug}
        active="export"
        title="Export redirects"
        intro={`One row for each redirect, with the address it goes from and to. A store with more than ${DIRECT_EXPORT_MAX_ROWS.toLocaleString("en-GB")} redirects gets the file as a job.`}
      />
      <Suspense fallback={<DataSkeleton />}>
        <Body storeSlug={store.slug} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug, searchParams }: { storeSlug: string; searchParams: Props["searchParams"] }) {
  const member = await requirePermission(storeSlug, "website:read");
  const query = await searchParams;
  const code = first(query.problem);
  const problem = code && Object.hasOwn(EXPORT_PROBLEM_TEXT, code) ? EXPORT_PROBLEM_TEXT[code as ExportProblemCode] : code ? EXPORT_PROBLEM_TEXT.failed : null;
  return (
    <>
      <ProblemAlert text={problem} />
      <RedirectExportForm slug={member.store.slug} />
      <Notice title="About the file">
        <ul className="list-disc pl-5">
          <li>
            The first two columns are <strong>Redirect from</strong> and <strong>Redirect to</strong>, as in a Shopify redirect file; <code>type</code>, <code>created</code>, <code>used</code> and <code>last_used</code> follow and are
            ignored by an import.
          </li>
          <li>Addresses are paths on the store without a country. A redirect applies in every country and language.</li>
          <li>
            Edit the file and bring it back with{" "}
            <Link className="underline underline-offset-2" href={redirectPaths(member.store.slug).import}>
              Import redirects
            </Link>
            .
          </li>
        </ul>
      </Notice>
      <ExportSection member={member} kind="redirect_export" jobId={first(query.job)} base={redirectPaths(member.store.slug).export} now={new Date()} />
    </>
  );
}
