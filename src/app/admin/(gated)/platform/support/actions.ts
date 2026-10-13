"use server";

import { heartbeat, setPresence } from "@/server/support";
import { checkKaizenDesk } from "@/server/support-desk";

/** Kaizen's desk's presence (D216): online or away, and the open inbox's heartbeat, for platform admins. */

export async function kaizenSupportPresenceAction(status: "online" | "away"): Promise<{ ok: boolean }> {
  const desk = await checkKaizenDesk();
  if (!desk || (status !== "online" && status !== "away")) return { ok: false };
  await setPresence([desk.desk], desk.account.id, status);
  return { ok: true };
}

export async function kaizenSupportHeartbeatAction(): Promise<{ ok: boolean }> {
  const desk = await checkKaizenDesk();
  if (!desk) return { ok: false };
  await heartbeat([desk.desk], desk.account.id);
  return { ok: true };
}
