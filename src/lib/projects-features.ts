/**
 * Which parts of an item a checklist uses (D903, ported from Kaizen Life's `lib/checklists/advanced-features.ts`). Pure.
 *
 * A full item carries a lot: a status, a priority, an assignee, two dates, a repeat, labels, subtasks, attachments, a customer and
 * reminders. That is right for work being tracked and wrong for a packing list. So a checklist is a title and a box to tick (Homer's list)
 * until someone switches on *Advanced list*, which brings the whole set at once; the switches then take away what this list has no use for
 * (Lisa's).
 *
 * Absent means on: the stored object records only a field switched off, so the common advanced list stores nothing, and a field added later
 * appears on every advanced list. Hiding never deletes: switching a field off hides it and leaves its column as it was, so a list switched
 * back finds its due dates and assignees where it left them.
 */

export const ADVANCED_FEATURES = [
  "status",
  "priority",
  "category",
  "tags",
  "subtasks",
  "assignment",
  "startDate",
  "dueDate",
  "recurrence",
  "reminders",
  "contacts",
  "attachments",
  /** A price per item and a total for the list. */
  "cost",
  /** A field of the list, not of its items: what the list is for, which the AI manager reads. */
  "goal",
] as const;

export type AdvancedFeature = (typeof ADVANCED_FEATURES)[number];
export type ChecklistFeatures = Record<AdvancedFeature, boolean>;

/**
 * The fields whose editors are built so far (`docs/projects.md` section 5): the list's settings offer a switch for these only. A field joins
 * when its step lands, and appears at once on every advanced list that never switched it off.
 */
export const BUILT_FEATURES: readonly AdvancedFeature[] = ["status", "priority", "subtasks", "assignment", "startDate", "dueDate", "cost", "goal"];

/** Everything on: an advanced list before it is trimmed. */
export const ALL_FEATURES: ChecklistFeatures = Object.fromEntries(ADVANCED_FEATURES.map((f) => [f, true])) as ChecklistFeatures;

/** Everything off: a title and a box to tick, the plain list. */
export const NO_FEATURES: ChecklistFeatures = Object.fromEntries(ADVANCED_FEATURES.map((f) => [f, false])) as ChecklistFeatures;

export const isAdvancedFeature = (value: unknown): value is AdvancedFeature => (ADVANCED_FEATURES as readonly unknown[]).includes(value);

/** The stored exceptions read back: only `false` switches a field off; anything unreadable leaves it on. */
export function parseFeatures(raw: unknown): ChecklistFeatures {
  const out = { ...ALL_FEATURES };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isAdvancedFeature(key)) out[key] = value !== false;
  }
  return out;
}

/** What to store for a set of switches: the fields switched off, nothing else. */
export function storedFeatures(features: Partial<ChecklistFeatures>): Partial<Record<AdvancedFeature, false>> {
  const out: Partial<Record<AdvancedFeature, false>> = {};
  for (const feature of ADVANCED_FEATURES) if (features[feature] === false) out[feature] = false;
  return out;
}

export type FeatureSource = { isAdvanced: boolean; advancedFeatures: unknown; isRoutine?: boolean };

/** What a list uses, from its own two columns: the one place that decides it, so the editor and the list never disagree. */
export function checklistFeatures(list: Pick<FeatureSource, "isAdvanced" | "advancedFeatures">): ChecklistFeatures {
  return list.isAdvanced ? parseFeatures(list.advancedFeatures) : { ...NO_FEATURES };
}

/**
 * A routine's own exclusions on top: a routine is a habit, not work handed out, so it hides status, assignment, category and labels
 * whatever the switches say. The two compose: what either switches off stays off.
 */
export function effectiveFeatures(list: FeatureSource): ChecklistFeatures {
  const features = checklistFeatures(list);
  if (!list.isRoutine) return features;
  return { ...features, status: false, assignment: false, category: false, tags: false };
}
