import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf, type AdminLang } from "@/lib/admin-lang";
import { PROJECT_SOURCES_WORDS } from "@/lib/admin-words/project-sources";
import { renderEmail, type RenderedEmail } from "@/lib/email-layout";
import { permissionsOf } from "@/lib/permissions";
import { siteUrl } from "@/lib/site";

import { jobReport } from "./cache-events";
import { sendEmail } from "./email";
import { uuidList } from "./sql-arrays";
import { col, typedRows } from "./typed-rows";

/**
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
function mayRead(t: Told): boolean {
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
