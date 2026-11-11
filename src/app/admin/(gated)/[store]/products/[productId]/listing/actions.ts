"use server";

import { refresh } from "next/cache";

import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { checkPermission } from "@/server/permissions";
import {
  addToGroup,
  leaveGroup,
  renameGroupOption,
  startGroup,
  updateGroupMember,
  type GroupResult,
} from "@/server/product-groups";

/** A product's combined listing (D566): every step changes products, so each is `products:write`, checked again by the server. */

async function writer(storeSlug: string) {
  return checkPermission(storeSlug, "products:write");
}
const refused = async (): Promise<GroupResult> => ({
  ok: false,
  problem: adminText(await actionAdminLang(), "inventory").noAccess,
});
const after = (result: GroupResult) => {
  if (result.ok) refresh();
  return result;
};

export async function startGroupAction(
  storeSlug: string,
  productId: string,
  form: { option: string; value: string; swatch: string },
): Promise<GroupResult> {
  const member = await writer(storeSlug);
  return member
    ? after(await startGroup(member, String(productId), form))
    : refused();
}

export async function addToGroupAction(
  storeSlug: string,
  productId: string,
  otherId: string,
  form: { value: string; swatch: string },
): Promise<GroupResult> {
  const member = await writer(storeSlug);
  return member
    ? after(await addToGroup(member, String(productId), String(otherId), form))
    : refused();
}

export async function updateMemberAction(
  storeSlug: string,
  memberId: string,
  form: { value: string; swatch: string },
): Promise<GroupResult> {
  const member = await writer(storeSlug);
  return member
    ? after(await updateGroupMember(member, String(memberId), form))
    : refused();
}

export async function renameOptionAction(
  storeSlug: string,
  productId: string,
  option: string,
): Promise<GroupResult> {
  const member = await writer(storeSlug);
  return member
    ? after(await renameGroupOption(member, String(productId), { option }))
    : refused();
}

export async function leaveGroupAction(
  storeSlug: string,
  memberId: string,
): Promise<GroupResult> {
  const member = await writer(storeSlug);
  return member ? after(await leaveGroup(member, String(memberId))) : refused();
}
