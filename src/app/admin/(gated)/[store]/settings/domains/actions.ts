"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { requireMember } from "@/server/auth";
import { addStoreDomain, checkStoreDomain, removeStoreDomain, setPrimaryDomain } from "@/server/domains";

/** A store's own domains (P8) are the owner's: they decide where the store lives. */
async function asOwner(storeSlug: string) {
  const member = await requireMember(storeSlug);
  return member.role === "owner" ? member : null;
}

const notOwner: FormState = { status: "error", messages: ["Only an owner can change the store's domains."] };
const done = (messages: string[]): FormState => {
  refresh();
  return { status: "ok", messages };
};

export async function addDomainAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await asOwner(storeSlug);
  if (!member) return notOwner;
  const result = await addStoreDomain(member.account, member.store.id, { hostname: String(form.get("hostname") ?? "") });
  if (!result.ok) return { status: "error", messages: result.problems };
  return done([`${result.domain.hostname} added. Create the DNS records below at your domain's DNS provider.`]);
}

/** Anyone on the staff may ask for a check: it changes nothing the DNS does not already say. */
export async function checkDomainAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requireMember(storeSlug);
  const result = await checkStoreDomain(member.store.id, String(form.get("id") ?? ""));
  if (!result.ok) return { status: "error", messages: result.problems };
  return done([
    result.domain.status === "active"
      ? `${result.domain.hostname} is ready. Your store appears there within a few minutes.`
      : "Checked. Not every record is in place yet: DNS changes can take a while to show.",
  ]);
}

export async function primaryDomainAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await asOwner(storeSlug);
  if (!member) return notOwner;
  const id = String(form.get("id") ?? "");
  const result = await setPrimaryDomain(member.account, member.store.id, id || null);
  if (!result.ok) return { status: "error", messages: result.problems };
  return done(["Saved. The store moves to its new address within a few minutes."]);
}

export async function removeDomainAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await asOwner(storeSlug);
  if (!member) return notOwner;
  const result = await removeStoreDomain(member.account, member.store.id, String(form.get("id") ?? ""));
  if (!result.ok) return { status: "error", messages: result.problems };
  return done(["Removed."]);
}
