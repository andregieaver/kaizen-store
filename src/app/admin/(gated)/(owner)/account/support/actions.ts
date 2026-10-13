"use server";

import { requireAccount } from "@/server/auth";
import { heartbeat, setPresence } from "@/server/support";
import { agentAct, readAct, type AgentActResult } from "@/server/support-agent";
import { checkStoreDesk, ownerDesks } from "@/server/support-desk";

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

/** An action in a conversation of one of the account's stores (step 4): `support:write` in that store, checked again here. */
export async function ownerSupportActAction(store: string, conversationId: string, raw: unknown): Promise<AgentActResult> {
  const staff = typeof store === "string" ? await checkStoreDesk(store, "write") : null;
  if (!staff) return { ok: false, problem: "You do not have access to this." };
  const act = readAct(raw);
  if (!act) return { ok: false, problem: "That could not be done." };
  return agentAct(staff, conversationId, act);
}
