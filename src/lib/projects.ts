/**
 * Projects and checklists (D903, `docs/projects.md`): the pure parts the server, the screens and the AI manager share. The database keeps
 * the rules no writer may skip (the tick and the status agree, a status belongs where it is used, the home project is a member,
 * `projects_rules`); this file holds the defaults, the names, the orders and the sums.
 */

import { z } from "zod";

import {
  CHECKLIST_STATES,
  PRIORITIES,
  PROJECT_COLOURS,
  PROJECT_HEALTHS,
  PROJECT_LIMITS,
  PROJECT_STATUSES,
  STATUS_BUCKETS,
  type ProjectColour,
  type StatusBucket,
} from "./projects-model";
import { recurrence } from "./projects-recurrence-schema";

/**
 * The default statuses a store starts with, for items and for a project's stages alike, made in the person's language on the first visit
 * (`ensureDefaultStatuses()`). Life's template with *In progress* for a team's board; the first active status is what a new item gets.
 */
export const DEFAULT_STATUSES: readonly {
  slug: DefaultStatusSlug;
  bucket: StatusBucket;
  colour: ProjectColour;
}[] = [
  { slug: "todo", bucket: "active", colour: "neutral" },
  { slug: "doing", bucket: "active", colour: "insight" },
  { slug: "done", bucket: "done", colour: "positive" },
  { slug: "archived", bucket: "archived", colour: "neutral" },
];
export type DefaultStatusSlug = "todo" | "doing" | "done" | "archived";

const NORDIC: Record<string, string> = {
  æ: "ae",
  ø: "o",
  å: "a",
  ß: "ss",
  þ: "th",
  ð: "d",
};

/** A status's slug from its name: lower case letters, digits and dashes, at most 40, never empty. */
export function slugOf(name: string): string {
  const plain = name
    .toLocaleLowerCase("en")
    .replace(/[æøåßþð]/g, (c) => NORDIC[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return plain || "status";
}

/** A slug not yet taken in its scope: `name`, `name-2`, `name-3`, … within 40 characters. */
export function freeSlug(name: string, taken: ReadonlySet<string>): string {
  const base = slugOf(name);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, 40 - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** A row of a list in its one order: an item or a section (Life's separators share the items' sequence). */
export type ListEntry = { kind: "item" | "section"; id: string };

/**
 * The sort orders for a list's entries in the order given, items and sections in one sequence from 0. Only the entries named are moved;
 * the server refuses an order that names another list's rows.
 */
export function sequence(
  entries: readonly ListEntry[],
): { kind: ListEntry["kind"]; id: string; sortOrder: number }[] {
  const seen = new Set<string>();
  const out: { kind: ListEntry["kind"]; id: string; sortOrder: number }[] = [];
  for (const entry of entries) {
    const key = `${entry.kind}:${entry.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...entry, sortOrder: out.length });
  }
  return out;
}

/** A project's status bar: how many of its items are in each stage or status, and how many are finished. */
export type StatusBar = {
  total: number;
  finished: number;
  parts: {
    id: string;
    name: string;
    colour: ProjectColour;
    bucket: StatusBucket;
    count: number;
  }[];
};

export function statusBar(
  statuses: readonly {
    id: string;
    name: string;
    colour: ProjectColour;
    bucket: StatusBucket;
  }[],
  items: readonly { statusId: string | null; done: boolean }[],
): StatusBar {
  const counts = new Map<string, number>();
  let finished = 0;
  for (const item of items) {
    if (item.done) finished += 1;
    const id =
      item.statusId && statuses.some((s) => s.id === item.statusId)
        ? item.statusId
        : (statuses.find((s) => s.bucket === (item.done ? "done" : "active"))
            ?.id ?? null);
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return {
    total: items.length,
    finished,
    parts: statuses
      .map((s) => ({ ...s, count: counts.get(s.id) ?? 0 }))
      .filter((p) => p.count > 0),
  };
}


// ---------------------------------------------------------------------------
// Inputs, as the forms, the actions and the AI manager's tools send them
// ---------------------------------------------------------------------------

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();
/** An ISO instant or an empty field (none). */
const instant = z
  .union([z.iso.datetime({ offset: true }), z.literal(""), z.null()])
  .transform((v) => (v ? new Date(v).toISOString() : null))
  .optional();
const day = z
  .union([z.iso.date(), z.literal(""), z.null()])
  .transform((v) => v || null)
  .optional();
const uuidOrNone = z
  .union([z.uuid(), z.literal(""), z.null()])
  .transform((v) => v || null)
  .optional();

export const projectInput = z.object({
  name: trimmed(PROJECT_LIMITS.projectName),
  description: optionalText(PROJECT_LIMITS.description),
  colour: z.enum(PROJECT_COLOURS).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  health: z.enum(PROJECT_HEALTHS).optional(),
  nextAction: optionalText(PROJECT_LIMITS.nextAction),
  targetDate: day,
});

export const checklistInput = z.object({
  title: trimmed(PROJECT_LIMITS.checklistTitle),
  description: optionalText(PROJECT_LIMITS.description),
  dueAt: instant,
  allDay: z.boolean().nullable().optional(),
  assignedTo: uuidOrNone,
  goal: optionalText(PROJECT_LIMITS.goal),
  status: z.enum(CHECKLIST_STATES).optional(),
});

/** Money as a form gives it: minor units and a currency, both or neither. */
const cost = z
  .object({
    minor: z.int().min(-100_000_000_000).max(100_000_000_000),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .nullable()
  .optional();

/** An item's fields; `itemInput` adds the rule across its dates, and a patch checks its dates against what is kept. */
export const itemFields = z.object({
  title: trimmed(PROJECT_LIMITS.itemTitle),
  description: optionalText(PROJECT_LIMITS.itemDescription),
  statusId: uuidOrNone,
  assignedTo: uuidOrNone,
  startAt: instant,
  dueAt: instant,
  allDay: z.boolean().nullable().optional(),
  priority: z.enum(PRIORITIES).nullable().optional(),
  blockedReason: optionalText(PROJECT_LIMITS.blockedReason),
  blockedByItemId: uuidOrNone,
  cost,
  /** When it comes back once done (P4.1); null takes the rule off. */
  recurrence: recurrence.nullable().optional(),
  /** Its category and its tags (P4.6): the store's labels of each kind; the tags given replace those it has. */
  categoryId: uuidOrNone,
  tagIds: z.array(z.uuid()).max(30).optional(),
});
export const itemInput = itemFields.refine(
  (v) => !v.startAt || !v.dueAt || v.startAt <= v.dueAt,
  { path: ["dueAt"], message: "dates" },
);
export type ItemInput = z.infer<typeof itemInput>;

export const subtaskInput = z.object({
  title: trimmed(PROJECT_LIMITS.itemTitle),
  dueAt: instant,
  allDay: z.boolean().nullable().optional(),
  assignedTo: uuidOrNone,
  statusId: uuidOrNone,
  isGoal: z.boolean().optional(),
});

export const statusInput = z.object({
  name: trimmed(PROJECT_LIMITS.statusName),
  colour: z.enum(PROJECT_COLOURS),
  bucket: z.enum(STATUS_BUCKETS),
});

export const sectionTitle = trimmed(PROJECT_LIMITS.sectionTitle);

/** A category or a tag (P4.6): its name and colour. */
export const labelInput = z.object({
  name: trimmed(PROJECT_LIMITS.labelName),
  colour: z.enum(PROJECT_COLOURS),
});

/** A comment on a task (P4.4). */
export const commentBody = trimmed(PROJECT_LIMITS.comment);

/** The fields a zod issue names, as the forms show their problems: one per field, the first. */
export function problemFields(error: z.ZodError): string[] {
  return [
    ...new Set(error.issues.map((issue) => String(issue.path[0] ?? "form"))),
  ];
}
