import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { AdminTextScope } from "@/components/admin/admin-text";
import { EraseForm } from "@/components/admin/privacy/erase-form";
import { ErasurePlanView } from "@/components/admin/privacy/plan-view";
import { EraseSkeleton } from "@/components/admin/privacy/skeletons";
import { alertText } from "@/components/admin/privacy/styles";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { findCustomer } from "@/server/customer-admin";
import { memberCan, requirePermission } from "@/server/permissions";
import { erasurePreview } from "@/server/privacy-admin";
import { PageHeader } from "@/components/admin/ui";

import { eraseCustomerAction } from "./actions";

export const metadata: Metadata = { title: "Erase personal data" };

/** The page is read-only, so it asks the area's read key; the preview is for those who may change customers, and a 404 to the rest. */
async function requireWriter(slug: string) {
  const member = await requirePermission(slug, "customers:read");
  if (!memberCan(member, "customers:write")) notFound();
  return member;
}

type Props = PageProps<"/admin/[store]/customers/[customerId]/erase">;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Erasing a customer's personal data, in two steps (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.3 item 3): the preview says what happens to
 * every kind of data (read-only, by the same code as the run) and the confirmation is the customer's own email typed again. Changing
 * customers is the permission; the page is a 404 without it, so the preview (which is a list of counts) is not shown to those who cannot act.
 */
export default async function EraseCustomerPage({ params, searchParams }: Props) {
  const { store: slug, customerId } = await params;
  const { store } = await requireWriter(slug);
  if (!z.uuid().safeParse(customerId).success) notFound();
  return (
    <Suspense fallback={<EraseSkeleton />}>
      <Preview storeSlug={store.slug} customerId={customerId} searchParams={searchParams} />
    </Suspense>
  );
}

async function Preview({ storeSlug, customerId, searchParams }: { storeSlug: string; customerId: string; searchParams: Props["searchParams"] }) {
  const { store, account } = await requireWriter(storeSlug);
  const ref = await findCustomer(store.id, customerId);
  if (!ref) notFound();
  const requested = first((await searchParams).request);
  const request = requested && z.uuid().safeParse(requested).success ? requested : "none";
  const preview = await erasurePreview(store.id, ref.key);
  if (!preview) notFound();
  const locale = store.markets[0]?.locale ?? "en-GB";
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "privacy");
  return (
    <AdminTextScope texts={adminTexts(lang, ["privacy"])}>
      <div className="flex flex-col gap-6">
        <div>
          <PageHeader
            back={{ href: `/admin/${store.slug}/customers/${ref.key}`, label: w.erase.customer }}
            title={w.common.eraseData}
            description={<>{w.erase.description}</>}
          />
          <p className={`mt-2 text-sm font-medium ${alertText}`}>{w.erase.cannotUndo}</p>
        </div>
        <ErasurePlanView plan={preview.plan} locale={locale} words={w} dateLocale={ADMIN_LANG_FACTS[lang].locale} />
        <EraseForm email={preview.email} action={eraseCustomerAction.bind(null, store.slug, ref.key, request)} />
      </div>
    </AdminTextScope>
  );
}
