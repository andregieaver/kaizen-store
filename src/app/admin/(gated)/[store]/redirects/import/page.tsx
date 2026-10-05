import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DataSkeleton, Notice } from "@/components/admin/data/page-parts";
import { card, hint, tableShell, td, th } from "@/components/admin/data/ui";
import { RedirectUpload } from "@/components/admin/redirects/redirect-import-flow";
import { RedirectsHead } from "@/components/admin/redirects/redirect-head";
import { KIND_TITLES, momentText } from "@/lib/data-admin";
import { ACTIVE_IMPORT_STATUSES, STATUS_WORDS } from "@/lib/data-job";
import { IMPORT_FILE_KEEP_DAYS, REDIRECTS_MAX, REDIRECT_IMPORT_MAX_ROWS } from "@/lib/data-limits";
import { redirectPaths } from "@/lib/redirect-admin";
import { listJobs } from "@/server/data-jobs";
import { memberCan, requirePermission } from "@/server/permissions";

import { registerRedirectUploadAction, startRedirectUploadAction } from "./actions";

export const metadata: Metadata = { title: "Import redirects" };

type Props = PageProps<"/admin/[store]/redirects/import">;

/**
 * The redirect import (wave 2, second run, D168, `docs/wave-2-redirects.md` 2.2.4): choose a CSV file with the columns Redirect from and Redirect to, see what it
 * would do line by line, then import it. Needs the right to change the website. One import is open per store at a time; an import that was started is
 * continued from its own page. An import never deletes a redirect.
 */
export default async function RedirectImportPage({ params }: Props) {
  const { store } = await requirePermission((await params).store, "website:read");
  return (
    <div className="flex flex-col gap-6">
      <RedirectsHead
        slug={store.slug}
        active="import"
        title="Import redirects"
        intro="Bring redirects in from a CSV file: the file this store's export makes, or a Shopify redirect file. You see what the import would do, line by line, before anything is changed."
      />
      <Suspense fallback={<DataSkeleton />}>
        <Body storeSlug={store.slug} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug }: { storeSlug: string }) {
  const member = await requirePermission(storeSlug, "website:read");
  if (!memberCan(member, "website:write")) notFound();
  const { store } = member;
  const jobs = await listJobs(member, "redirect_import", 10);
  const open = jobs.find((j) => (ACTIVE_IMPORT_STATUSES as readonly string[]).includes(j.status)) ?? null;
  const base = `${redirectPaths(store.slug).import}`;
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
        <RedirectUpload slug={store.slug} start={startRedirectUploadAction.bind(null, store.slug)} register={registerRedirectUploadAction.bind(null, store.slug)} />
      )}
      <Notice title="What an import does and does not do">
        <ul className="list-disc pl-5">
          <li>
            Each line is a path on the store, such as <code>/collections/shoes</code> to <code>/category/shoes</code>, without a country: a redirect applies in every country and language. A full address on this store is read as its path.
          </li>
          <li>An address that is a live page, product, category, tag or article is refused: a redirect only works from an address that does not exist. A draft or archived product&apos;s address is free.</li>
          <li>A redirect to another website is refused, a loop is refused, and a chain is saved as its final destination.</li>
          <li>An address that already has a redirect of its own is replaced or kept, as you choose. A redirect Kaizen made itself is replaced. No redirect is ever deleted by an import.</li>
          <li>
            At most {REDIRECT_IMPORT_MAX_ROWS.toLocaleString("en-GB")} lines in a file and {REDIRECTS_MAX.toLocaleString("en-GB")} redirects of your own in a store. Start from an export to see the layout:{" "}
            <Link href={redirectPaths(store.slug).export} className="underline underline-offset-2">
              Export redirects
            </Link>
            .
          </li>
        </ul>
      </Notice>
      {jobs.length > 0 && (
        <section aria-labelledby="recent-redirect-imports" className="flex flex-col gap-2">
          <h2 id="recent-redirect-imports" className="text-base font-semibold">
            Recent imports
          </h2>
          <div className={tableShell}>
            <table className="w-full text-sm">
              <caption className="sr-only">Recent redirect imports of this store</caption>
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
                    <td className={`${td} break-all`}>{job.inputName ?? KIND_TITLES.redirect_import}</td>
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
      <p className={`${hint} ${card} !p-3`}>Your file is kept privately for {IMPORT_FILE_KEEP_DAYS} days after the import ends, then deleted.</p>
    </>
  );
}
