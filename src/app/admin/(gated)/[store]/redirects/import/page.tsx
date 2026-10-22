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
import { AdminTextScope } from "@/components/admin/admin-text";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { adminText, adminTexts } from "@/lib/admin-text";
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
  const { store, account } = await requirePermission((await params).store, "website:read");
  const w = adminText(adminLangOf(account.adminLocale), "redirects");
  return (
    <div className="flex flex-col gap-6">
      <RedirectsHead slug={store.slug} active="import" title={w.import.title} intro={w.import.intro} words={w} />
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
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "redirects");
  const i = w.import;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const jobs = await listJobs(member, "redirect_import", 10);
  const open = jobs.find((j) => (ACTIVE_IMPORT_STATUSES as readonly string[]).includes(j.status)) ?? null;
  const base = `${redirectPaths(store.slug).import}`;
  return (
    <AdminTextScope texts={adminTexts(lang, ["redirects"])}>
      {open ? (
        <Notice title={i.openTitle}>
          <p>
            {open.inputName ?? i.aFile} ({STATUS_WORDS[open.status].toLowerCase()}). {i.openText}{" "}
            <Link href={`${base}/${open.id}`} className="underline underline-offset-2">
              {i.continueIt}
            </Link>{" "}
            {i.orCancel}
          </p>
        </Notice>
      ) : (
        <RedirectUpload slug={store.slug} start={startRedirectUploadAction.bind(null, store.slug)} register={registerRedirectUploadAction.bind(null, store.slug)} />
      )}
      <Notice title={i.doesTitle}>
        <ul className="list-disc pl-5">
          <li>
            {i.does1a} <code>/collections/shoes</code> {i.does1b} <code>/category/shoes</code>
            {i.does1c}
          </li>
          <li>{i.does2}</li>
          <li>{i.does3}</li>
          <li>{i.does4}</li>
          <li>
            {fillWords(i.does5, { lines: REDIRECT_IMPORT_MAX_ROWS.toLocaleString(locale), max: REDIRECTS_MAX.toLocaleString(locale) })}{" "}
            <Link href={redirectPaths(store.slug).export} className="underline underline-offset-2">
              {i.exportLink}
            </Link>
            .
          </li>
        </ul>
      </Notice>
      {jobs.length > 0 && (
        <section aria-labelledby="recent-redirect-imports" className="flex flex-col gap-2">
          <h2 id="recent-redirect-imports" className="text-title text-ink">
            {i.recent}
          </h2>
          <div className={tableShell}>
            <table className="w-full text-sm">
              <caption className="sr-only">{i.recentCaption}</caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className={th}>
                    {i.file}
                  </th>
                  <th scope="col" className={th}>
                    {i.started}
                  </th>
                  <th scope="col" className={th}>
                    {i.state}
                  </th>
                  <th scope="col" className={th}>
                    <span className="sr-only">{i.open}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-b border-line last:border-0">
                    <td className={`${td} break-all`}>{job.inputName ?? KIND_TITLES.redirect_import}</td>
                    <td className={td}>{momentText(job.createdAt, store.timeZone, locale)}</td>
                    <td className={td}>{STATUS_WORDS[job.status]}</td>
                    <td className={`${td} text-right`}>
                      <Link href={`${base}/${job.id}`} className="underline underline-offset-2">
                        {i.open}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <p className={`${hint} ${card} !p-3`}>{fillWords(i.kept, { days: IMPORT_FILE_KEEP_DAYS })}</p>
    </AdminTextScope>
  );
}
