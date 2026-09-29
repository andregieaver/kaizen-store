"use server";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { groupFromPreset, type FieldGroupInput } from "@/lib/custom-fields";
import { startFieldFileUpload, type FieldFileUpload } from "@/server/media";
import { requireMember } from "@/server/auth";
import {
  deleteFieldGroup,
  fieldsTag,
  importFieldGroups,
  listFieldGroups,
  orderFieldGroups,
  saveFieldGroup,
  saveTermFields,
  setFieldGroupActive,
  termFieldsForEditor,
  type TermFieldsEditor,
} from "@/server/custom-fields";
import type { SaveResult } from "@/server/settings";

const idSchema = z.uuid();
const unknownGroup = (): SaveResult => ({ ok: false, problems: ["Unknown group."] });

/** Creates a group (id null) or changes one (D118); the server checks all of it again. */
export async function saveFieldGroupAction(
  storeSlug: string,
  input: FieldGroupInput,
): Promise<SaveResult & { id?: string }> {
  const member = await requireMember(storeSlug);
  const result = await saveFieldGroup(member, input);
  if (result.ok) updateTag(fieldsTag(member.store.id));
  return result;
}

/** Deletes a group and what was entered in its fields, then goes back to the list. */
export async function deleteFieldGroupAction(storeSlug: string, id: string): Promise<SaveResult> {
  const member = await requireMember(storeSlug);
  if (!idSchema.safeParse(id).success) return unknownGroup();
  const result = await deleteFieldGroup(member, id);
  if (!result.ok) return result;
  updateTag(fieldsTag(member.store.id));
  redirect(`/admin/${member.store.slug}/fields`);
}

/** Switches a group on or off from the list. */
export async function setFieldGroupActiveAction(storeSlug: string, id: string, active: boolean): Promise<void> {
  const member = await requireMember(storeSlug);
  if (!idSchema.safeParse(id).success) return;
  const result = await setFieldGroupActive(member, id, active);
  if (result.ok) updateTag(fieldsTag(member.store.id));
  refresh();
}

/** Moves a group one place up or down the list (the order editors show them in). */
export async function moveFieldGroupAction(storeSlug: string, id: string, direction: "up" | "down"): Promise<void> {
  const member = await requireMember(storeSlug);
  if (!idSchema.safeParse(id).success) return;
  const ids = (await listFieldGroups(member.store.id)).map((g) => g.id);
  const from = ids.indexOf(id);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= ids.length) return;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  await orderFieldGroups(member, ids);
  updateTag(fieldsTag(member.store.id));
  refresh();
}

/** Makes a group from a preset and saves it, so the owner lands in the editor with fields to change. */
export async function createFromPresetAction(storeSlug: string, key: string): Promise<SaveResult & { id?: string }> {
  const member = await requireMember(storeSlug);
  const taken = (await listFieldGroups(member.store.id)).map((g) => g.slug);
  const group = groupFromPreset(key, taken);
  if (!group) return { ok: false, problems: ["Unknown preset."] };
  const result = await saveFieldGroup(member, group);
  if (result.ok) updateTag(fieldsTag(member.store.id));
  return result;
}

/** Adds the groups in a file exported earlier, as new groups of this store. */
export async function importFieldGroupsAction(
  storeSlug: string,
  raw: unknown,
): Promise<SaveResult & { ids?: string[] }> {
  const member = await requireMember(storeSlug);
  const result = await importFieldGroups(member, raw);
  // Groups may have been saved before one in the file failed.
  updateTag(fieldsTag(member.store.id));
  if (result.ok) refresh();
  return result;
}

/** The file the browser means to upload for a custom field: its name, type and size, checked again by the bucket. */
const fieldFile = z.object({ name: z.string().max(255), type: z.string().max(150), size: z.number().int().nonnegative() });

/** Starts an upload of a file for a custom field (D118) straight from the browser to the store's folder in the public bucket. */
export async function startFieldFileUploadAction(storeSlug: string, file: unknown): Promise<FieldFileUpload> {
  const { store } = await requireMember(storeSlug);
  const parsed = fieldFile.safeParse(file);
  if (!parsed.success) return { ok: false, problem: "Choose a file to upload." };
  return startFieldFileUpload(store.id, parsed.data);
}

/** The fields of a category or tag (D118, phase 2), read when its editor opens. */
export async function termFieldsAction(storeSlug: string, termId: string): Promise<TermFieldsEditor | null> {
  const member = await requireMember(storeSlug);
  if (!idSchema.safeParse(termId).success) return null;
  return termFieldsForEditor(member.store.id, termId);
}

/** Saves what was entered in a category's or tag's fields; the server checks it against the store's groups. */
export async function saveTermFieldsAction(storeSlug: string, termId: string, changes: unknown): Promise<SaveResult> {
  const member = await requireMember(storeSlug);
  if (!idSchema.safeParse(termId).success) return { ok: false, problems: ["Unknown category or tag."] };
  const result = await saveTermFields(member, termId, changes);
  if (result.ok) updateTag(fieldsTag(member.store.id));
  return result;
}
