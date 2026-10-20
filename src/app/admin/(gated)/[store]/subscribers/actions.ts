"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { unsubscribeByStaff } from "@/server/marketing-subscribers";
import { requirePermission } from "@/server/permissions";

/** Staff unsubscribing a person who asked by other means (D295): `marketing:write`, audited with the id only. */
export async function unsubscribeAction(storeSlug: string, subscriberId: string): Promise<void> {
  const member = await requirePermission(storeSlug, "marketing:write");
  if (!z.uuid().safeParse(subscriberId).success) return;
  await unsubscribeByStaff(member.store.id, member.account.id, subscriberId);
  refresh();
}
