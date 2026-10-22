import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { requireFeature } from "@/components/admin/feature-off";
import { DataPageHead, DataSkeleton, Notice, ProblemAlert } from "@/components/admin/data/page-parts";
import { ExportSection } from "@/components/admin/data/export-section";
import { OrderExportForm } from "@/components/admin/data/export-forms";
import { MAIN_CURRENCY_NOTE, NEVER_EMAILED_NOTE, NOT_A_STATEMENT_NOTE, PERSONAL_DATA_WARNING, TEST_PAYMENT_NOTE } from "@/lib/data-admin";
import { DIRECT_EXPORT_MAX_ROWS } from "@/lib/data-limits";
import { EXPORT_PROBLEM_TEXT, type ExportProblemCode } from "@/server/data-jobs";
import { requireOwnerRole } from "@/server/permissions";
import { todayIn } from "@/lib/work-dates";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

export const metadata: Metadata = { title: "Export orders" };

type Props = PageProps<"/admin/[store]/orders/export">;

const first = (value: string | string[] | undefined): string | null => (typeof value === "string" ? value : null);

/**
 * The order file (wave 2, D165, `docs/wave-2-data.md` 2.3): the orders of a period, or of some order numbers, one row per order line, with the VAT split out
 * and the amounts in the order's currency and the store's. The owner's only, because the file can hold shoppers' personal data. *Export this order* on an
 * order's page lands here with its number filled in.
 */
export default async function OrderExportPage({ params, searchParams }: Props) {
  const gated = await requireOwnerRole((await params).store);
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const lang = adminLangOf(gated.account.adminLocale);
  const w = adminText(lang, "orders").export;
  return (
    <div className="flex flex-col gap-6">
      <DataPageHead
        backHref={`/admin/${store.slug}/orders`}
        backLabel={w.back}
        title={w.title}
        intro={fillWords(w.intro, { max: DIRECT_EXPORT_MAX_ROWS.toLocaleString(lang === "en" ? "en-GB" : ADMIN_LANG_FACTS[lang].locale) })}
      />
      <Notice title={w.personalData} tone="warning">
        <p>{PERSONAL_DATA_WARNING}</p>
        <p className="mt-1">{NEVER_EMAILED_NOTE}</p>
      </Notice>
      <Suspense fallback={<DataSkeleton />}>
        <Body storeSlug={store.slug} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug, searchParams }: { storeSlug: string; searchParams: Props["searchParams"] }) {
  const member = await requireOwnerRole(storeSlug);
  const w = adminText(adminLangOf(member.account.adminLocale), "orders").export;
  const query = await searchParams;
  const code = first(query.problem);
  const problem = code && Object.hasOwn(EXPORT_PROBLEM_TEXT, code) ? EXPORT_PROBLEM_TEXT[code as ExportProblemCode] : code ? EXPORT_PROBLEM_TEXT.failed : null;
  // A number or two from an order's own page; only a plain list is taken, shown in a field (never as markup).
  const numbers = (first(query.numbers) ?? "").slice(0, 4_000);
  return (
    <>
      <ProblemAlert text={problem} />
      <OrderExportForm slug={member.store.slug} defaultNumbers={numbers} today={todayIn(member.store.timeZone)} />
      <Notice title={w.amounts}>
        <p>{MAIN_CURRENCY_NOTE}</p>
        <p className="mt-1">{TEST_PAYMENT_NOTE}</p>
        <p className="mt-1">
          {NOT_A_STATEMENT_NOTE} {w.see} <Link className="underline underline-offset-2" href={`/admin/${member.store.slug}/invoices`}>{w.invoices}</Link> {w.and}{" "}
          <Link className="underline underline-offset-2" href={`/admin/${member.store.slug}/analytics/tax`}>{w.reports}</Link>.
        </p>
      </Notice>
      <ExportSection member={member} kind="order_export" jobId={first(query.job)} base={`/admin/${member.store.slug}/orders/export`} now={new Date()} />
    </>
  );
}
