"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import type { BooksMessages } from "@/lib/admin-messages/books.en";
import { adminText } from "@/lib/admin-text";
import type { Membership } from "@/server/auth";
import { actionAdminLang } from "@/server/admin-request-lang";
import { lockLedgerThrough, openLedgerBook, postDueDocuments, openBookOf } from "@/server/ledger";
import { checkOwnerRole } from "@/server/permissions";

/**
 * Settings → Books (B2, D478): opening the store's books and locking them through a day. Each action checks the member is the store's
 * owner, whatever a stale page sends, and answers in their language.
 */

type Owner = { member: Membership; w: BooksMessages; refused: null } | { member: null; w: null; refused: string };

async function owner(storeSlug: string): Promise<Owner> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return { member: null, w: null, refused: adminText(await actionAdminLang(), "books").problems.forbidden };
  return { member, w: adminText(adminLangOf(member.account.adminLocale), "books"), refused: null };
}

/** *Open the books* from a day: the store's books open with Norway's chart, and the documents of their days are posted at once. */
export async function openBooksAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const who = await owner(storeSlug);
  if (who.refused !== null) return { status: "error", messages: [who.refused] };
  const { member, w } = who;
  const from = String(form.get("from") ?? "").trim();
  const opened = await openLedgerBook(member, from);
  if (!opened.ok) return { status: "error", messages: [w.problems[opened.problem]], fields: opened.problem === "date" ? { from: w.problems.date } : undefined };
  const book = await openBookOf(member.store.id);
  if (book) {
    await postDueDocuments(member.store.id, { id: book.id, currency: book.currency, opened_on: book.openedOn, closed_on: book.closedOn }, { deadline: Date.now() + 20_000 });
  }
  refresh();
  return { status: "ok", messages: [w.open.opened] };
}

/** *Lock*: nothing dated on or before the day is posted after it. */
export async function lockBooksAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const who = await owner(storeSlug);
  if (who.refused !== null) return { status: "error", messages: [who.refused] };
  const { member, w } = who;
  const through = String(form.get("through") ?? "").trim();
  const locked = await lockLedgerThrough(member, through || null);
  if (!locked.ok) return { status: "error", messages: [w.lock.invalid], fields: { through: w.lock.invalid } };
  refresh();
  return { status: "ok", messages: [w.lock.done] };
}
