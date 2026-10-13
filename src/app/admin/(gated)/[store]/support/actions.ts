"use server";

import { checkPermission } from "@/server/permissions";
import { heartbeat, setPresence } from "@/server/support";
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
