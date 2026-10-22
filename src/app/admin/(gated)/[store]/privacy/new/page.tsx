import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminTextScope } from "@/components/admin/admin-text";
import { LogRequestForm } from "@/components/admin/privacy/request-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { todayIn } from "@/lib/work-dates";
import { memberCan, requirePermission } from "@/server/permissions";
import { PageHeader } from "@/components/admin/ui";

import { logRequestAction } from "../actions";

export const metadata: Metadata = { title: "Log a privacy request" };

/** Logging a request that arrived by email, post or phone (wave 1, 1g, D162): the one-month clock runs from the day it was received. */
export default async function NewPrivacyRequestPage({ params }: PageProps<"/admin/[store]/privacy/new">) {
  await connection();
  const member = await requirePermission((await params).store, "customers:read");
  // Logging is for those who may change customers: the page is a 404 to the rest, as the actions refuse them.
  if (!memberCan(member, "customers:write")) notFound();
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "privacy");
  return (
    <AdminTextScope texts={adminTexts(lang, ["privacy"])}>
      <div className="flex flex-col gap-6">
        <PageHeader
          back={{ href: `/admin/${store.slug}/privacy`, label: w.common.privacyRequests }}
          title={w.forms.logTitle}
          description={<>{w.forms.newDescription}</>}
        />
        <LogRequestForm action={logRequestAction.bind(null, store.slug)} today={todayIn(store.timeZone)} />
      </div>
    </AdminTextScope>
  );
}
