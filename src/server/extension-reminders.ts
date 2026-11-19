import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { GRACE_DAYS } from "@/lib/account-billing";
import { adminDate, PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { STAFF_EMAILS_WORDS } from "@/lib/admin-words/staff-emails";
import { renderEmail } from "@/lib/email-layout";
import { TRIAL_REMINDER_DAYS, trialReminderDue } from "@/lib/extensions";
import { siteUrl } from "@/lib/site";

import { sendEmail } from "./email";
import { log } from "./log";
import { col, typedRows } from "./typed-rows";

/**
 * The emails before an extension's trial ends (D748 step E5 part two, `daily.extension-trials`): the account's owner is told 30, 14 and 3
 * days before (`trialReminderDue()`: only reminders shorter than the trial, so 3 days for a 14-day one), one email per account for the
 * trials that end together, in the owner's admin language. Each reminder's key is kept with the email, so a run again sends nothing twice.
 */

const DUE_ROW = z.object({
  organisation_id: col.uuid,
  name: col.text,
  created_at: col.timestamp,
  trial_ends_at: col.timestamp,
  owner_email: col.textOrNull,
  owner_locale: col.textOrNull,
});

/** Sends the reminders due at `now`; answers how many emails went out. */
export async function sendTrialReminders(now = new Date()): Promise<{ due: number; sent: number }> {
  const longest = Math.max(...TRIAL_REMINDER_DAYS);
  const rows = await typedRows(
    DUE_ROW,
    sql`
      select e.organisation_id, x.name, e.created_at, e.trial_ends_at, owner.email as owner_email, owner.admin_locale as owner_locale
        from commerce.organisation_extensions e
        join commerce.organisations o on o.id = e.organisation_id and not o.platform
        join commerce.extensions x on x.id = e.extension_id
        left join lateral (
          select a.email, a.admin_locale from commerce.organisation_members m join commerce.accounts a on a.id = m.account_id
           where m.organisation_id = o.id and m.role = 'owner' order by m.created_at limit 1
        ) owner on true
       where e.source = 'trial'
         and e.trial_ends_at > ${now.toISOString()}::timestamptz
         and e.trial_ends_at <= ${now.toISOString()}::timestamptz + make_interval(days => ${longest})
         and not (commerce.organisation_extension_facts(e.organisation_id) -> 'included') @> jsonb_build_array(e.extension_id)
       order by e.organisation_id, e.trial_ends_at, x.position, x.id
    `,
  );
  // One email per account, reminder and day the trials end.
  const groups = new Map<string, { row: (typeof rows)[number]; days: number; names: string[] }>();
  for (const row of rows) {
    const days = trialReminderDue(new Date(row.created_at), new Date(row.trial_ends_at), now);
    if (days === null || !row.owner_email) continue;
    const key = `extension-trial:${row.organisation_id}:${row.trial_ends_at.slice(0, 10)}:${days}`;
    const group = groups.get(key);
    if (group) group.names.push(row.name);
    else groups.set(key, { row, days, names: [row.name] });
  }
  let sent = 0;
  for (const [key, { row, days, names }] of groups) {
    const outcome = await remind(key, row, days, names);
    if (outcome === "sent" || outcome === "logged") sent += 1;
  }
  if (sent > 0) log("info", "extension_trials.reminded", { due: groups.size, sent });
  return { due: groups.size, sent };
}

/** One reminder: which trials end, when, and what keeping them or doing nothing means. */
async function remind(key: string, row: z.output<typeof DUE_ROW>, days: number, names: readonly string[]) {
  const lang = adminLangOf(row.owner_locale);
  const w = STAFF_EMAILS_WORDS[lang].extensionTrialEnding;
  const subject = fillWords(w.subject, { days: String(days) });
  const extensions = new Intl.ListFormat(ADMIN_LANG_FACTS[lang].locale, { type: "conjunction" }).format(names);
  const message = renderEmail({
    subject,
    preview: subject,
    lang: lang === "nb" ? "nb" : "en",
    footer: ["Kaizena Flow · kaizenaflow.com"],
    blocks: [
      { type: "heading", text: subject },
      { type: "paragraph", text: fillWords(w.ends, { extensions, date: adminDate(PLATFORM_TIME_ZONE, row.trial_ends_at, "long", lang) }) },
      { type: "paragraph", text: fillWords(w.keep, { grace: String(GRACE_DAYS) }) },
      { type: "paragraph", text: `${siteUrl()}/admin/account/extensions` },
    ],
  });
  return sendEmail({ storeId: null, kind: "billing.extension_trial_ending", to: row.owner_email!, email: message, fromName: "Kaizena Flow", idempotencyKey: key });
}
