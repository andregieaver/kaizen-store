"use server";

import { refresh, updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { deleteAuthor, deleteBlog, saveAuthor, saveBlog } from "@/server/blogs";
import { pagesTag } from "@/server/pages";
import { checkPageTypeAccess } from "@/server/permissions";

/**
 * A store's blogs and authors (wave 7 unit G, D341): saved and deleted only through `src/server/blogs.ts`, by members who may change
 * articles (the Website area's key). A store's pages draw them, so the store's pages tag is refreshed.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

async function member(storeSlug: string) {
  const found = await checkPageTypeAccess(storeSlug, "article", "write");
  return found ? { member: found, w: adminText(adminLangOf(found.account.adminLocale), "blog") } : null;
}

const refused = async (): Promise<FormState> => ({ status: "error", messages: [adminText(await actionAdminLang(), "blog").noChange] });

export async function saveBlogAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const found = await member(storeSlug);
  if (!found) return refused();
  const { member: m, w } = found;
  const id = text(formData, "id");
  if (id && !UUID.test(id)) return { status: "error", messages: [w.blogs.problems.missing] };
  const titles = Object.fromEntries(
    [...formData.entries()].flatMap(([key, value]) => (key.startsWith("title.") && typeof value === "string" ? [[key.slice(6), value] as const] : [])),
  );
  const listing = text(formData, "listingPageId");
  const result = await saveBlog(m.account, m.store, id || null, {
    handle: text(formData, "handle"),
    titles,
    comments: text(formData, "comments"),
    listingPageId: listing && UUID.test(listing) ? listing : null,
  });
  if (!result.ok) return { status: "error", messages: result.problems.map((p) => w.blogs.problems[p]) };
  updateTag(pagesTag(m.store.id));
  refresh();
  return { status: "ok", messages: [w.blogs.saved] };
}

export async function deleteBlogAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const found = await member(storeSlug);
  if (!found) return refused();
  const { member: m, w } = found;
  const id = text(formData, "id");
  if (!UUID.test(id)) return { status: "error", messages: [w.blogs.problems.missing] };
  const result = await deleteBlog(m.account, m.store.id, id);
  if (!result.ok) return { status: "error", messages: [w.blogs.problems[result.problem]] };
  updateTag(pagesTag(m.store.id));
  refresh();
  return { status: "ok", messages: [w.blogs.removed] };
}

export async function saveAuthorAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const found = await member(storeSlug);
  if (!found) return refused();
  const { member: m, w } = found;
  const id = text(formData, "id");
  if (id && !UUID.test(id)) return { status: "error", messages: [w.authors.problems.missing] };
  const result = await saveAuthor(m.account, m.store.id, id || null, {
    name: text(formData, "name"),
    picture: text(formData, "picture") || null,
    bio: text(formData, "bio"),
    link: text(formData, "link") || null,
  });
  if (!result.ok) return { status: "error", messages: result.problems.map((p) => w.authors.problems[p]) };
  updateTag(pagesTag(m.store.id));
  refresh();
  return { status: "ok", messages: [w.authors.saved] };
}

export async function deleteAuthorAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const found = await member(storeSlug);
  if (!found) return refused();
  const { member: m, w } = found;
  const id = text(formData, "id");
  if (!UUID.test(id) || !(await deleteAuthor(m.account, m.store.id, id))) return { status: "error", messages: [w.authors.problems.missing] };
  updateTag(pagesTag(m.store.id));
  refresh();
  return { status: "ok", messages: [w.authors.removed] };
}
