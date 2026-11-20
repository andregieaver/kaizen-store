import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AdminTextScope } from "@/components/admin/admin-text";
import { requireFeature } from "@/components/admin/feature-off";
import { DataSkeleton, Notice } from "@/components/admin/data/page-parts";
import { card, hint, tableShell, td, th } from "@/components/admin/data/ui";
import { InventoryHead } from "@/components/admin/inventory/inventory-head";
import { PhoneRow } from "@/components/admin/phone-row";
import { StockUpload } from "@/components/admin/inventory/stock-import-flow";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { ACTIVE_IMPORT_STATUSES } from "@/lib/data-job";
import { IMPORT_FILE_KEEP_DAYS } from "@/lib/data-limits";
import { INVENTORY_FILE_ROWS_MAX, STOCK_MAX } from "@/lib/inventory";
import { inventoryPaths } from "@/lib/inventory-admin";
import { momentIn } from "@/lib/inventory-words";
import { areaTexts } from "@/lib/admin-area";
import { INVENTORY_WORDS } from "@/lib/admin-words/inventory";
import { INVENTORY_IMPORT_WORDS } from "@/lib/admin-words/inventory-import";
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
  const lang = adminLangOf(gated.account.adminLocale);
  const all = INVENTORY_WORDS[lang];
  const w = all.pages.import;
  return (
    <div className="flex flex-col gap-6">
      <InventoryHead
        slug={store.slug}
        active="import"
        title={w.title}
        intro={<><span className="sm:hidden">{all.phone.importLead}</span><span className="max-sm:hidden">{w.intro}</span></>}
        lang={lang}
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
  const lang = adminLangOf(member.account.adminLocale);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const t = INVENTORY_WORDS[lang];
  const w = t.import;
  const r = w.rules;
  const pw = t.phone;
  return (
    <>
      {open ? (
        <Notice title={w.openTitle}>
          <p>
            {fillWords(w.openText, { file: open.inputName ?? w.aFile, status: w.jobStatus[open.status].toLowerCase() })}{" "}
            <Link href={`${base}/${open.id}`} className="underline underline-offset-2">
              {w.continue}
            </Link>{" "}
            {w.orCancel}
          </p>
        </Notice>
      ) : (
        <AdminTextScope texts={areaTexts(lang, { inventory: INVENTORY_WORDS, inventoryImport: INVENTORY_IMPORT_WORDS })}>
          <StockUpload slug={store.slug} start={startStockUploadAction.bind(null, store.slug)} register={registerStockUploadAction.bind(null, store.slug)} />
        </AdminTextScope>
      )}
      {/* Round 46 (D750): on a phone how the file is read is a row; the rules open under it. From 640 px the card is as before. */}
      <div className="max-sm:overflow-hidden max-sm:rounded-panel">
      <PhoneRow flat last title={pw.rules} sub={pw.rulesSub} change={pw.open} done={pw.close}>
      <Notice title={w.rulesTitle}>
        <ul className="list-disc pl-5">
          <li>{r.find}</li>
          <li>
            <code>{"on_hand"}</code> {fillWords(r.onHand, { max: STOCK_MAX.toLocaleString(locale) })} <code>{"on_hand_was"}</code> {r.onHandWas}
          </li>
          <li>
            <code>{"reason"}</code> {r.reason} <code>{"stock_policy"}</code> {r.policy} <code>{"backorder_days"}</code> {r.days}{" "}
            <code>{"low_stock_threshold"}</code> {r.sameFile}
          </li>
          <li>{fillWords(r.problem, { max: INVENTORY_FILE_ROWS_MAX.toLocaleString(locale) })}</li>
          <li>
            {r.never}{" "}
            <Link href={inventoryPaths(store.slug).export} className="underline underline-offset-2">
              {r.exportLink}
            </Link>
            .
          </li>
        </ul>
      </Notice>
      </PhoneRow>
      </div>
      {jobs.length > 0 && (
        <section aria-labelledby="recent-stock-imports" className="flex flex-col gap-2">
          <h2 id="recent-stock-imports" className="text-title text-ink">
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
                    <td className={td}>{momentIn(job.createdAt, store.timeZone, locale)}</td>
                    <td className={td}>{w.jobStatus[job.status]}</td>
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
      <p className={`${hint} px-0.5 sm:hidden`}>{fillWords(pw.importKept, { days: IMPORT_FILE_KEEP_DAYS })}</p>
      <p className={`${hint} ${card} !p-3 max-sm:hidden`}>{fillWords(w.kept, { days: IMPORT_FILE_KEEP_DAYS })}</p>
    </>
  );
}
