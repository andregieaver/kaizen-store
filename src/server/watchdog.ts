import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { PLATFORM_WORDS } from "@/lib/admin-words/platform";
import { STOPPED_AFTER_SECONDS, stoppedJobs } from "@/lib/cron-health";
import { renderEmail } from "@/lib/email-layout";
import { siteUrl } from "@/lib/site";

import { cronJobRows } from "./cron-runs";
import { sendEmail } from "./email";
import { log } from "./log";
import { col, typedRows } from "./typed-rows";

/**
 * The watcher outside the scheduler (bloat review step 1.22): Vercel's cron calls `/api/cron/watchdog` every fifteen minutes, which reads the
 * ledger's row of the five-minute dispatcher and, when it has finished no run for fifteen minutes, emails every platform admin. Every other
 * check runs from the scheduler itself and stops with it. This email is not opt-in (the briefing's setting does not reach it), and a stop that
 * lasts is told at most once every six hours per person (the key of each email). It runs no job and restarts nothing; never throws.
 */
export async function runWatchdog(now: Date = new Date()): Promise<{ stopped: string[]; sent: number }> {
  let stopped: ReturnType<typeof stoppedJobs> = [];
  let sent = 0;
  try {
    stopped = stoppedJobs(await cronJobRows(), now);
    if (stopped.length === 0) return { stopped: [], sent: 0 };
    const recipients = await typedRows(
      z.object({ id: col.uuid, email: col.text, admin_locale: col.textOrNull }),
      sql`select id, email, admin_locale from commerce.accounts where platform_admin and disabled_at is null and email <> '' order by id`,
    );
    const minutes = Math.max(STOPPED_AFTER_SECONDS / 60, ...stopped.map((s) => s.minutes ?? 0));
    const window = `${now.toISOString().slice(0, 10)}:${Math.floor(now.getUTCHours() / 6)}`;
    for (const r of recipients) {
      const lang = adminLangOf(r.admin_locale);
      const w = PLATFORM_WORDS[lang].watchdog;
      const email = renderEmail({
        subject: w.subject,
        preview: fillWords(w.preview, { minutes }),
        lang: ADMIN_LANG_FACTS[lang].tag,
        footer: [w.footer],
        blocks: [
          { type: "heading", text: w.heading },
          { type: "paragraph", text: w.body },
          ...stopped.map((s) => ({ type: "paragraph" as const, text: s.minutes === null ? fillWords(w.never, { job: s.job }) : fillWords(w.job, { job: s.job, minutes: s.minutes }) })),
          { type: "button", text: w.button, url: `${siteUrl()}/admin/platform/capacity` },
        ],
      });
      const outcome = await sendEmail({
        storeId: null,
        kind: "platform.watchdog",
        to: r.email,
        email,
        fromName: "Kaizena Flow",
        idempotencyKey: `platform.watchdog:${stopped.map((s) => s.job).join(",")}:${window}:${r.id}`,
      });
      if (outcome === "sent" || outcome === "logged") sent += 1;
    }
  } catch (error) {
    log("error", "watchdog.failed", {}, error);
  }
  return { stopped: stopped.map((s) => s.job), sent };
}
