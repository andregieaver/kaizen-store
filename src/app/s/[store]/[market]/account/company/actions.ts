"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { INVITES_PER_BATCH, parseInviteEmails } from "@/lib/customer-tiers";
import { t } from "@/lib/i18n";
import { companyOf, createInvites, removeMember, revokeInvite } from "@/server/companies";
import { getCustomer } from "@/server/customers";
import { resolveShop } from "@/server/shop";

export type InviteState = { ok: boolean; message: string | null };

/** The signed-in customer and their company, when they are its main account: only that account manages it. */
async function asMainAccount(storeSlug: string, marketSlug: string) {
  const shop = await resolveShop(storeSlug, marketSlug);
  const customer = shop ? await getCustomer(shop.store.id) : null;
  const mine = shop && customer ? await companyOf(shop.store.id, customer.id) : null;
  if (!shop || !customer || !mine || mine.role !== "owner") return null;
  return { shop, customer, company: mine.company, m: t(shop.market.lang).companyAccount, market: { marketCode: shop.market.code, locale: shop.market.locale } };
}

/** Invites the addresses typed, as the company's main account. */
export async function inviteEmployeesAction(storeSlug: string, marketSlug: string, _previous: InviteState, form: FormData): Promise<InviteState> {
  const found = await asMainAccount(storeSlug, marketSlug);
  if (!found) return { ok: false, message: null };
  const { m } = found;
  const { emails, invalid } = parseInviteEmails(String(form.get("emails") ?? ""));
  if (invalid.length > 0) return { ok: false, message: m.notEmails(invalid.slice(0, 5).join(", ")) };
  if (emails.length === 0) return { ok: false, message: m.noEmails };
  const result = await createInvites(found.shop.store.id, found.company.id, emails.slice(0, INVITES_PER_BATCH), {
    invitedBy: found.customer.id,
    inviterName: found.customer.name || found.customer.email,
    market: found.market,
  });
  if (!result.ok) return { ok: false, message: m.companyOff };
  const count = (outcome: string) => result.results.filter((r) => r.outcome === outcome).length;
  const lines = [
    count("sent") > 0 && m.sent(count("sent")),
    count("resent") > 0 && m.resent(count("resent")),
    count("member") > 0 && m.alreadyMember(count("member")),
    count("full") > 0 && m.companyFull(count("full")),
    count("limit") > 0 && m.dayLimit(count("limit")),
  ].filter(Boolean);
  refresh();
  return { ok: count("sent") + count("resent") > 0, message: lines.join(" ") };
}

/** Withdraws an invitation that is still open. */
export async function revokeInviteAction(storeSlug: string, marketSlug: string, inviteId: string): Promise<void> {
  const found = await asMainAccount(storeSlug, marketSlug);
  if (!found || !z.uuid().safeParse(inviteId).success) return;
  await revokeInvite(found.shop.store.id, found.company.id, inviteId);
  refresh();
}

/** Takes an employee out of the company: their discount stops at once. */
export async function removeEmployeeAction(storeSlug: string, marketSlug: string, customerId: string): Promise<void> {
  const found = await asMainAccount(storeSlug, marketSlug);
  if (!found || !z.uuid().safeParse(customerId).success || customerId === found.customer.id) return;
  await removeMember(found.shop.store.id, found.company.id, customerId, { market: found.market });
  refresh();
}

/** An employee leaves the company themselves. The main account cannot: the store moves that. */
export async function leaveCompanyAction(storeSlug: string, marketSlug: string): Promise<void> {
  const shop = await resolveShop(storeSlug, marketSlug);
  const customer = shop ? await getCustomer(shop.store.id) : null;
  const mine = shop && customer ? await companyOf(shop.store.id, customer.id) : null;
  if (!shop || !customer || !mine || mine.role !== "employee") return;
  await removeMember(shop.store.id, mine.company.id, customer.id, { quiet: true, market: null });
  refresh();
}
