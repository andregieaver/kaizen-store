import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { DataSkeleton, Notice, ProblemAlert } from "@/components/admin/data/page-parts";
import { ExportSection } from "@/components/admin/data/export-section";
import { RedirectExportForm } from "@/components/admin/redirects/redirect-export-form";
import { RedirectsHead } from "@/components/admin/redirects/redirect-head";
import { DIRECT_EXPORT_MAX_ROWS } from "@/lib/data-limits";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
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
  const { store, account } = await requirePermission((await params).store, "website:read");
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "redirects");
  return (
    <div className="flex flex-col gap-6">
      <RedirectsHead
        slug={store.slug}
        active="export"
        title={w.export.title}
        intro={fillWords(w.export.intro, { n: DIRECT_EXPORT_MAX_ROWS.toLocaleString(ADMIN_LANG_FACTS[lang].locale) })}
        words={w}
      />
      <Suspense fallback={<DataSkeleton />}>
        <Body storeSlug={store.slug} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug, searchParams }: { storeSlug: string; searchParams: Props["searchParams"] }) {
  const member = await requirePermission(storeSlug, "website:read");
  const w = adminText(adminLangOf(member.account.adminLocale), "redirects").export;
  const query = await searchParams;
  const code = first(query.problem);
  const problem = code && Object.hasOwn(EXPORT_PROBLEM_TEXT, code) ? EXPORT_PROBLEM_TEXT[code as ExportProblemCode] : code ? EXPORT_PROBLEM_TEXT.failed : null;
  return (
    <>
      <ProblemAlert text={problem} />
      <RedirectExportForm slug={member.store.slug} words={adminText(adminLangOf(member.account.adminLocale), "redirects")} exportWords={adminText(adminLangOf(member.account.adminLocale), "bookings").exports} />
      <Notice title={w.aboutTitle}>
        <ul className="list-disc pl-5">
          <li>
            {w.about1a} <strong>Redirect from</strong> {w.about1b} <strong>Redirect to</strong>
            {w.about1c} <code>type</code>, <code>created</code>, <code>used</code> {w.about1b} <code>last_used</code> {w.about1d}
          </li>
          <li>{w.about2}</li>
          <li>
            {w.about3a}{" "}
            <Link className="underline underline-offset-2" href={redirectPaths(member.store.slug).import}>
              {w.importLink}
            </Link>
            .
          </li>
        </ul>
      </Notice>
      <ExportSection member={member} kind="redirect_export" jobId={first(query.job)} base={redirectPaths(member.store.slug).export} now={new Date()} />
    </>
  );
}
