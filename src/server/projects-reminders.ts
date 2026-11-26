import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { PROJECT_LIMITS, REMINDER_CHANNELS, type ReminderChannel } from "@/lib/projects-model";
import { anchored, nextOccurrence, type Recurrence } from "@/lib/projects-recurrence";
import { parseRecurrence, recurrence as recurrenceRule } from "@/lib/projects-recurrence-schema";

import type { Membership } from "./auth";
import { memberCan } from "./permissions";
import { projectsGuard, type ProjectsResult } from "./projects-errors";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Reminders (D903, `docs/projects.md` P4.3, Life's item and list reminders in one table): on a task, at a moment or so long before its due
 * time, and on a list, at a moment or repeating by a task's rule (P4.1). Written by members who may change projects; each goes to the task's
 * or the list's person, or to whoever set it when there is none, by email, on their devices or both (`runTaskReminders()` in
 * `projects-notices.ts`). A reminder before a due time is armed by the database from the task's due time, and again when it moves.
 */

export type ReminderView = {
  id: string;
  remindAt: string | null;
  offsetMinutes: number | null;
  recurrence: Recurrence | null;
  channels: ReminderChannel[];
  nextAt: string | null;
};

const ROW = z.object({
  id: col.uuid,
  item_id: col.uuid.nullable(),
  remind_at: col.timestampOrNull,
  offset_minutes: col.int.nullable(),
  recurrence: z.unknown(),
  channels: z.array(z.enum(REMINDER_CHANNELS)),
  next_at: col.timestampOrNull,
});

const view = (r: z.output<typeof ROW>): ReminderView => ({
  id: r.id,
  remindAt: r.remind_at,
  offsetMinutes: r.offset_minutes,
  recurrence: parseRecurrence(r.recurrence),
  channels: r.channels,
  nextAt: r.next_at,
});

/** A list's reminders and its tasks' reminders, oldest first. */
export async function remindersOf(storeId: string, checklistId: string): Promise<{ list: ReminderView[]; items: Record<string, ReminderView[]> }> {
  const rows = await typedRows(
    ROW,
    sql`
      select r.id, r.item_id, r.remind_at, r.offset_minutes, r.recurrence, r.channels, r.next_at
      from commerce.checklist_reminders r
      where r.store_id = ${storeId}::uuid
        and (r.checklist_id = ${checklistId}::uuid
             or r.item_id in (select i.id from commerce.checklist_items i where i.store_id = ${storeId}::uuid and i.checklist_id = ${checklistId}::uuid))
      order by r.created_at, r.id
      limit 1000
    `,
  );
  const items: Record<string, ReminderView[]> = {};
  const list: ReminderView[] = [];
  for (const row of rows) {
    if (row.item_id) (items[row.item_id] ??= []).push(view(row));
    else list.push(view(row));
  }
  return { list, items };
}

/** A reminder as a screen sends it: on a task or a list, at a moment, before the task's due time or repeating, and how it is sent. */
export const reminderInput = z
  .object({
    itemId: z.uuid().nullable().default(null),
    checklistId: z.uuid().nullable().default(null),
    remindAt: z.iso.datetime({ offset: true }).nullable().default(null),
    offsetMinutes: z.int().min(0).max(PROJECT_LIMITS.reminderOffset).nullable().default(null),
    recurrence: recurrenceRule.nullable().default(null),
    /** A repeating reminder's first day: it comes no earlier than this (not kept; its rule is). */
    startsAt: z.iso.datetime({ offset: true }).nullable().default(null),
    channels: z.array(z.enum(REMINDER_CHANNELS)).min(1).max(REMINDER_CHANNELS.length),
  })
  .refine((r) => (r.itemId === null) !== (r.checklistId === null), { path: ["form"] })
  .refine((r) => [r.remindAt, r.offsetMinutes, r.recurrence].filter((v) => v !== null).length === 1, { path: ["remindAt"] })
  .refine((r) => r.offsetMinutes === null || r.itemId !== null, { path: ["offsetMinutes"] })
  .refine((r) => r.recurrence === null || r.checklistId !== null, { path: ["recurrence"] });

/** A minute's grace: a moment typed for now is not refused by the time it is saved. */
const GRACE_MS = 60_000;

/**
 * A reminder added. A moment must not have passed; a repeating one starts at its rule's next time in the store's zone (counted from today
 * where the rule counts days); a task or a list has at most five.
 */
export async function addReminder(member: Membership, raw: unknown, now = Date.now()): Promise<ProjectsResult<{ id: string }>> {
  if (!memberCan(member, "projects:write")) return { ok: false, problem: "forbidden" };
  const parsed = reminderInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: "invalid", fields: [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "form")))] };
  const input = parsed.data;
  const storeId = member.store.id;
  if (input.remindAt && Date.parse(input.remindAt) < now - GRACE_MS) return { ok: false, problem: "invalid", fields: ["remindAt"] };
  const rule = input.recurrence ? anchored(input.recurrence, now, member.store.timeZone) : null;
  // From its first day on: a minute before it, so a rule that falls on that day at that time starts there.
  const from = input.startsAt ? Math.max(now, Date.parse(input.startsAt) - GRACE_MS) : now;
  const first = rule ? nextOccurrence(rule, from, member.store.timeZone) : null;
  if (rule && !first) return { ok: false, problem: "invalid", fields: ["recurrence"] };
  const target = input.itemId ? sql`item_id = ${input.itemId}::uuid` : sql`checklist_id = ${input.checklistId}::uuid`;
  const held = await typedRow(z.object({ n: col.int }), sql`select count(*)::int as n from commerce.checklist_reminders where store_id = ${storeId}::uuid and ${target}`);
  if ((held?.n ?? 0) >= PROJECT_LIMITS.reminders) return { ok: false, problem: "invalid", fields: ["reminders"] };
  // A reminder before a due time is armed by the database (`checklist_reminders_next`); the others here.
  const nextAt = input.remindAt ? new Date(input.remindAt) : first;
  return projectsGuard(async () => {
    const made = await typedRow(
      z.object({ id: col.uuid }),
      sql`
        insert into commerce.checklist_reminders (store_id, item_id, checklist_id, remind_at, offset_minutes, recurrence, channels, next_at, created_by)
        values (${storeId}::uuid, ${input.itemId}::uuid, ${input.checklistId}::uuid, ${input.remindAt ? new Date(input.remindAt) : null}, ${input.offsetMinutes},
                ${rule ? sql`${JSON.stringify(rule)}::jsonb` : null}, array[${sql.join(input.channels.map((c) => sql`${c}`), sql`, `)}]::text[], ${nextAt}, ${member.account.id}::uuid)
        returning id
      `,
    );
    return made ? { ok: true, id: made.id } : { ok: false, problem: "invalid" };
  });
}

/** A reminder taken off. */
export async function deleteReminder(member: Membership, id: string): Promise<ProjectsResult> {
  if (!memberCan(member, "projects:write")) return { ok: false, problem: "forbidden" };
  const gone = await typedRows(
    z.object({ id: col.uuid }),
    sql`delete from commerce.checklist_reminders where store_id = ${member.store.id}::uuid and id = ${id}::uuid returning id`,
  );
  return gone.length > 0 ? { ok: true } : { ok: false, problem: "not_found" };
}
