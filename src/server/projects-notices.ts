import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { adminDate } from "@/lib/admin-date";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf, type AdminLang } from "@/lib/admin-lang";
import { PROJECT_SOURCES_WORDS } from "@/lib/admin-words/project-sources";
import { renderEmail, type RenderedEmail } from "@/lib/email-layout";
import { permissionsOf } from "@/lib/permissions";
import { nextOccurrence } from "@/lib/projects-recurrence";
import { parseRecurrence } from "@/lib/projects-recurrence-schema";
import { siteUrl } from "@/lib/site";

import { jobReport } from "./cache-events";
import { db } from "@/db/client";
import { sendEmail } from "./email";
import { sendProjectsPush, type ProjectsPushBuild } from "./push";
import { uuidList } from "./sql-arrays";
import { col, typedRows } from "./typed-rows";

/**
 * Projects' notices to a store's team: a task's person told it is theirs, and reminders (P4.3, at the foot).
 *
 * A task's person told by email that it is theirs (D904, `docs/projects.md` P8.3d): the five-minute dispatcher's `projects_assigned` job.
 * The item writers mark who gave a task its person and when (`assigned_by`, `assigned_at`); each such task is claimed once
 * (`assignee_told_at`) two minutes after, so a person chosen by mistake and changed at once is never told, and its person gets one email a
 * run for all their new tasks in a store, in their own admin language: each task's title and list, who gave it, and a link.
 *
 * Told only when someone else gave it (taking a task yourself tells nobody), the task is still open, the store has Projects (the feature
 * and the extension) and is open, and the person is still on the team with the right to read projects and has an address. A task passed
 * over is claimed all the same, so the job's partial index holds only what is still to be told.
 */

const SETTLE_MINUTES = 2;
const PER_RUN = 200;
const STALE_HOURS = 24;
const LINES_PER_EMAIL = 10;

const CLAIMED = z.object({ id: col.uuid });
const TOLD = z.object({
  id: col.uuid,
  store_id: col.uuid,
  slug: col.text,
  store_name: col.text,
  title: col.text,
  checklist_id: col.uuid,
  list_title: col.text,
  account_id: col.uuid,
  email: col.text,
  admin_locale: col.textOrNull,
  owner: col.bool,
  kind: col.textOrNull,
  role_id: col.uuid.nullable(),
  permissions: z.array(z.string()).nullable(),
  giver: col.text,
});
type Told = z.output<typeof TOLD>;

/** The email for one person's new tasks in one store. */
export function taskAssignedEmail(tasks: readonly Told[], lang: AdminLang): RenderedEmail {
  const w = PROJECT_SOURCES_WORDS[lang].assignedEmail;
  const first = tasks[0];
  const store = first.store_name;
  const n = tasks.length;
  const base = `${siteUrl()}/admin/${first.slug}`;
  const shown = tasks.slice(0, LINES_PER_EMAIL);
  return renderEmail({
    subject: n === 1 ? fillWords(w.subjectOne, { giver: first.giver, title: first.title }) : fillWords(w.subjectMany, { n, store }),
    preview: countWords(n, { one: fillWords(w.preview.one, { store }), many: fillWords(w.preview.many, { store }) }),
    lang: ADMIN_LANG_FACTS[lang].tag,
    footer: [store, "Kaizena Flow"],
    blocks: [
      { type: "heading", text: countWords(n, w.heading) },
      ...shown.map((t) => ({ type: "paragraph" as const, text: fillWords(w.line, { title: t.title, list: t.list_title, giver: t.giver }) })),
      n === 1
        ? { type: "button" as const, text: w.buttonOne, url: `${base}/checklists/${first.checklist_id}` }
        : { type: "button" as const, text: w.buttonMany, url: `${base}/checklists?view=tasks` },
      { type: "paragraph", text: fillWords(w.why, { store }) },
    ],
  });
}

/** The tasks given more than two minutes ago and not yet told, claimed so two runs never both take one. */
async function claim(now: Date): Promise<string[]> {
  const rows = await typedRows(
    CLAIMED,
    sql`
      update commerce.checklist_items i set assignee_told_at = ${now.toISOString()}::timestamptz
      where i.id in (
        select id from commerce.checklist_items
        where assigned_at is not null and assignee_told_at is null
          and assigned_at <= ${now.toISOString()}::timestamptz - make_interval(mins => ${SETTLE_MINUTES})
        order by assigned_at limit ${PER_RUN}
        for update skip locked
      )
      returning i.id
    `,
  );
  return rows.map((r) => r.id);
}

/** Of the tasks claimed, those whose person is to be told, with what the email says. */
async function toTell(ids: readonly string[], now: Date): Promise<Told[]> {
  if (ids.length === 0) return [];
  return typedRows(
    TOLD,
    sql`
      select i.id, i.store_id, s.slug, s.name as store_name, i.title, c.id as checklist_id, c.title as list_title,
        a.id as account_id, a.email, a.admin_locale, m.role = 'owner' as owner, m.kind, m.role_id, r.permissions,
        coalesce(nullif(trim(g.name), ''), g.email) as giver
      from commerce.checklist_items i
      join commerce.checklists c on c.store_id = i.store_id and c.id = i.checklist_id
      join commerce.stores s on s.id = i.store_id
      join commerce.accounts a on a.id = i.assigned_to and a.disabled_at is null and a.email <> ''
      join commerce.accounts g on g.id = i.assigned_by
      join commerce.store_members m on m.store_id = i.store_id and m.account_id = a.id
        and m.disabled_at is null and (m.expires_at is null or m.expires_at > now())
      left join commerce.store_roles r on r.store_id = m.store_id and r.id = m.role_id
      where i.id = any(${uuidList(ids)})
        and i.assigned_to <> i.assigned_by and i.done_at is null and i.archived_at is null
        and i.assigned_at > ${now.toISOString()}::timestamptz - make_interval(hours => ${STALE_HOURS})
        and 'projects' = any(s.features) and commerce.extension_on(s.id, 'projects') and commerce.store_is_active(s.id)
      order by i.assigned_at
    `,
  );
}

/** The person may read projects in the store: the same arithmetic as `memberCan()`. */
function mayRead(t: Pick<Told, "owner" | "kind" | "role_id" | "permissions">): boolean {
  const holder = {
    role: t.owner ? ("owner" as const) : ("admin" as const),
    kind: t.kind === "collaborator" ? ("collaborator" as const) : ("staff" as const),
    permissions: t.role_id ? (t.permissions ?? []) : null,
  };
  return permissionsOf(holder).includes("projects:read");
}

/**
 * The dispatcher's `projects_assigned` job: claims the tasks due to be told, and emails each person their new tasks, store by store.
 * Never throws; returns how many emails were sent.
 */
export async function runTaskAssignedEmails(now: Date = new Date(), send: typeof sendEmail = sendEmail): Promise<number> {
  const report = jobReport();
  let sent = 0;
  try {
    const tasks = (await toTell(await claim(now), now)).filter(mayRead);
    const groups = new Map<string, Told[]>();
    for (const t of tasks) groups.set(`${t.store_id}:${t.account_id}`, [...(groups.get(`${t.store_id}:${t.account_id}`) ?? []), t]);
    for (const group of groups.values()) {
      const first = group[0];
      try {
        const lang = adminLangOf(first.admin_locale);
        const outcome = await send({
          storeId: first.store_id,
          kind: "staff.task_assigned",
          to: first.email,
          email: taskAssignedEmail(group, lang),
          fromName: "Kaizena Flow",
          idempotencyKey: `task-assigned:${first.account_id}:${group.map((t) => t.id).sort()[0]}`,
        });
        if (outcome === "sent" || outcome === "logged") sent += 1;
      } catch (error) {
        report(error, "send");
      }
    }
  } catch (error) {
    report(error, "claim");
  }
  return sent;
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Reminders (P4.3)
// ---------------------------------------------------------------------------------------------------------------------------------------

/** A reminder a day late is not sent: the run that should have sent it failed, and the moment is gone. */
const REMINDER_STALE_MS = 24 * 3600_000;

const CLAIMED_REMINDER = z.object({ id: col.uuid, recurrence: z.unknown(), was: col.timestamp });
const REMINDER = z.object({
  id: col.uuid,
  store_id: col.uuid,
  slug: col.text,
  store_name: col.text,
  time_zone: col.text,
  item_title: col.textOrNull,
  due_at: col.timestampOrNull,
  all_day: col.bool.nullable(),
  closed: col.bool,
  list_id: col.uuid,
  list_title: col.text,
  list_open: col.bool,
  open_tasks: col.int,
  channels: z.array(z.string()),
  account_id: col.uuid,
  email: col.text,
  admin_locale: col.textOrNull,
  owner: col.bool,
  kind: col.textOrNull,
  role_id: col.uuid.nullable(),
  permissions: z.array(z.string()).nullable(),
});
export type ReminderFacts = z.output<typeof REMINDER>;

/** The reminders whose time has come, claimed so two runs never both send one: each cleared, a repeating one moved on below. */
async function claimReminders(now: Date): Promise<z.output<typeof CLAIMED_REMINDER>[]> {
  return typedRows(
    CLAIMED_REMINDER,
    sql`
      with due as (
        select id, next_at from commerce.checklist_reminders
        where next_at <= ${now.toISOString()}::timestamptz
        order by next_at limit ${PER_RUN}
        for update skip locked
      )
      update commerce.checklist_reminders r set next_at = null, fired_at = ${now.toISOString()}::timestamptz
      from due where r.id = due.id
      returning r.id, r.recurrence, due.next_at as was
    `,
  );
}

/** What each claimed reminder says and to whom: the task's or the list's person, or whoever set it, while the store has Projects. */
async function reminderFacts(ids: readonly string[]): Promise<ReminderFacts[]> {
  if (ids.length === 0) return [];
  return typedRows(
    REMINDER,
    sql`
      select r.id, r.store_id, s.slug, s.name as store_name, s.time_zone, i.title as item_title, i.due_at, i.all_day,
        (i.id is not null and (i.done_at is not null or i.archived_at is not null)) as closed,
        c.id as list_id, c.title as list_title, c.status = 'open' as list_open,
        (select count(*) from commerce.checklist_items x
          where x.store_id = c.store_id and x.checklist_id = c.id and x.done_at is null and x.archived_at is null)::int as open_tasks,
        r.channels, a.id as account_id, a.email, a.admin_locale, m.role = 'owner' as owner, m.kind, m.role_id, ro.permissions
      from commerce.checklist_reminders r
      join commerce.stores s on s.id = r.store_id
      left join commerce.checklist_items i on i.store_id = r.store_id and i.id = r.item_id
      join commerce.checklists c on c.store_id = r.store_id and c.id = coalesce(r.checklist_id, i.checklist_id)
      join commerce.accounts a on a.id = coalesce(case when r.item_id is not null then i.assigned_to else c.assigned_to end, r.created_by)
        and a.disabled_at is null
      join commerce.store_members m on m.store_id = r.store_id and m.account_id = a.id
        and m.disabled_at is null and (m.expires_at is null or m.expires_at > now())
      left join commerce.store_roles ro on ro.store_id = m.store_id and ro.id = m.role_id
      where r.id = any(${uuidList(ids)})
        and 'projects' = any(s.features) and commerce.extension_on(s.id, 'projects') and commerce.store_is_active(s.id)
    `,
  );
}

/** A reminder's email in the person's language: the task and its list, when it is due, or how many tasks the list has open. */
export function reminderEmail(f: ReminderFacts, lang: AdminLang): RenderedEmail {
  const w = PROJECT_SOURCES_WORDS[lang].reminderEmail;
  const store = f.store_name;
  const task = f.item_title;
  const lines: string[] = task
    ? [
        fillWords(w.task, { title: task, list: f.list_title }),
        ...(f.due_at ? [fillWords(w.due, { when: adminDate(f.time_zone, f.due_at, f.all_day ? "day" : "dayTime", lang) })] : []),
      ]
    : [countWords(f.open_tasks, { one: fillWords(w.list.one, { list: f.list_title }), many: fillWords(w.list.many, { list: f.list_title }) })];
  return renderEmail({
    subject: task ? fillWords(w.subjectTask, { title: task }) : fillWords(w.subjectList, { list: f.list_title }),
    preview: lines[0],
    lang: ADMIN_LANG_FACTS[lang].tag,
    footer: [store, "Kaizena Flow"],
    blocks: [
      { type: "heading", text: task ?? f.list_title },
      ...lines.map((text) => ({ type: "paragraph" as const, text })),
      { type: "button", text: w.button, url: `${siteUrl()}/admin/${f.slug}/checklists/${f.list_id}` },
      { type: "paragraph", text: fillWords(w.why, { store }) },
    ],
  });
}

/**
 * The dispatcher's `projectsReminders` job (P4.3): each reminder whose time has come is claimed, a repeating one moved to its rule's next
 * time in the store's zone, and its person told by email and on their devices as it was set. A reminder of a task done or archived, of a
 * list no longer open, a day late, or for someone who may no longer read projects is passed over. Never throws; returns how many people
 * were told.
 */
export async function runTaskReminders(
  now: Date = new Date(),
  send: typeof sendEmail = sendEmail,
  push: (storeId: string, accountId: string, build: ProjectsPushBuild, topic: string) => Promise<number> = sendProjectsPush,
): Promise<number> {
  const report = jobReport();
  let told = 0;
  try {
    const claimed = await claimReminders(now);
    const facts = new Map((await reminderFacts(claimed.map((c) => c.id))).map((f) => [f.id, f]));
    for (const c of claimed) {
      const f = facts.get(c.id);
      try {
        // A repeating reminder of a list still open comes again at its rule's next time, sent or not.
        const rule = parseRecurrence(c.recurrence);
        if (rule && f?.list_open) {
          const next = nextOccurrence(rule, now.getTime(), f.time_zone);
          if (next) await db().execute(sql`update commerce.checklist_reminders set next_at = ${next} where id = ${c.id}::uuid and next_at is null`);
        }
        if (!f || f.closed || !f.list_open || Date.parse(c.was) < now.getTime() - REMINDER_STALE_MS || !mayRead(f)) continue;
        const lang = adminLangOf(f.admin_locale);
        let reached = false;
        if (f.channels.includes("email") && f.email) {
          const outcome = await send({
            storeId: f.store_id,
            kind: "staff.task_reminder",
            to: f.email,
            email: reminderEmail(f, lang),
            fromName: "Kaizena Flow",
            idempotencyKey: `task-reminder:${c.id}:${c.was}`,
          });
          reached ||= outcome === "sent" || outcome === "logged";
        }
        if (f.channels.includes("push")) {
          const words = (l: AdminLang) => PROJECT_SOURCES_WORDS[l].reminderEmail;
          const build: ProjectsPushBuild = (store, l) => ({
            title: f.item_title ? fillWords(words(l).subjectTask, { title: f.item_title }) : fillWords(words(l).subjectList, { list: f.list_title }),
            body: f.item_title ? `${f.list_title} · ${store.name}` : store.name,
            url: `${siteUrl()}/admin/${store.slug}/checklists/${f.list_id}`,
            tag: `reminder-${c.id}`,
          });
          reached = (await push(f.store_id, f.account_id, build, `r${c.id.replaceAll("-", "").slice(0, 30)}`)) > 0 || reached;
        }
        if (reached) told += 1;
      } catch (error) {
        report(error, "reminder");
      }
    }
  } catch (error) {
    report(error, "claim_reminders");
  }
  return told;
}
