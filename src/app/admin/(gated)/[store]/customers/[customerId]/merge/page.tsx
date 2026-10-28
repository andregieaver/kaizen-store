import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { AdminTextScope } from "@/components/admin/admin-text";
import { CustomerMerge } from "@/components/admin/customer-merge";
import { requireFeature } from "@/components/admin/feature-off";
import { Card, PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { findCustomer } from "@/server/customer-admin";
import { memberCan, requirePermission } from "@/server/permissions";

import { mergeCustomersAction, previewMergeAction } from "../actions";

export const metadata: Metadata = { title: "Merge customers" };

/**
 * Merging another customer into this one (wave 10 unit C, D366): this customer is kept, the other one's orders, subscriptions, lists,
 * addresses, tags, notes and credits move here and its account is deleted. Only accounts are merged: a guest is given an account first.
 */
export default async function MergeCustomerPage({ params }: PageProps<"/admin/[store]/customers/[customerId]/merge">) {
  const { store: slug, customerId } = await params;
  const member = await requirePermission(slug, "customers:read");
  if (!memberCan(member, "customers:write")) notFound();
  const shopOff = requireFeature(member, "shop");
  if (shopOff) return shopOff;
  const { store } = member;
  if (!z.uuid().safeParse(customerId).success) notFound();
  const ref = await findCustomer(store.id, customerId);
  if (!ref) notFound();
  if (ref.key !== customerId) redirect(`/admin/${store.slug}/customers/${ref.key}/merge`);
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "customers").staff.merge;
  const back = `/admin/${store.slug}/customers/${ref.key}`;
  return (
    <AdminTextScope texts={adminTexts(lang, ["customers"])}>
      <div className="flex flex-col gap-6">
        <PageHeader back={{ href: back, label: w.back }} title={w.title} description={w.description} meta={[`${w.keep}: ${ref.email}`]} />
        <Card>
          {ref.customerId ? (
            <CustomerMerge
              name={ref.email}
              preview={previewMergeAction.bind(null, store.slug, ref.customerId)}
              merge={mergeCustomersAction.bind(null, store.slug, ref.customerId)}
            />
          ) : (
            <p className="text-sm">{w.guestOnly}</p>
          )}
        </Card>
      </div>
    </AdminTextScope>
  );
}
