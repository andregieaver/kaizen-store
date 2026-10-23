"use server";

import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { requireAccount } from "@/server/auth";
import { heartbeat, setAgentPartner, setPresence } from "@/server/support";
import { agentAct, readAct, type AgentActResult } from "@/server/support-agent";
import { checkStoreDesk, ownerDesks } from "@/server/support-desk";

/**
 * The owner's combined inbox's presence (D216, 2.8): online or away on every store where the account may answer (`support:write`
 * by its role there), and the heartbeat on every store where it may read.
 */

export async function ownerSupportPresenceAction(
  status: "online" | "away",
): Promise<{ ok: boolean }> {
  const account = await requireAccount();
  if (status !== "online" && status !== "away") return { ok: false };
  const desks = (await ownerDesks(account)).filter((d) => d.canWrite);
  if (desks.length === 0) return { ok: false };
  await setPresence(
    desks.map((d) => d.desk),
    account.id,
    status,
  );
  return { ok: true };
}

/** The person's own silent partner on or off on every store where they may answer (step 8). */
export async function ownerSupportPartnerAction(
  on: boolean,
): Promise<{ ok: boolean }> {
  const account = await requireAccount();
  if (typeof on !== "boolean") return { ok: false };
  const desks = (await ownerDesks(account)).filter((d) => d.canWrite);
  if (desks.length === 0) return { ok: false };
  await setAgentPartner(
    desks.map((d) => d.desk),
    account.id,
    on,
  );
  return { ok: true };
}

export async function ownerSupportHeartbeatAction(): Promise<{ ok: boolean }> {
  const account = await requireAccount();
  const desks = await ownerDesks(account);
  await heartbeat(
    desks.map((d) => d.desk),
    account.id,
  );
  return { ok: true };
}

/** An action in a conversation of one of the account's stores (step 4): `support:write` in that store, checked again here. */
export async function ownerSupportActAction(
  store: string,
  conversationId: string,
  raw: unknown,
): Promise<AgentActResult> {
  const w = adminText(await actionAdminLang(), "support").problems;
  const staff =
    typeof store === "string" ? await checkStoreDesk(store, "write") : null;
  if (!staff) return { ok: false, problem: w.noAccess };
  const act = readAct(raw);
  if (!act) return { ok: false, problem: w.cannot };
  return agentAct(staff, conversationId, act);
}
