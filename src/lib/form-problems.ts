/**
 * A form's refusal with each problem tied to its field where it has one (PSI ACC-05): `ActionForm` marks the field `aria-invalid`, shows its
 * message under it, names that message as its description and moves the focus to the first one, so a screen reader hears what is wrong
 * where it is (code review step 1.15, D829). Pure, for actions.
 */
export type FieldProblems = { status: "error"; messages: string[]; fields: Record<string, string> };

/** What a form's action answered, as `ActionForm` and `QuietActionForm` show it (`FormState`): `fields` ties a problem to its field by name. */
export type FormAnswer = { status: "idle" | "ok" | "error"; messages: string[]; fields?: Record<string, string> };

/** Zod's issues as a form's refusal: every message once, and the first message of each top-level field by its name. */
export function formProblems(issues: readonly { path: readonly PropertyKey[]; message: string }[]): FieldProblems {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const name = issue.path[0];
    if (typeof name === "string" && !(name in fields)) fields[name] = issue.message;
  }
  return { status: "error", messages: [...new Set(issues.map((issue) => issue.message))], fields };
}

/** One problem as a form's refusal, shown under its field when it names one (D836's forms, and any action that refuses in one line). */
export function formRefusal(message: string, field?: string): FormAnswer {
  return field ? { status: "error", messages: [message], fields: { [field]: message } } : { status: "error", messages: [message] };
}

/** The id a field's message has, under the field or in the form's list of problems. */
export const problemId = (form: string, field: string): string => `${form}-problem-${field.replace(/[^A-Za-z0-9_-]/g, "_")}`;

/** What a refused action said, from the shapes the admin's actions answer with (`{ ok: false, problems }`, `{ ok: false, problem }`, `{ ok: false, message }`). */
export function refusalOf(result: unknown): string | null {
  if (!result || typeof result !== "object" || !("ok" in result) || result.ok !== false) return null;
  const answer = result as { problems?: unknown; problem?: unknown; message?: unknown };
  if (Array.isArray(answer.problems) && answer.problems.length > 0) return answer.problems.join(" ");
  if (typeof answer.problem === "string") return answer.problem;
  if (typeof answer.message === "string") return answer.message;
  return null;
}

/**
 * Whatever a server action handed back, as a form's answer (`QuietActionForm`, D829): a refusal in `FormState`'s shape as it is, one of the
 * other shapes the admin's actions refuse with as its words, and anything else (nothing, as an action that redirects or refreshes
 * returns, or a success) as done.
 */
export function answerOf(result: unknown): FormAnswer {
  if (result && typeof result === "object" && "status" in result && result.status === "error" && "messages" in result && Array.isArray(result.messages)) {
    const refused = result as { messages: unknown[]; fields?: unknown };
    const messages = refused.messages.filter((message): message is string => typeof message === "string" && message.length > 0);
    const fields =
      refused.fields && typeof refused.fields === "object"
        ? Object.fromEntries(Object.entries(refused.fields).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
        : undefined;
    return { status: "error", messages, ...(fields ? { fields } : {}) };
  }
  const refusal = refusalOf(result);
  return refusal ? { status: "error", messages: [refusal] } : { status: "ok", messages: [] };
}
