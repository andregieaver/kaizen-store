import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf, type AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { FAILING_AFTER } from "@/lib/cron-health";
import { renderEmail, type RenderedEmail } from "@/lib/email-layout";
import { siteUrl } from "@/lib/site";

import { sendEmail } from "./email";
import { log } from "./log";

type Row = Record<string, unknown>;

/**
 * Tells Kaizena Flow's admins that a scheduled job turned failing (wave 11 unit J, D389; PSI REL-02): sent when its runs that ended in an
 * error reach `FAILING_AFTER` in a row, once per admin and turn (the email's key is the job and its last good run, so it comes again only
 * after the job has run well and failed again), in each admin's language, with the job's name, the count, when and the last error as the
 * ledger keeps it. Never throws: the platform home shows the job failing anyway.
 */
export async function alertFailingJob(job: string, facts: { failedAt: Date; lastOkAt: string | null; error: string | null }): Promise<void> {
  try {
    const admins = await db().execute<Row>(sql`
      select id, email, admin_locale from commerce.accounts where platform_admin and disabled_at is null and email <> ''
    `);
    const emails = new Map<AdminLang, RenderedEmail>();
    const emailIn = (lang: AdminLang) => {
      if (!emails.has(lang)) {
        const words = adminText(lang, "staffEmails");
        const w = words.jobFailing;
        const when = (at: Date) => at.toLocaleString(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });
        const values = {
          job,
          n: FAILING_AFTER,
          when: when(facts.failedAt),
          lastOk: facts.lastOkAt ? when(new Date(facts.lastOkAt)) : w.never,
          error: (facts.error ?? "").slice(0, 300) || "-",
        };
        emails.set(
          lang,
          renderEmail({
            subject: fillWords(w.subject, values),
            preview: fillWords(w.preview, values),
            lang: ADMIN_LANG_FACTS[lang].tag,
            footer: [words.footer],
            blocks: [
              { type: "heading", text: w.heading },
              { type: "paragraph", text: fillWords(w.body, values) },
              { type: "paragraph", text: w.after },
              { type: "button", text: w.button, url: `${siteUrl()}/admin/platform/capacity` },
            ],
          }),
        );
      }
      return emails.get(lang)!;
    };
    for (const admin of admins) {
      await sendEmail({
        storeId: null,
        kind: "platform.job_failing",
        to: String(admin.email),
        email: emailIn(adminLangOf(typeof admin.admin_locale === "string" ? admin.admin_locale : null)),
        fromName: "Kaizena Flow",
        idempotencyKey: `platform.job_failing:${job}:${facts.lastOkAt ?? "never"}:${String(admin.id)}`,
      });
    }
  } catch (error) {
    log("error", "cron.alert_failed", { job }, error);
  }
}
