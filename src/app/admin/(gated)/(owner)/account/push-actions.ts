"use server";

import { refresh } from "next/cache";

import { requireAccount } from "@/server/auth";
import { checkPermission } from "@/server/permissions";
import { removePushDevice, removePushSubscription, savePushSubscription } from "@/server/push";

type Done = { ok: true } | { ok: false; problem: string };

/** Turns on this device's notifications for one store (D361): only where the person reads its orders. */
export async function savePushAction(storeSlug: string, subscription: unknown): Promise<Done> {
  const member = await checkPermission(storeSlug, "orders:read");
  if (!member) return { ok: false, problem: "access" };
  const done = await savePushSubscription(member, subscription);
  if (done.ok) refresh();
  return done;
}

/** Turns off this device's notifications for one store. */
export async function removePushAction(storeSlug: string, endpoint: string): Promise<Done> {
  const member = await checkPermission(storeSlug, "orders:read");
  const account = await requireAccount();
  // A store the person no longer reads: the device goes for it all the same, as it is theirs.
  await removePushSubscription(account.id, endpoint, member?.store.id ?? null);
  refresh();
  return { ok: true };
}

/** Removes one of the person's devices from the list. */
export async function removePushDeviceAction(id: string): Promise<Done> {
  const account = await requireAccount();
  if (!(await removePushDevice(account.id, id))) return { ok: false, problem: "unknown" };
  refresh();
  return { ok: true };
}
