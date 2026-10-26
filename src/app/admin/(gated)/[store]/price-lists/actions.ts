"use server";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { countFromForm, percentFromForm } from "@/lib/price-lists";
import { actionAdminLang } from "@/server/admin-request-lang";
import { catalogTag } from "@/server/catalog";
import { checkPermission } from "@/server/permissions";
import { deletePriceList, savePriceList, setAssignments, setListBreaks, setListRules, setPrices, setScope, type SaveResult } from "@/server/price-lists";

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

/**
 * A list's prices by quantity (D323 E3): rows `break:{n}:variant`, `:from`, `:percent` and `:price:{currency}`; a row without a variant or a quantity
 * is an empty row and left out, so the form's blank rows add nothing. The rows replace the list's breaks.
 */
export async function saveBreaksAction(storeSlug: string, listId: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return noAccess();
  const words = wordsOf(member);
  if (!id.safeParse(listId).success) return { status: "error", messages: [words.problems.gone] };
  const rows = new Map<string, { variantId: string; from: string; percent: string; prices: Record<string, string> }>();
  for (const [name, value] of form.entries()) {
    const match = /^break:([0-9]{1,4}):(variant|from|percent|price:[A-Z]{3})$/.exec(name);
    if (!match) continue;
    const row = rows.get(match[1]) ?? { variantId: "", from: "", percent: "", prices: {} };
    const text = String(value).trim();
    if (match[2] === "variant") row.variantId = text;
    else if (match[2] === "from") row.from = text;
    else if (match[2] === "percent") row.percent = text;
    else row.prices[match[2].slice("price:".length)] = text;
    rows.set(match[1], row);
  }
  const given = [...rows.values()].filter((row) => row.variantId !== "" && row.from !== "");
  const breaks = [];
  for (const row of given) {
    const from = countFromForm(row.from);
    const percent = percentFromForm(row.percent);
    if (from === "invalid" || from === null || from < 2) return { status: "error", messages: [words.problems.count] };
    if (percent === "invalid" || (percent !== null && (percent < 1 || percent > 99))) return { status: "error", messages: [words.problems.percent] };
    breaks.push({ variantId: row.variantId, from, percent, prices: row.prices });
  }
  return toState(await setListBreaks(member, listId, breaks), words.saved);
}

/** A list's quantity rules (D323 E3): `rule:{variant}:min`, `:max` and `:step`; a variant's three left empty takes the list's rule away. */
export async function saveRulesAction(storeSlug: string, listId: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return noAccess();
  const words = wordsOf(member);
  if (!id.safeParse(listId).success) return { status: "error", messages: [words.problems.gone] };
  const rows = new Map<string, { variantId: string; min: number | null; max: number | null; step: number | null }>();
  for (const [name, value] of form.entries()) {
    const match = /^rule:([0-9a-f-]{36}):(min|max|step)$/.exec(name);
    if (!match) continue;
    const count = countFromForm(value);
    if (count === "invalid") return { status: "error", messages: [words.problems.count] };
    const row = rows.get(match[1]) ?? { variantId: match[1], min: null, max: null, step: null };
    row[match[2] as "min" | "max" | "step"] = count;
    rows.set(match[1], row);
  }
  return toState(await setListRules(member, listId, [...rows.values()]), words.saved);
}
