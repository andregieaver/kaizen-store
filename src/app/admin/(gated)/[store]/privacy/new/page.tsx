import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { LogRequestForm } from "@/components/admin/privacy/request-form";
import { todayIn } from "@/lib/work-dates";
import { memberCan, requirePermission } from "@/server/permissions";

import { logRequestAction } from "../actions";

export const metadata: Metadata = { title: "Log a privacy request" };

/** Logging a request that arrived by email, post or phone (wave 1, 1g, D162): the one-month clock runs from the day it was received. */
export default async function NewPrivacyRequestPage({ params }: PageProps<"/admin/[store]/privacy/new">) {
  await connection();
  const member = await requirePermission((await params).store, "customers:read");
  // Logging is for those who may change customers: the page is a 404 to the rest, as the actions refuse them.
  if (!memberCan(member, "customers:write")) notFound();
  const { store } = member;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/admin/${store.slug}/privacy`} className="text-sm underline">
          Privacy requests
        </Link>
        <h1 className="text-2xl font-semibold">Log a request</h1>
        <p className="max-w-2xl text-sm text-muted">Use this for a request that came by email, post or phone, so the clock and the answer are kept in one place.</p>
      </div>
      <LogRequestForm action={logRequestAction.bind(null, store.slug)} today={todayIn(store.timeZone)} />
    </div>
  );
}
