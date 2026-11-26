import "server-only";

/**
 * What a projects and checklists writer answers (D903): its success, or one problem the screen words in the person's language
 * (`projects` words, `problems`) and, for a form, the fields it found wrong. The database's rules (`projects_rules`) raise codes
 * (`checklist_item.status_scope`, `project_item_stage.not_member`) and named constraints; `projectsGuard()` turns those into `invalid`,
 * a key into another store's row into `not_found`, and lets anything else through as the bug it is.
 */

export type ProjectsProblem = "forbidden" | "not_found" | "invalid" | "last";
export type ProjectsResult<T extends object = object> = ({ ok: true } & T) | { ok: false; problem: ProjectsProblem; fields?: string[] };

type Failure = { code?: unknown; constraint?: unknown; message?: unknown };

/** The error and its causes, deepest last (Drizzle wraps the driver's error). */
function chain(error: unknown): Failure[] {
  const found: Failure[] = [];
  for (let e = error, depth = 0; e && typeof e === "object" && depth < 6; e = (e as { cause?: unknown }).cause, depth++) found.push(e as Failure);
  return found;
}

const RULE = /\b(checklist_item|checklist_subtask|project_item_stage)\.[a-z_]+\b/;
const TABLES = /^(projects|project_statuses|checklists|project_checklists|checklist_statuses|checklist_sections|checklist_items|project_item_stages|checklist_subtasks|checklist_folds)_/;

/** The problem a database refusal means, or null when the error is not one of this module's rules. */
export function projectsProblem(error: unknown): ProjectsProblem | null {
  for (const failure of chain(error)) {
    if (typeof failure.message === "string" && RULE.test(failure.message)) return "invalid";
    const constraint = typeof failure.constraint === "string" ? failure.constraint : "";
    if (!TABLES.test(constraint)) continue;
    // A foreign key: the row named is not this store's (or is gone). A check or a unique key: the input breaks a rule.
    if (failure.code === "23503") return "not_found";
    if (failure.code === "23514" || failure.code === "23505") return "invalid";
  }
  return null;
}

/** Runs a write, answering a database refusal as a problem and letting a bug through. */
export async function projectsGuard<T extends object>(run: () => Promise<ProjectsResult<T>>): Promise<ProjectsResult<T>> {
  try {
    return await run();
  } catch (error) {
    const problem = projectsProblem(error);
    if (problem) return { ok: false, problem };
    throw error;
  }
}

