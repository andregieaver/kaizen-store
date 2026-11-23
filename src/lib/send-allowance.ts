/**
 * Email automation's send allowance and contact limit (D876, D748 section 10 and E10 part three), pure: each size holds so many contacts
 * and so many emails per contact a month, counted across the account's stores. Told at 80 %; at the limit new broadcasts wait until the
 * account moves up a size, while flows and order emails keep sending (the owner's choice, 23 November 2026).
 */

/** From this share of either, the owner is told the account is close. */
export const NEAR_PERCENT = 80;

export type SendAllowance = {
  /** People subscribed on the account's lists (each address once). */
  contacts: number;
  /** What the size holds; null is no limit. */
  contactsAllowed: number | null;
  /** Marketing emails (broadcasts and flows) sent this month across the account. */
  emails: number;
  /** The size's contacts times its emails per contact (or a platform admin's override); null is no limit. */
  emailsAllowed: number | null;
  /** The next size up and the contacts it holds (null: no limit), or null at the biggest. */
  next: { contacts: number | null } | null;
};

export type AllowanceVerdict = "fine" | "near" | "over";

/** Fine, near (at 80 % of either) or over (more contacts than the size holds, or every email of the month used). */
export function allowanceVerdict(a: SendAllowance): AllowanceVerdict {
  const contactsOver = a.contactsAllowed !== null && a.contacts > a.contactsAllowed;
  const emailsOver = a.emailsAllowed !== null && a.emails >= a.emailsAllowed;
  if (contactsOver || emailsOver) return "over";
  const near = (used: number, allowed: number | null) => allowed !== null && used * 100 >= allowed * NEAR_PERCENT;
  return near(a.contacts, a.contactsAllowed) || near(a.emails, a.emailsAllowed) ? "near" : "fine";
}

/**
 * Whether a broadcast to `recipients` people may start: never while the list holds more contacts than the size, nor when it would pass the
 * month's emails. The refusal names which, in English the marketing catalogue matches (`overContacts`, `overEmails`).
 */
export function broadcastRefusal(a: SendAllowance, recipients: number): string | null {
  if (a.contactsAllowed !== null && a.contacts > a.contactsAllowed) {
    return `Your list has ${a.contacts} contacts, and your email automation holds ${a.contactsAllowed}. New newsletters wait until you move up; flows and order emails keep sending.`;
  }
  if (a.emailsAllowed !== null && a.emails + recipients > a.emailsAllowed) {
    return `This would pass the ${a.emailsAllowed} marketing emails your email automation holds this month. New newsletters wait until you move up; flows and order emails keep sending.`;
  }
  return null;
}
