"use server";

import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { heartbeat, setAgentPartner, setPresence } from "@/server/support";
import { agentAct, readAct, type AgentActResult } from "@/server/support-agent";
import { checkKaizenDesk } from "@/server/support-desk";

/** Kaizen's desk's presence (D216): online or away, and the open inbox's heartbeat, for platform admins. */

export async function kaizenSupportPresenceAction(
  status: "online" | "away",
): Promise<{ ok: boolean }> {
  const desk = await checkKaizenDesk();
  if (!desk || (status !== "online" && status !== "away")) return { ok: false };
  await setPresence([desk.desk], desk.account.id, status);
  return { ok: true };
}

/** The platform admin's own silent partner on or off on Kaizen's desk (step 8). */
export async function kaizenSupportPartnerAction(
  on: boolean,
): Promise<{ ok: boolean }> {
  const desk = await checkKaizenDesk();
  if (!desk || typeof on !== "boolean") return { ok: false };
  await setAgentPartner([desk.desk], desk.account.id, on);
  return { ok: true };
}

export async function kaizenSupportHeartbeatAction(): Promise<{ ok: boolean }> {
  const desk = await checkKaizenDesk();
  if (!desk) return { ok: false };
  await heartbeat([desk.desk], desk.account.id);
  return { ok: true };
}

/** An action in a conversation of Kaizen's desk (step 4), for platform admins. */
export async function kaizenSupportActAction(
  conversationId: string,
  raw: unknown,
): Promise<AgentActResult> {
  const w = adminText(await actionAdminLang(), "support").problems;
  const desk = await checkKaizenDesk();
  if (!desk) return { ok: false, problem: w.noAccess };
  const act = readAct(raw);
  if (!act) return { ok: false, problem: w.cannot };
  return agentAct(desk, conversationId, act);
}
