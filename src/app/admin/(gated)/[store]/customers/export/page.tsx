import type { Metadata } from "next";
import { Suspense } from "react";

import { requireFeature } from "@/components/admin/feature-off";
import { DataPageHead, DataSkeleton, Notice, ProblemAlert } from "@/components/admin/data/page-parts";
import { ExportSection } from "@/components/admin/data/export-section";
import { CustomerExportForm } from "@/components/admin/data/export-forms";
import { DIRECT_EXPORT_MAX_ROWS } from "@/lib/data-limits";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { requireOwnerRole } from "@/server/permissions";
import { exportProblemWords } from "@/lib/data-admin";
import { EXPORT_KEEP_DAYS } from "@/lib/data-limits";

export const metadata: Metadata = { title: "Export customers" };

type Props = PageProps<"/admin/[store]/customers/export">;

const first = (value: string | string[] | undefined): string | null => (typeof value === "string" ? value : null);

/**
 * The customer file (wave 2, D165, `docs/wave-2-data.md` 2.4, 2.5): one row for each customer, with the custom fields staff entered about them. The
 * owner's only. The consent column is the address's place on the subscriber list (D295); the list itself, with its consent facts, is on Subscribers.
 */
export default async function CustomerExportPage({ params, searchParams }: Props) {
  const gated = await requireOwnerRole((await params).store);
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const lang = adminLangOf(gated.account.adminLocale);
  const words = adminText(lang, "customers").export;
  const notes = adminText(lang, "screens").exportNotes;
  return (
    <div className="flex flex-col gap-6">
      <DataPageHead
        backHref={`/admin/${store.slug}/customers`}
        backLabel={words.back}
        title={words.title}
        intro={fillWords(words.intro, { max: DIRECT_EXPORT_MAX_ROWS.toLocaleString(ADMIN_LANG_FACTS[lang].locale) })}
      />
      <Notice title={words.personal} tone="warning">
        <p>{fillWords(notes.personalData, { days: EXPORT_KEEP_DAYS })}</p>
        <p className="mt-1">{notes.neverEmailed}</p>
      </Notice>
      <Notice title={words.consent}>
        <p>{notes.noConsent}</p>
        <p className="mt-1">
          {words.columns}
        </p>
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
  const exportLang = adminLangOf(member.account.adminLocale);
  const problem = code ? exportProblemWords(code, adminText(exportLang, "screens").exportNotes, ADMIN_LANG_FACTS[exportLang].locale) : null;
  return (
    <>
      <ProblemAlert text={problem} />
      <CustomerExportForm slug={member.store.slug} words={adminText(adminLangOf(member.account.adminLocale), "bookings").exports} />
      <ExportSection member={member} kind="customer_export" jobId={first(query.job)} base={`/admin/${member.store.slug}/customers/export`} now={new Date()} />
    </>
  );
}
