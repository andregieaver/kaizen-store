"use server";

import { refresh } from "next/cache";

import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import type { NotificationsMessages } from "@/lib/admin-messages/notifications.en";
import { adminText } from "@/lib/admin-text";
import { ALERT_LABELS, isStaffAlertEvent, STAFF_ALERT_EVENTS } from "@/lib/staff-alerts";
import { actionAdminLang } from "@/server/admin-request-lang";
import type { Membership } from "@/server/auth";
import { checkPermission } from "@/server/permissions";
import { saveStaffAlerts, sendStaffTest } from "@/server/staff-alerts";

/** The words of a member's language, or of the request's before a member is known. */
const wordsOf = async (member: Membership | null) => adminText(member ? adminLangOf(member.account.adminLocale) : await actionAdminLang(), "notifications").staff;

/** A refusal of `saveStaffAlerts()` or `sendStaffTest()`, by its kind, in the person's words; one not known stays as written. */
function refusal(result: { problem: string; message: string }, w: NotificationsMessages["staff"]): string {
  const a = w.answers;
  if (result.problem === "not_allowed") {
    const m = /^(.*) cannot receive (.*) emails:/.exec(result.message);
    const event = m ? STAFF_ALERT_EVENTS.find((e) => ALERT_LABELS[e] === m[2]) : undefined;
    return m && event ? fillWords(a.notAllowed, { who: m[1], alert: w.alerts[event] }) : result.message;
  }
  if (result.message === "The store was not found.") return a.notFound;
  if (result.message === "Only an owner sends staff alert tests.") return a.notOwnerTest;
  const known: Record<string, string> = { not_owner: a.notOwner, not_member: a.notMember, no_contact: a.noContact, no_address: a.noAddress, limit: a.limit };
  return known[result.problem] ?? result.message;
}

/**
 * The staff alerts page's actions (wave 3, D238, `docs/wave-3-notifications.md` 2.4): the owner's alone (`owner`, as the page). `saveStaffAlerts()` checks
 * the owner, the members and what each may receive again, and writes the audit entry (counts, never addresses).
 */
export async function saveStaffAlertsAction(storeSlug: string, input: unknown): Promise<{ ok: boolean; message: string }> {
  const member = await checkPermission(storeSlug, "owner");
  const w = await wordsOf(member);
  if (!member) return { ok: false, message: w.answers.notOwner };
  const result = await saveStaffAlerts(member.store.id, input, member.account.id);
  if (!result.ok) return { ok: false, message: refusal(result, w) };
  refresh();
  return { ok: true, message: adminText(adminLangOf(member.account.adminLocale), "notifications").common.saved };
}

/** *Send a test* of one event's email to the owner's own address. */
export async function sendStaffTestAction(storeSlug: string, event: string): Promise<{ ok: boolean; message: string }> {
  const member = await checkPermission(storeSlug, "owner");
  const w = await wordsOf(member);
  if (!member) return { ok: false, message: w.answers.notOwner };
  if (!isStaffAlertEvent(event)) return { ok: false, message: w.answers.notAlert };
  const result = await sendStaffTest(member.store.id, event, { id: member.account.id, email: member.account.email || null });
  if (!result.ok) return { ok: false, message: refusal(result, w) };
  if (result.outcome === "logged") return { ok: true, message: w.answers.logged };
  return { ok: true, message: fillWords(w.answers.sentTo, { to: member.account.email }) };
}
