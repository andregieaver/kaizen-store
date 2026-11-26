/**
 * Projects and checklists (D903, `docs/projects.md`): the words the database checks, as constants only. `src/db/schema.ts` reads this
 * file for its checks and drizzle-kit loads it without the app's path aliases, so it imports nothing.
 */

/** Where a project stands (Life's project status model, `20261217120000_project_status_model.sql`). */
export const PROJECT_STATUSES = ["planning", "active", "blocked", "done", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** How a project is doing, said by a person or the AI manager. */
export const PROJECT_HEALTHS = ["green", "amber", "red"] as const;
export type ProjectHealth = (typeof PROJECT_HEALTHS)[number];

/** A checklist's own state: archived lists leave the list of lists, done ones are finished. */
export const CHECKLIST_STATES = ["open", "done", "archived"] as const;
export type ChecklistState = (typeof CHECKLIST_STATES)[number];

/**
 * The bucket a status or a stage is in. An item in a `done` or `archived` status is ticked, and ticking an item moves it to the first
 * `done` status; unticking moves an item in a finished status to the first `active` one (Life's `toggleChecklistItem()`).
 */
export const STATUS_BUCKETS = ["active", "done", "archived"] as const;
export type StatusBucket = (typeof STATUS_BUCKETS)[number];

export const PRIORITIES = ["low", "medium", "high"] as const;
export type Priority = (typeof PRIORITIES)[number];

/**
 * The colours a project, a status or a stage may have: a signal or one of the chart's tones, which every admin colour scheme sets in light
 * and in dark (`src/lib/admin-schemes.ts`), so a colour chosen once reads in every scheme. Life kept a hex value.
 */
export const PROJECT_COLOURS = ["neutral", "insight", "positive", "warning", "danger", "chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "chart-6"] as const;
export type ProjectColour = (typeof PROJECT_COLOURS)[number];

/** Text limits, the same in the checks and the forms. */
export const PROJECT_LIMITS = {
  projectName: 160,
  description: 5000,
  nextAction: 500,
  checklistTitle: 200,
  goal: 2000,
  statusName: 40,
  sectionTitle: 120,
  itemTitle: 500,
  itemDescription: 10_000,
  blockedReason: 500,
} as const;
