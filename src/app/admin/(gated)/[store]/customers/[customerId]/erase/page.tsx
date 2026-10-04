import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { EraseForm } from "@/components/admin/privacy/erase-form";
import { ErasurePlanView } from "@/components/admin/privacy/plan-view";
import { EraseSkeleton } from "@/components/admin/privacy/skeletons";
import { alertText } from "@/components/admin/privacy/styles";
import { findCustomer } from "@/server/customer-admin";
import { memberCan, requirePermission } from "@/server/permissions";
import { erasurePreview } from "@/server/privacy-admin";

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
  const { store } = await requireWriter(storeSlug);
  const ref = await findCustomer(store.id, customerId);
  if (!ref) notFound();
  const requested = first((await searchParams).request);
  const request = requested && z.uuid().safeParse(requested).success ? requested : "none";
  const preview = await erasurePreview(store.id, ref.key);
  if (!preview) notFound();
  const locale = store.markets[0]?.locale ?? "en-GB";
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/admin/${store.slug}/customers/${ref.key}`} className="text-sm underline">
          Customer
        </Link>
        <h1 className="text-2xl font-semibold">Erase personal data</h1>
        <p className="max-w-2xl text-sm text-muted">
          Read what happens first. Sales the bookkeeping law keeps are kept without the person&apos;s name, address and email until the period ends, then made anonymous. Nothing is deleted from the accounts.
        </p>
        <p className={`mt-2 text-sm font-medium ${alertText}`}>Erasing cannot be undone.</p>
      </div>
      <ErasurePlanView plan={preview.plan} locale={locale} />
      <EraseForm email={preview.email} action={eraseCustomerAction.bind(null, store.slug, ref.key, request)} />
    </div>
  );
}
