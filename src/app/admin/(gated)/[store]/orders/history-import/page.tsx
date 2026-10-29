import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AdminTextScope } from "@/components/admin/admin-text";
import { CustomerUpload } from "@/components/admin/customer-import-flow";
import { DataSkeleton, Notice } from "@/components/admin/data/page-parts";
import { card, hint, tableShell, td, th } from "@/components/admin/data/ui";
import { requireFeature } from "@/components/admin/feature-off";
import { PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { ACTIVE_IMPORT_STATUSES } from "@/lib/data-job";
import { IMPORT_FILE_KEEP_DAYS } from "@/lib/data-limits";
import { momentIn } from "@/lib/inventory-words";
import { HISTORY_ORDERS_MAX } from "@/lib/order-history";
import { listJobs } from "@/server/data-jobs";
import { requireOwnerRole } from "@/server/permissions";

import { registerHistoryUploadAction, startHistoryUploadAction } from "./actions";

export const metadata: Metadata = { title: "Import order history" };

type Props = PageProps<"/admin/[store]/orders/history-import">;

/**
 * The order history import (wave 11 unit E, D384): choose Shopify's order export, see what it would do order by order, then import it as
 * history (copied orders, `C-…`): never paid, refunded, sent, emailed, invoiced or counted in sales. The owner's alone, as the order file is.
 * One import is open per store at a time.
 */
export default async function OrderHistoryImportPage({ params }: Props) {
  const member = await requireOwnerRole((await params).store);
  const shopOff = requireFeature(member, "shop");
  if (shopOff) return shopOff;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "orders").historyImport;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: `/admin/${member.store.slug}/orders`, label: w.back }} title={w.title} description={w.intro} />
      <Suspense fallback={<DataSkeleton />}>
        <Body storeSlug={member.store.slug} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug }: { storeSlug: string }) {
  const member = await requireOwnerRole(storeSlug);
  const { store } = member;
  const jobs = await listJobs(member, "order_history_import", 10);
  const open = jobs.find((j) => (ACTIVE_IMPORT_STATUSES as readonly string[]).includes(j.status)) ?? null;
  const base = `/admin/${store.slug}/orders/history-import`;
  const lang = adminLangOf(member.account.adminLocale);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const shared = adminText(lang, "inventory").import;
  const w = adminText(lang, "orders").historyImport;
  return (
    <>
      {open ? (
        <Notice title={shared.openTitle}>
          <p>
            {fillWords(w.openText, { file: open.inputName ?? shared.aFile, status: shared.jobStatus[open.status].toLowerCase() })}{" "}
            <Link href={`${base}/${open.id}`} className="underline underline-offset-2">
              {shared.continue}
            </Link>{" "}
            {shared.orCancel}
          </p>
        </Notice>
      ) : (
        <AdminTextScope texts={adminTexts(lang, ["inventory", "customers"])}>
          <CustomerUpload
            slug={store.slug}
            rowsMax={HISTORY_ORDERS_MAX}
            jobBase="/orders/history-import"
            words={w}
            start={startHistoryUploadAction.bind(null, store.slug)}
            register={registerHistoryUploadAction.bind(null, store.slug)}
          />
        </AdminTextScope>
      )}
      <Notice title={w.rulesTitle}>
        <ul className="list-disc pl-5">
          <li>{w.rules.history}</li>
          <li>{w.rules.amounts}</li>
          <li>{w.rules.people}</li>
          <li>{w.rules.again}</li>
        </ul>
      </Notice>
      {jobs.length > 0 && (
        <section aria-labelledby="recent-history-imports" className="flex flex-col gap-2">
          <h2 id="recent-history-imports" className="text-title text-ink">
            {shared.recent}
          </h2>
          <div className={tableShell}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className={th}>
                    {shared.file}
                  </th>
                  <th scope="col" className={th}>
                    {shared.started}
                  </th>
                  <th scope="col" className={th}>
                    {shared.state}
                  </th>
                  <th scope="col" className={th}>
                    <span className="sr-only">{shared.open}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-b border-line last:border-0">
                    <td className={`${td} break-all`}>{job.inputName ?? w.job.title}</td>
                    <td className={td}>{momentIn(job.createdAt, store.timeZone, locale)}</td>
                    <td className={td}>{shared.jobStatus[job.status]}</td>
                    <td className={`${td} text-right`}>
                      <Link href={`${base}/${job.id}`} className="underline underline-offset-2">
                        {shared.open}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <p className={`${hint} ${card} !p-3`}>{fillWords(shared.kept, { days: IMPORT_FILE_KEEP_DAYS })}</p>
    </>
  );
}
