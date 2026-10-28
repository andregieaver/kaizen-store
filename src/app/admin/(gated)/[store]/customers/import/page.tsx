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
import { CUSTOMER_FILE_ROWS_MAX } from "@/lib/customer-import";
import { ACTIVE_IMPORT_STATUSES } from "@/lib/data-job";
import { IMPORT_FILE_KEEP_DAYS } from "@/lib/data-limits";
import { momentIn } from "@/lib/inventory-words";
import { listJobs } from "@/server/data-jobs";
import { requireOwnerRole } from "@/server/permissions";

import { registerCustomerUploadAction, startCustomerUploadAction } from "../actions";

export const metadata: Metadata = { title: "Import customers" };

type Props = PageProps<"/admin/[store]/customers/import">;

/**
 * The customer import (wave 10 unit C, D366): choose a CSV file of customers (Kaizena Flow's own customer file or Shopify's), see what it
 * would do row by row, then import it. The owner's alone, as the customer file is (it holds personal data). One import is open per store at
 * a time. An import never subscribes anyone, never sets a password and never deletes anyone.
 */
export default async function CustomerImportPage({ params }: Props) {
  const member = await requireOwnerRole((await params).store);
  const shopOff = requireFeature(member, "shop");
  if (shopOff) return shopOff;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "customers").staff.import;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: `/admin/${member.store.slug}/customers`, label: adminText(lang, "customers").staff.newPage.back }} title={w.title} description={w.intro} />
      <Suspense fallback={<DataSkeleton />}>
        <Body storeSlug={member.store.slug} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug }: { storeSlug: string }) {
  const member = await requireOwnerRole(storeSlug);
  const { store } = member;
  const jobs = await listJobs(member, "customer_import", 10);
  const open = jobs.find((j) => (ACTIVE_IMPORT_STATUSES as readonly string[]).includes(j.status)) ?? null;
  const base = `/admin/${store.slug}/customers/import`;
  const lang = adminLangOf(member.account.adminLocale);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const shared = adminText(lang, "inventory").import;
  const w = adminText(lang, "customers").staff.import;
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
          <CustomerUpload slug={store.slug} rowsMax={CUSTOMER_FILE_ROWS_MAX} start={startCustomerUploadAction.bind(null, store.slug)} register={registerCustomerUploadAction.bind(null, store.slug)} />
        </AdminTextScope>
      )}
      <Notice title={w.rulesTitle}>
        <ul className="list-disc pl-5">
          <li>{w.rules.match}</li>
          <li>{w.rules.keep}</li>
          <li>{w.rules.tags}</li>
          <li>{w.rules.never}</li>
        </ul>
      </Notice>
      {jobs.length > 0 && (
        <section aria-labelledby="recent-customer-imports" className="flex flex-col gap-2">
          <h2 id="recent-customer-imports" className="text-title text-ink">
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
