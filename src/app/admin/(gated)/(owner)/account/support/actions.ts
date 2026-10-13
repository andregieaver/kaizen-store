"use server";

import { requireAccount } from "@/server/auth";
import { heartbeat, setPresence } from "@/server/support";
import { ownerDesks } from "@/server/support-desk";

/**
 * The owner's combined inbox's presence (D216, 2.8): online or away on every store where the account may answer (`support:write`
 * by its role there), and the heartbeat on every store where it may read.
 */

export async function ownerSupportPresenceAction(status: "online" | "away"): Promise<{ ok: boolean }> {
  const account = await requireAccount();
  if (status !== "online" && status !== "away") return { ok: false };
  const desks = (await ownerDesks(account)).filter((d) => d.canWrite);
  if (desks.length === 0) return { ok: false };
  await setPresence(desks.map((d) => d.desk), account.id, status);
  return { ok: true };
}

export async function ownerSupportHeartbeatAction(): Promise<{ ok: boolean }> {
  const account = await requireAccount();
  const desks = await ownerDesks(account);
  await heartbeat(desks.map((d) => d.desk), account.id);
  return { ok: true };
}
