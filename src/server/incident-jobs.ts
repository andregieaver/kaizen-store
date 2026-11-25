import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { adminDay, PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { PLATFORM_WORDS } from "@/lib/admin-words/platform";
import { renderEmail } from "@/lib/email-layout";
import { digestDue } from "@/lib/incidents";
import { siteUrl } from "@/lib/site";
import { localNow } from "@/lib/staff-alerts";

import { jobReport } from "./cache-events";
import { sendEmail } from "./email";
import { keepIncidents, pruneIncidents, pushMorning } from "./incidents";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The dispatcher's `incidents` job (D895): the log's upkeep every run (claims past their time released, quiet fixes done), and once a day
 * from seven in Oslo, the day claimed in `platform_settings.incident_digest_last_day` first so it happens once: the summary emailed to each
 * platform admin in their language and the morning push (what waits for them, the night's proposals among them, the owner's answer of 20
 * November 2026), then closed entries and old runs past their 180 days pruned. Never throws; each part's error is reported and the others run.
 */
export async function runIncidentJobs(
  options: { now?: Date } = {},
): Promise<{ released: number; done: number; day: string | null; emailed: number; pruned: number }> {
  const report = jobReport();
  const now = options.now ?? new Date();
  let released = 0;
  let done = 0;
  let day: string | null = null;
  let pruned = 0;
  let emailed = 0;
  try {
    ({ released, done } = await keepIncidents());
  } catch (error) {
    report(error, "keep");
  }
  try {
    const setting = await typedRow(z.object({ last: col.textOrNull }), sql`select incident_digest_last_day::text as last from commerce.platform_settings limit 1`);
    const due = digestDue(setting?.last ?? null, localNow(now, PLATFORM_TIME_ZONE));
    if (due) {
      const claimed = await typedRow(
        z.object({ ok: col.bool }),
        sql`update commerce.platform_settings set incident_digest_last_day = ${due}::date
             where incident_digest_last_day is distinct from ${due}::date returning true as ok`,
      );
      if (claimed) {
        day = due;
        try {
          emailed = await sendDigest(due);
        } catch (error) {
          report(error, "digest");
        }
        pruned = await pruneIncidents();
      }
    }
  } catch (error) {
    report(error, "daily");
  }
  return { released, done, day, emailed, pruned };
}

/** How many titles a section of the summary lists before "and n more". */
const DIGEST_LINES = 8;

const digestRow = z.object({ title: col.text, section: z.enum(["fixed", "needs", "being_fixed", "new"]) });

/**
 * The daily summary (the owner's answer, 20 November 2026): fixed or done in the last 24 hours, what needs the owner, what is being fixed and
 * what is new, by title (the platform's own words, never a person's data). Every day, a quiet one in one line. Returns the emails sent.
 */
async function sendDigest(day: string): Promise<number> {
  const rows = await typedRows(
    digestRow,
    sql`
      select title, case
          when status in ('fixed', 'done') and coalesce(done_at, fixed_at) > now() - interval '24 hours' then 'fixed'
          when status in ('proposed', 'needs_owner') then 'needs'
          when status = 'claimed' then 'being_fixed'
          when first_seen_at > now() - interval '24 hours' and status in ('open', 'approved') then 'new'
        end as section
      from commerce.platform_incidents
      where (status in ('fixed', 'done') and coalesce(done_at, fixed_at) > now() - interval '24 hours')
         or status in ('proposed', 'needs_owner', 'claimed')
         or (first_seen_at > now() - interval '24 hours' and status in ('open', 'approved'))
      order by last_seen_at desc
      limit 400
    `,
  );
  const of = (section: z.output<typeof digestRow>["section"]) => rows.filter((r) => r.section === section).map((r) => r.title);
  const sections = { fixed: of("fixed"), needs: of("needs"), being_fixed: of("being_fixed"), new: of("new") };
  const recipients = await typedRows(
    z.object({ id: col.uuid, email: col.text, admin_locale: col.textOrNull }),
    sql`select id, email, admin_locale from commerce.accounts where platform_admin and disabled_at is null and email <> '' order by id`,
  );
  let sent = 0;
  for (const r of recipients) {
    const lang = adminLangOf(r.admin_locale);
    const w = PLATFORM_WORDS[lang].incidents.digest;
    const quiet = rows.length === 0;
    const list = (title: string, titles: string[]) =>
      titles.length === 0
        ? []
        : [
            { type: "heading" as const, text: title },
            ...titles.slice(0, DIGEST_LINES).map((text) => ({ type: "paragraph" as const, text: `• ${text}` })),
            ...(titles.length > DIGEST_LINES ? [{ type: "paragraph" as const, text: fillWords(w.more, { n: titles.length - DIGEST_LINES }) }] : []),
          ];
    const email = renderEmail({
      subject: quiet ? w.quietSubject : fillWords(w.subject, { fixed: sections.fixed.length, needs: sections.needs.length }),
      preview: w.preview,
      lang: ADMIN_LANG_FACTS[lang].tag,
      footer: [w.footer],
      blocks: [
        { type: "heading", text: fillWords(w.heading, { day: adminDay(day, "long", lang) }) },
        ...(quiet
          ? [{ type: "paragraph" as const, text: w.quiet }]
          : [
              ...list(w.needsTitle, sections.needs),
              ...list(w.fixedTitle, sections.fixed),
              ...list(w.beingFixedTitle, sections.being_fixed),
              ...list(w.newTitle, sections.new),
            ]),
        { type: "button", text: w.button, url: `${siteUrl()}/admin/platform/incidents` },
      ],
    });
    const outcome = await sendEmail({
      storeId: null,
      kind: "platform.incident_digest",
      to: r.email,
      email,
      fromName: "Kaizena Flow",
      idempotencyKey: `platform.incident_digest:${day}:${r.id}`,
    });
    if (outcome === "sent" || outcome === "logged") sent += 1;
  }
  await pushMorning(sections.needs.length);
  return sent;
}
