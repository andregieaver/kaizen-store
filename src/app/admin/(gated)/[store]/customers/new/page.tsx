import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminTextScope } from "@/components/admin/admin-text";
import { CustomerForm, EMPTY_CUSTOMER_FORM } from "@/components/admin/customer-staff";
import { requireFeature } from "@/components/admin/feature-off";
import { Card, PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { memberCan, requirePermission } from "@/server/permissions";

import { createCustomerAction } from "../actions";

export const metadata: Metadata = { title: "Add a customer" };

/**
 * Adding a customer by hand (wave 10 unit C, D366): an account with no password, its email not yet proven; the person signs in with a code
 * sent to it (D32). Nothing is emailed when staff add someone, and nobody is put on the marketing list.
 */
export default async function NewCustomerPage({ params }: PageProps<"/admin/[store]/customers/new">) {
  const member = await requirePermission((await params).store, "customers:read");
  if (!memberCan(member, "customers:write")) notFound();
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(member, "shop");
  if (shopOff) return shopOff;
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "customers").staff;
  return (
    <AdminTextScope texts={adminTexts(lang, ["customers"])}>
      <div className="flex flex-col gap-6">
        <PageHeader back={{ href: `/admin/${store.slug}/customers`, label: w.newPage.back }} title={w.newPage.title} description={w.newPage.description} />
        <Card title={w.newPage.details}>
          <CustomerForm action={createCustomerAction.bind(null, store.slug)} values={EMPTY_CUSTOMER_FORM} words={w.form} submit={w.form.create} />
        </Card>
      </div>
    </AdminTextScope>
  );
}
