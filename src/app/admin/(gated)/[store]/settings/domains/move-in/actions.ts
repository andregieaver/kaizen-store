"use server";

import { refresh } from "next/cache";
import { after } from "next/server";

import type { FormState } from "@/components/admin/action-form";
import type { MoveInLookShape, MoveInStartShape, TransferQuoteShape } from "@/components/admin/domain-types";
import { adminLangOf } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import { describeRecord, recordKey } from "@/lib/dns-records";
import { lookBeforeMoveIn, startMoveIn, stopMoveIn } from "@/server/domain-move-in";
import { chargeDomainPurchases, quoteTransfer, startDomainTransfer } from "@/server/domain-purchases";
import { checkOwnerRole } from "@/server/permissions";

/** Bringing a domain here (D315 phase 6) is the owner's, as everything about the store's domains is. */
const notOwner = ["Only an owner can bring domains to the store."];
const wordsOf = (locale: string | null | undefined) => adminText(adminLangOf(locale), "domains").moveIn;

/** The price of moving a registration here; nothing is started. */
export async function quoteTransferAction(storeSlug: string, domain: string): Promise<TransferQuoteShape> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return { ok: false, problems: notOwner };
  const quoted = await quoteTransfer(member.store.id, String(domain).slice(0, 253));
  if (!quoted.ok) return quoted;
  return { ok: true, domain: quoted.quote.domain, currency: quoted.quote.currency, amountMinor: quoted.quote.amountMinor };
}

/** Starts moving a registration here at the price shown; the invoice follows after the answer. The code is never echoed back. */
export async function startTransferAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return { status: "error", messages: notOwner };
  const value = (key: string) => String(form.get(key) ?? "");
  const result = await startDomainTransfer(member.account, member.store.id, {
    domain: value("domain"),
    authCode: value("authCode"),
    agreed: value("agreed"),
    connect: form.get("connect") === "on",
    registrant: {
      kind: value("kind") === "company" ? "company" : "person",
      firstName: value("firstName"),
      lastName: value("lastName"),
      companyName: value("companyName"),
      orgNumber: value("orgNumber"),
      email: value("email"),
      phone: value("phone"),
      address1: value("address1"),
      address2: value("address2"),
      city: value("city"),
      state: value("state"),
      postalCode: value("postalCode"),
      country: value("country"),
    },
  });
  if (!result.ok) return { status: "error", messages: result.problems };
  after(() => chargeDomainPurchases({ storeId: member.store.id }).then(() => undefined));
  refresh();
  return { status: "ok", messages: [fillWords(wordsOf(member.account.adminLocale).transfer.started, { domain: result.quote.domain })] };
}

/** What moving the DNS here would copy; nothing is changed. */
export async function lookDnsMoveAction(storeSlug: string, domain: string, zoneText: string): Promise<MoveInLookShape> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return { ok: false, problems: notOwner };
  const looked = await lookBeforeMoveIn(member.store.id, String(domain).slice(0, 253), zoneText ? String(zoneText) : null);
  if (!looked.ok) return looked;
  const { look } = looked;
  return {
    ok: true,
    domain: look.apex,
    nameservers: look.nameservers,
    registrar: look.registrar,
    found: look.found.map((f) => ({ key: recordKey(f.record), line: describeRecord(f.record, look.apex), from: f.from, live: f.live })),
    kept: look.kept.map((r) => describeRecord(r, look.apex)),
    problems: look.problems,
    skipped: look.skipped,
    registeredHere: look.registeredHere,
  };
}

/** Copies the chosen records into a zone here and checks them at Vercel's nameservers; the owner then changes the nameservers. */
export async function startDnsMoveAction(storeSlug: string, domain: string, zoneText: string, keys: string[], pointHere: boolean): Promise<MoveInStartShape> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return { ok: false, problems: notOwner };
  const name = String(domain).slice(0, 253).toLowerCase();
  const result = await startMoveIn(member.account, member.store.id, name, { zoneText: zoneText ? String(zoneText) : null, keys: Array.isArray(keys) ? keys.map(String).slice(0, 500) : undefined, pointHere: pointHere === true });
  if (!result.ok) return result;
  refresh();
  return {
    ok: true,
    domain: name,
    nameservers: result.nameservers,
    missing: result.check.missing.map((r) => describeRecord(r, name)),
    unanswered: result.check.unanswered,
    pointed: result.pointed,
  };
}

export async function stopDnsMoveAction(storeSlug: string, domain: string): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return { status: "error", messages: notOwner };
  const result = await stopMoveIn(member.account, member.store.id, String(domain));
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [fillWords(wordsOf(member.account.adminLocale).dns.stopped, { domain: String(domain) })] };
}
