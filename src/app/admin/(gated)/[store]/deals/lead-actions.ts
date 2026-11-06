"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { dismissLead, makeLeadDeal } from "@/server/leads";
import { checkPermission } from "@/server/permissions";

/**
 * The leads inbox's actions (S4, D475): each checks the member may change customers (the server checks Deals is on), whatever a stale page
 * sends. Making a deal opens it; dismissing draws the inbox again.
 */

export async function makeLeadDealAction(storeSlug: string, email: string): Promise<void> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return;
  const kinds = adminText(adminLangOf(member.account.adminLocale), "deals").leads.dealKinds;
  const made = await makeLeadDeal(member, email, kinds);
  if (made.ok && made.dealId) redirect(`/admin/${storeSlug}/deals/${made.dealId}`);
  refresh();
}

export async function dismissLeadAction(storeSlug: string, email: string): Promise<void> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return;
  if ((await dismissLead(member, email)).ok) refresh();
}
