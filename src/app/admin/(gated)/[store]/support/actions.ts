"use server";

import { checkPermission } from "@/server/permissions";
import { heartbeat, setPresence } from "@/server/support";
import { agentAct, readAct, type AgentActResult } from "@/server/support-agent";
import { memberDesk } from "@/server/support-desk";

/**
 * The store inbox's presence (D216, 2.4): online or away (`support:write`: being online means taking conversations), and the open
 * inbox's heartbeat (`support:read`), which keeps an online agent counted as online. The store's slug is bound first.
 */

export async function supportPresenceAction(slug: string, status: "online" | "away"): Promise<{ ok: boolean }> {
  const member = await checkPermission(slug, "support:write");
  if (!member || (status !== "online" && status !== "away")) return { ok: false };
  const staff = memberDesk(member);
  await setPresence([staff.desk], staff.account.id, status);
  return { ok: true };
}

export async function supportHeartbeatAction(slug: string): Promise<{ ok: boolean }> {
  const member = await checkPermission(slug, "support:read");
  if (!member) return { ok: false };
  const staff = memberDesk(member);
  await heartbeat([staff.desk], staff.account.id);
  return { ok: true };
}

/** Take over, answer, note, hand over, give back, end or ask to sign in, in a conversation of the store's desk (step 4): `support:write`. */
export async function supportActAction(slug: string, conversationId: string, raw: unknown): Promise<AgentActResult> {
  const member = await checkPermission(slug, "support:write");
  if (!member) return { ok: false, problem: "You do not have access to this." };
  const act = readAct(raw);
  if (!act) return { ok: false, problem: "That could not be done." };
  return agentAct(memberDesk(member), conversationId, act);
}
