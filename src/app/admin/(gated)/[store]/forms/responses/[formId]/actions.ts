"use server";

import { refresh } from "next/cache";

import { deleteResponses, setResponseState, type FormResponseRow } from "@/server/forms-admin";
import { checkPermission } from "@/server/permissions";

/** Marks responses read, archived or new again (D705): people's data, changed with the right to change customers. */
export async function setResponseStateAction(storeSlug: string, formId: string, ids: string[], state: FormResponseRow["state"]): Promise<number> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return 0;
  const n = await setResponseState({ accountId: member.account.id, storeId: member.store.id }, formId, ids.slice(0, 100), state);
  refresh();
  return n;
}

/** Deletes responses for good. */
export async function deleteResponsesAction(storeSlug: string, formId: string, ids: string[]): Promise<number> {
  const member = await checkPermission(storeSlug, "customers:write");
  if (!member) return 0;
  const n = await deleteResponses({ accountId: member.account.id, storeId: member.store.id }, formId, ids.slice(0, 100));
  refresh();
  return n;
}
