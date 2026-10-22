import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AdminTextScope } from "@/components/admin/admin-text";
import { requireFeature } from "@/components/admin/feature-off";
import { ImportUpload } from "@/components/admin/data/import-flow";
import { DataPageHead, DataSkeleton, Notice } from "@/components/admin/data/page-parts";
import { card, hint, tableShell, td, th } from "@/components/admin/data/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { momentText } from "@/lib/data-admin";
import { IMPORT_FILE_KEEP_DAYS, IMPORT_MAX_PRODUCTS, IMPORT_MAX_ROWS } from "@/lib/data-limits";
import { ACTIVE_IMPORT_STATUSES } from "@/lib/data-job";
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
  const gated = await requirePermission((await params).store, "products:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const w = adminText(adminLangOf(gated.account.adminLocale), "products").importPage;
  return (
    <div className="flex flex-col gap-6">
      <DataPageHead backHref={`/admin/${store.slug}/products`} backLabel={w.back} title={w.title} intro={w.intro} />
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
  const lang = adminLangOf(member.account.adminLocale);
  const all = adminText(lang, "products");
  const w = all.importPage;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  return (
    <AdminTextScope texts={adminTexts(lang, ["products"])}>
      {open ? (
        <Notice title={w.alreadyOpen}>
          <p>
            {fillWords(w.openLine, { name: open.inputName ?? w.aFile, status: all.jobStatus[open.status].toLowerCase() })}{" "}
            <Link href={`${base}/${open.id}`} className="underline underline-offset-2">
              {w.continueIt}
            </Link>{" "}
            {w.orCancel}
          </p>
        </Notice>
      ) : (
        <ImportUpload slug={store.slug} start={startUploadAction.bind(null, store.slug)} register={registerUploadAction.bind(null, store.slug)} />
      )}
      <Notice title={w.what}>
        <ul className="list-disc pl-5">
          <li>{w.byHandle}</li>
          <li>{w.emptyCell}</li>
          <li>{w.prices}</li>
          <li>{all.importNotes.compareAt}</li>
          <li>{fillWords(w.pictures, { products: IMPORT_MAX_PRODUCTS.toLocaleString(locale), rows: IMPORT_MAX_ROWS.toLocaleString(locale) })}</li>
          <li>
            {w.notRead}{" "}
            <Link href={`/admin/${store.slug}/products/export`} className="underline underline-offset-2">
              {w.exportLink}
            </Link>
            .
          </li>
        </ul>
      </Notice>
      {jobs.length > 0 && (
        <section aria-labelledby="recent-imports" className="flex flex-col gap-2">
          <h2 id="recent-imports" className="text-title text-ink">
            {w.recent}
          </h2>
          <div className={tableShell}>
            <table className="w-full text-sm">
              <caption className="sr-only">{w.recentCaption}</caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className={th}>
                    {w.file}
                  </th>
                  <th scope="col" className={th}>
                    {w.started}
                  </th>
                  <th scope="col" className={th}>
                    {w.state}
                  </th>
                  <th scope="col" className={th}>
                    <span className="sr-only">{w.open}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-b border-line last:border-0">
                    <td className={`${td} break-all`}>{job.inputName ?? w.kindTitle}</td>
                    <td className={td}>{momentText(job.createdAt, store.timeZone, locale)}</td>
                    <td className={td}>{all.jobStatus[job.status]}</td>
                    <td className={`${td} text-right`}>
                      <Link href={`${base}/${job.id}`} className="underline underline-offset-2">
                        {w.open}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <p className={`${hint} ${card} !p-3`}>{fillWords(w.kept, { days: IMPORT_FILE_KEEP_DAYS })}</p>
    </AdminTextScope>
  );
}
