import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { PROJECT_LIMITS } from "@/lib/projects-model";
import { fillWords } from "@/lib/admin-fill";
import { storeExtensionOn } from "@/lib/extensions";
import type { PermissionKey } from "@/lib/permission-keys";
import { SOURCE_COLUMNS, SOURCE_KINDS, sourcePath, type SourceKind, type TaskSource } from "@/lib/projects-sources";
import { featureOn } from "@/lib/store-features";

import type { Membership } from "./auth";
import { memberCan } from "./permissions";
import type { ProjectsResult } from "./projects-errors";
import { addItem } from "./projects-items";
import { createChecklist } from "./projects-lists";
import { uuidList } from "./sql-arrays";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Tasks from an order, a return, a review or a support conversation (D904, `docs/projects.md` P8.3a): what a source's page shows and makes,
 * and what a task says of where it came from. The database holds the links (`checklist_items` and its rules migration); the pages show this
 * only while both arms are there (`sourceArmOn()`, `projectsOn()`).
 */

const TASK_ROW = z.object({
  id: col.uuid,
  title: col.text,
  done: col.bool,
  checklist_id: col.uuid,
  list_title: col.text,
});
const LIST_ROW = z.object({ id: col.uuid, title: col.text });

export type SourceTask = { id: string; title: string; done: boolean; checklistId: string; listTitle: string };
export type SourceTasks = { tasks: SourceTask[]; lists: { id: string; title: string }[] };

/** How many of a source's tasks its page shows, and how many lists it offers to put a new one in. */
const SHOWN = 20;
const LISTS = 50;

/** A source's tasks, open ones first, and the store's open lists a new one may go to, most recently changed first. */
export async function sourceTasks(storeId: string, source: TaskSource): Promise<SourceTasks> {
  const column = sql.identifier(SOURCE_COLUMNS[source.kind]);
  const [tasks, lists] = await Promise.all([
    typedRows(
      TASK_ROW,
      sql`
        select i.id, i.title, i.done_at is not null as done, i.checklist_id, l.title as list_title
          from commerce.checklist_items i
          join commerce.checklists l on l.store_id = i.store_id and l.id = i.checklist_id
         where i.store_id = ${storeId}::uuid and i.${column} = ${source.id}::uuid and i.archived_at is null
         order by i.done_at is not null, i.created_at
         limit ${SHOWN}
      `,
    ),
    typedRows(
      LIST_ROW,
      sql`
        select id, title from commerce.checklists
         where store_id = ${storeId}::uuid and status = 'open' and not as_template
         order by updated_at desc
         limit ${LISTS}
      `,
    ),
  ]);
  return {
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, done: t.done, checklistId: t.checklist_id, listTitle: t.list_title })),
    lists,
  };
}

const LABEL_ROW = z.object({ kind: z.enum(SOURCE_KINDS), id: col.uuid, label: col.textOrNull });

/**
 * What each source of a list's tasks is called, by `{kind}:{id}`: an order's or a return's number, a review's author, the name a conversation's
 * customer gave (none when they gave none). One statement, and none when no task has a source; a source that is gone is simply not there.
 */
export async function sourceLabels(storeId: string, sources: readonly TaskSource[]): Promise<Map<string, string | null>> {
  const found = new Map<string, string | null>();
  if (sources.length === 0) return found;
  const ids = (kind: SourceKind) => uuidList([...new Set(sources.filter((s) => s.kind === kind).map((s) => s.id))]);
  const rows = await typedRows(
    LABEL_ROW,
    sql`
      select 'order' as kind, o.id, o.number as label from commerce.orders o where o.store_id = ${storeId}::uuid and o.id = any(${ids("order")})
      union all
      select 'return', r.id, r.number from commerce.returns r where r.store_id = ${storeId}::uuid and r.id = any(${ids("return")})
      union all
      select 'review', v.id, v.author_name from commerce.product_reviews v where v.store_id = ${storeId}::uuid and v.id = any(${ids("review")})
      union all
      select 'conversation', c.id, c.contact_name from commerce.support_conversations c
       where c.store_id = ${storeId}::uuid and c.id = any(${ids("conversation")})
    `,
  );
  for (const row of rows) found.set(`${row.kind}:${row.id}`, row.label);
  return found;
}

/** A task from a source: its title, and the list it goes to (none: the store's list for follow-ups, made on first use). */
export const sourceTaskInput = z.object({
  kind: z.enum(SOURCE_KINDS),
  sourceId: z.uuid(),
  title: z.string().trim().min(1).max(PROJECT_LIMITS.itemTitle),
  checklistId: z.uuid().nullable(),
});
export type SourceTaskInput = z.infer<typeof sourceTaskInput>;

/**
 * Makes a task from a source, linked to it, at the end of the chosen list; with no list chosen, in the store's open list named
 * `followUps` (the person's words for it), made the first time. The source must be the store's: the database refuses another's.
 */
export async function addSourceTask(member: Membership, raw: unknown, followUps: string): Promise<ProjectsResult<{ id: string }>> {
  if (!memberCan(member, "projects:write")) return { ok: false, problem: "forbidden" };
  const input = sourceTaskInput.safeParse(raw);
  if (!input.success) return { ok: false, problem: "invalid", fields: ["title"] };
  const { kind, sourceId, title } = input.data;
  let checklistId = input.data.checklistId;
  if (!checklistId) {
    const kept = await typedRow(
      z.object({ id: col.uuid }),
      sql`
        select id from commerce.checklists
         where store_id = ${member.store.id}::uuid and title = ${followUps} and status = 'open' and not as_template
         order by created_at limit 1
      `,
    );
    if (kept) checklistId = kept.id;
    else {
      const made = await createChecklist(member, { title: followUps });
      if (!made.ok) return made;
      checklistId = made.id;
    }
  }
  return addItem(member, checklistId, { title }, { kind, id: sourceId });
}

/** The right a person needs to open each kind of source's page, and whether its own arm is there for the store. */
const SOURCE_RIGHT: Record<SourceKind, PermissionKey> = { order: "orders:read", return: "orders:read", review: "products:read", conversation: "support:read" };
const armOn = (store: { features: readonly string[]; extensionFacts?: unknown }, kind: SourceKind): boolean =>
  kind === "review" ? featureOn(store, "reviews") : kind === "conversation" ? storeExtensionOn(store, "support_desk") : true;

/**
 * A list's links back to where its tasks came from (P8.3a), by task: `{text, href}` in the member's words, only for a source whose arm the
 * store has and whose page the member may open; the rest show nothing. One statement for the labels, none when no task has a source.
 */
export async function sourceLinks(
  member: Membership,
  tasks: readonly { id: string; source: TaskSource | null }[],
  words: { order: string; return: string; review: string; conversation: string; conversationUnnamed: string },
): Promise<Record<string, { text: string; href: string }>> {
  const shown = tasks.filter((t): t is { id: string; source: TaskSource } => t.source !== null && armOn(member.store, t.source.kind) && memberCan(member, SOURCE_RIGHT[t.source.kind]));
  if (shown.length === 0) return {};
  const labels = await sourceLabels(member.store.id, shown.map((t) => t.source));
  const links: Record<string, { text: string; href: string }> = {};
  for (const { id, source } of shown) {
    const key = `${source.kind}:${source.id}`;
    if (!labels.has(key)) continue;
    const label = labels.get(key) ?? null;
    const text = source.kind === "conversation" && !label ? words.conversationUnnamed : fillWords(words[source.kind], { label: label ?? "" });
    links[id] = { text, href: `/admin/${member.store.slug}${sourcePath(source)}` };
  }
  return links;
}
