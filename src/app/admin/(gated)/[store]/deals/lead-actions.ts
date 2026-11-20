"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { adminLangOf } from "@/lib/admin-lang";
import { DEALS_WORDS } from "@/lib/admin-words/deals";
import { dismissLead, makeLeadDeal } from "@/server/leads";
import { checkPermission } from "@/server/permissions";

/**
 * The leads inbox's actions (S4, D475): each checks the member may change customers (the server checks Deals is on), whatever a stale page
 * sends. Making a deal opens it; dismissing draws the inbox again.
 */

export async function makeLeadDealAction(storeSlug: string, email: string): Promise<void> {
  const member = await checkPermission(storeSlug, "customers:write", "deals");
  if (!member) return;
  const kinds = DEALS_WORDS[adminLangOf(member.account.adminLocale)].leads.dealKinds;
  const made = await makeLeadDeal(member, email, kinds);
  if (made.ok && made.dealId) redirect(`/admin/${storeSlug}/deals/${made.dealId}`);
  refresh();
}

export async function dismissLeadAction(storeSlug: string, email: string): Promise<void> {
  const member = await checkPermission(storeSlug, "customers:write", "deals");
  if (!member) return;
  if ((await dismissLead(member, email)).ok) refresh();
}
