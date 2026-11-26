/**
 * The changes a projects or checklists screen sends (D903): one typed operation each, checked here whatever a stale page or a hand-made
 * request sends, run by `runProjectsOp()` (`src/server/projects-ops.ts`) and answered in the person's words by the area's one action. Pure.
 */

import { z } from "zod";

import { checklistInput, itemFields, projectInput, statusInput, subtaskInput } from "./projects";
import { ADVANCED_FEATURES } from "./projects-features";

const id = z.uuid();
const ids = z.array(z.uuid()).min(1).max(500);
const scope = z.uuid().nullable();
const kind = z.enum(["checklist", "project"]);
const features = z.partialRecord(z.enum(ADVANCED_FEATURES), z.boolean());

const instantOrNone = z.iso.datetime({ offset: true }).nullable();

/** What a tick or a skip changed, as the screen saw it before (P4.1): given back by its Undo. */
export const itemMoment = z.object({
  doneAt: instantOrNone,
  skippedAt: instantOrNone,
  lastCompletedAt: instantOrNone,
  nextDueAt: instantOrNone,
  streak: z.int().min(0).max(100_000),
  sortOrder: z.int().min(0).max(1_000_000),
  statusId: z.uuid().nullable(),
});
export type ItemMoment = z.infer<typeof itemMoment>;

export const projectsOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("project.update"), id, patch: projectInput.partial() }),
  z.object({ op: z.literal("project.review"), id }),
  z.object({ op: z.literal("project.reorder"), ids }),
  z.object({ op: z.literal("project.delete"), id }),
  z.object({ op: z.literal("project.link"), projectId: id, checklistId: id }),
  z.object({ op: z.literal("project.unlink"), projectId: id, checklistId: id }),
  z.object({ op: z.literal("project.reorderLists"), projectId: id, ids }),
  z.object({ op: z.literal("project.stage"), projectId: id, itemId: id, stageId: scope }),
  z.object({ op: z.literal("list.update"), id, patch: checklistInput.partial() }),
  z.object({
    op: z.literal("list.mode"),
    id,
    isAdvanced: z.boolean().optional(),
    features: features.optional(),
    isRoutine: z.boolean().optional(),
    primaryProjectId: scope.optional(),
  }),
  z.object({ op: z.literal("list.reset"), id }),
  z.object({ op: z.literal("list.duplicate"), id, title: z.string().max(200) }),
  z.object({ op: z.literal("list.delete"), id }),
  z.object({ op: z.literal("list.reorder"), ids }),
  z.object({ op: z.literal("list.fold"), id, sectionId: scope, folded: z.boolean() }),
  z.object({ op: z.literal("item.add"), checklistId: id, titles: z.array(z.string().max(500)).min(1).max(500) }),
  z.object({ op: z.literal("item.update"), id, patch: itemFields.partial() }),
  z.object({ op: z.literal("item.done"), id, done: z.boolean() }),
  z.object({ op: z.literal("item.skip"), id }),
  z.object({ op: z.literal("item.restore"), id, moment: itemMoment }),
  z.object({ op: z.literal("item.archive"), ids, archived: z.boolean() }),
  z.object({ op: z.literal("item.delete"), ids }),
  z.object({ op: z.literal("item.status"), ids, statusId: scope }),
  z.object({ op: z.literal("item.move"), ids, checklistId: id }),
  z.object({
    op: z.literal("entries.reorder"),
    checklistId: id,
    entries: z
      .array(z.object({ kind: z.enum(["item", "section"]), id }))
      .min(1)
      .max(2000),
  }),
  z.object({ op: z.literal("section.add"), checklistId: id, title: z.string().max(200) }),
  z.object({ op: z.literal("section.rename"), id, title: z.string().max(200) }),
  z.object({ op: z.literal("section.delete"), id }),
  z.object({ op: z.literal("subtask.add"), itemId: id, title: z.string().max(500) }),
  z.object({ op: z.literal("subtask.update"), id, patch: subtaskInput.partial().extend({ done: z.boolean().optional() }) }),
  z.object({ op: z.literal("subtask.reorder"), itemId: id, ids }),
  z.object({ op: z.literal("subtask.delete"), id }),
  z.object({ op: z.literal("subtask.promote"), id }),
  z.object({ op: z.literal("status.add"), kind, scopeId: scope, input: statusInput }),
  z.object({ op: z.literal("status.update"), kind, id, input: statusInput }),
  z.object({ op: z.literal("status.reorder"), kind, scopeId: scope, ids }),
  z.object({ op: z.literal("status.delete"), kind, id, replacementId: id }),
  z.object({ op: z.literal("status.useOwn"), kind, scopeId: id }),
  z.object({ op: z.literal("status.useStore"), kind, scopeId: id }),
]);

export type ProjectsOp = z.infer<typeof projectsOp>;
/** An operation as a screen writes it, before the check (an empty date field is `""`). */
export type ProjectsOpInput = z.input<typeof projectsOp>;

/** What the area's action answers a screen: success (with the new row's id or how many changed), or one line to show. */
export type ProjectsAnswer = { ok: true; id?: string; count?: number } | { ok: false; message: string };

/** The named fields a form sent, as text; one the form did not have is left out, so a patch keeps what it was not about. */
export function formFields<K extends string>(form: FormData, names: readonly K[]): Partial<Record<K, string>> {
  return Object.fromEntries(names.filter((name) => form.has(name)).map((name) => [name, String(form.get(name) ?? "")])) as Partial<Record<K, string>>;
}
