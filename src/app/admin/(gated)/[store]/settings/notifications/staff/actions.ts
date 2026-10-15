"use server";

import { refresh } from "next/cache";

import { isStaffAlertEvent } from "@/lib/staff-alerts";
import { checkPermission } from "@/server/permissions";
import { saveStaffAlerts, sendStaffTest } from "@/server/staff-alerts";

const NOT_OWNER = "Only an owner chooses who gets staff alerts.";

/**
 * The staff alerts page's actions (wave 3, D238, `docs/wave-3-notifications.md` 2.4): the owner's alone (`owner`, as the page). `saveStaffAlerts()` checks
 * the owner, the members and what each may receive again, and writes the audit entry (counts, never addresses).
 */
export async function saveStaffAlertsAction(storeSlug: string, input: unknown): Promise<{ ok: boolean; message: string }> {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { ok: false, message: NOT_OWNER };
  const result = await saveStaffAlerts(member.store.id, input, member.account.id);
  if (!result.ok) return { ok: false, message: result.message };
  refresh();
  return { ok: true, message: "Saved." };
}

/** *Send a test* of one event's email to the owner's own address. */
export async function sendStaffTestAction(storeSlug: string, event: string): Promise<{ ok: boolean; message: string }> {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { ok: false, message: NOT_OWNER };
  if (!isStaffAlertEvent(event)) return { ok: false, message: "This is not a staff alert." };
  const result = await sendStaffTest(member.store.id, event, { id: member.account.id, email: member.account.email || null });
  if (!result.ok) return { ok: false, message: result.message };
  if (result.outcome === "logged") return { ok: true, message: "The test was written to the email log, but email is not set up here, so nothing was delivered." };
  return { ok: true, message: `A test was sent to ${member.account.email}.` };
}
