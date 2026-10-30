/**
 * A form's refusal with each problem tied to its field where it has one (PSI ACC-05): `ActionForm` marks the field `aria-invalid`, names its
 * message as its description and moves the focus to the first one, so a screen reader hears what is wrong where it is. Pure, for actions.
 */
export type FieldProblems = { status: "error"; messages: string[]; fields: Record<string, string> };

/** Zod's issues as a form's refusal: every message once, and the first message of each top-level field by its name. */
export function formProblems(issues: readonly { path: readonly PropertyKey[]; message: string }[]): FieldProblems {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const name = issue.path[0];
    if (typeof name === "string" && !(name in fields)) fields[name] = issue.message;
  }
  return { status: "error", messages: [...new Set(issues.map((issue) => issue.message))], fields };
}

/** The id a field's message has in the form's list of problems. */
export const problemId = (form: string, field: string): string => `${form}-problem-${field.replace(/[^A-Za-z0-9_-]/g, "_")}`;
