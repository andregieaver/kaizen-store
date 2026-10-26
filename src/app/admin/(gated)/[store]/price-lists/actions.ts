"use server";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { percentFromForm } from "@/lib/price-lists";
import { actionAdminLang } from "@/server/admin-request-lang";
import { catalogTag } from "@/server/catalog";
import { checkPermission } from "@/server/permissions";
import { deletePriceList, savePriceList, setAssignments, setPrices, setScope, type SaveResult } from "@/server/price-lists";

/**
 * Price lists (D321): the forms of `/admin/{store}/price-lists`. Every action asks `customers:write` and hands the form to
 * `src/server/price-lists.ts`, which checks every id is the store's own.
 */

const id = z.uuid();

const wordsOf = (member: { account: { adminLocale?: string | null } }) => adminText(adminLangOf(member.account.adminLocale), "customers").priceLists;
const noAccess = async (): Promise<FormState> => ({ status: "error", messages: [adminText(await actionAdminLang(), "customers").saved.noAccess] });

/** What a list offers to whom can hide products from everyone else (D321 C.3): the store's cached catalogue reads are refreshed after any change. */
function toState(result: SaveResult, success: string, storeId?: string): FormState {
  if (!result.ok) return { status: "error", messages: result.problems };
  if (storeId) updateTag(catalogTag(storeId));
  refresh();
  return { status: "ok", messages: [success] };
}

const ids = (form: FormData, name: string) => form.getAll(name).map(String).filter((value) => id.safeParse(value).success);

/** Makes a price list (id null) or changes its name, percentage and switch. */
export async function savePriceListAction(storeSlug: string, listId: string | null, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return noAccess();
  const words = wordsOf(member);
  if (listId !== null && !id.safeParse(listId).success) return { status: "error", messages: [words.problems.gone] };
  const percent = percentFromForm(form.get("percent"));
  if (percent === "invalid") return { status: "error", messages: [words.problems.percent] };
  const result = await savePriceList(member, listId, {
    name: String(form.get("name") ?? ""),
    percent,
    active: listId === null ? true : form.get("active") === "on",
    exclusive: form.get("exclusive") === "on",
  });
  if (result.ok) updateTag(catalogTag(member.store.id));
  if (result.ok && listId === null && result.id) redirect(`/admin/${member.store.slug}/price-lists/${result.id}`);
  return toState(result, words.saved);
}

export async function deletePriceListAction(storeSlug: string, listId: string): Promise<FormState> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return noAccess();
  const words = wordsOf(member);
  if (!id.safeParse(listId).success) return { status: "error", messages: [words.problems.gone] };
  const result = await deletePriceList(member, listId);
  if (result.ok) updateTag(catalogTag(member.store.id));
  if (result.ok) redirect(`/admin/${member.store.slug}/price-lists`);
  return toState(result, words.deleted);
}

/** Who the list is for: the ticked customer groups and companies. */
export async function saveAssignmentsAction(storeSlug: string, listId: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return noAccess();
  const words = wordsOf(member);
  if (!id.safeParse(listId).success) return { status: "error", messages: [words.problems.gone] };
  return toState(await setAssignments(member, listId, { tierIds: ids(form, "tier"), companyIds: ids(form, "company") }), words.saved);
}

/** What the percentage reaches: the ticked products and categories; none is every product. */
export async function saveScopeAction(storeSlug: string, listId: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return noAccess();
  const words = wordsOf(member);
  if (!id.safeParse(listId).success) return { status: "error", messages: [words.problems.gone] };
  return toState(await setScope(member, listId, { productIds: ids(form, "product"), termIds: ids(form, "term") }), words.saved, member.store.id);
}

/** Fixed prices as typed, one field per variant and currency (`price:{variant}:{currency}`); an empty field takes the price away. */
export async function savePricesAction(storeSlug: string, listId: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return noAccess();
  const words = wordsOf(member);
  if (!id.safeParse(listId).success) return { status: "error", messages: [words.problems.gone] };
  const rows = [...form.entries()].flatMap(([name, value]) => {
    const match = /^price:([0-9a-f-]{36}):([A-Z]{3})$/.exec(name);
    return match ? [{ variantId: match[1], currency: match[2], amount: String(value) }] : [];
  });
  return toState(await setPrices(member, listId, rows), words.saved);
}
