"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import type { AdminLang } from "@/lib/admin-lang";
import type { ProjectsMessages } from "@/lib/admin-messages/projects.en";
import { COMMON_WORDS } from "@/lib/admin-words/common";
import { PROJECT_SOURCES_WORDS } from "@/lib/admin-words/project-sources";
import { PROJECTS_WORDS } from "@/lib/admin-words/projects";
import { featureOffText } from "@/lib/feature-labels";
import { projectsOn } from "@/lib/extensions";
import { formFields, projectsOp, type ProjectsAnswer, type ProjectsOpInput } from "@/lib/projects-ops";
import { featureOn } from "@/lib/store-features";
import type { Membership } from "@/server/auth";
import { findCustomerChoices, type CustomerChoice } from "@/server/customer-choices";
import { memberCan } from "@/server/permissions";
import { createProject, linkChecklist, updateProject } from "@/server/projects";
import type { ProjectsResult } from "@/server/projects-errors";
import { createChecklist, duplicateChecklist, listFingerprint, updateChecklist } from "@/server/projects-lists";
import { runProjectsOp } from "@/server/projects-ops";
import { storeAction } from "@/server/store-action";

/**
 * Projects and checklists' actions (D903): one for every change a screen makes (`projectsOp`, checked here whatever a stale page sends), and
 * the forms that make a project or a list and save their details. Each checks the member may change projects (folding is the person's own
 * view, so reading is enough), that the account has the extension (D904: refused while it is read-only too) and the feature is on,
 * answers in the member's language, and redraws the page on success.
 */

const wordsOf = (lang: AdminLang): ProjectsMessages => PROJECTS_WORDS[lang];

/** The feature's refusal while it is off, in the member's words; null while it is on (the extension is `storeAction()`'s to check). */
const featureOff = (member: Membership, lang: AdminLang): string | null =>
  featureOn(member.store, "projects") ? null : featureOffText("projects", COMMON_WORDS[lang].features);

function problemText(w: ProjectsMessages, result: Extract<ProjectsResult, { ok: false }>): string {
  const field = result.fields?.find((f): f is keyof ProjectsMessages["fieldProblems"] => f in w.fieldProblems);
  return field ? w.fieldProblems[field] : w.problems[result.problem];
}

/** Every change of a projects or checklists screen; the page is drawn again on success, and a refusal comes back as one line. */
export async function projectsAction(store: string, raw: ProjectsOpInput): Promise<ProjectsAnswer> {
  const parsed = projectsOp.safeParse(raw);
  const key = parsed.success && parsed.data.op === "list.fold" ? "projects:read" : "projects:write";
  return storeAction({ store, key, action: "projects.op", extension: "projects", answer: (message): ProjectsAnswer => ({ ok: false, message }) }, async (member, lang): Promise<ProjectsAnswer> => {
    const w = wordsOf(lang);
    if (!parsed.success) return { ok: false, message: w.problems.invalid };
    const off = featureOff(member, lang);
    if (off) return { ok: false, message: off };
    // A task from a source with no list chosen goes to the store's list for follow-ups, named in the member's words (P8.3a).
    const result = await runProjectsOp(member, parsed.data, { followUps: PROJECT_SOURCES_WORDS[lang].followUps });
    if (!result.ok) return { ok: false, message: problemText(w, result) };
    refresh();
    return { ok: true, id: result.id, count: result.count };
  });
}


/** A list's fingerprint for its page's light refresh (P4.10): read by anyone who may read projects; null when it cannot be read. */
export async function listStatusAction(store: string, checklistId: string): Promise<string | null> {
  return storeAction({ store, key: "projects:read", action: "projects.listStatus", extension: "projects", answer: (): string | null => null }, async (member): Promise<string | null> =>
    projectsOn(member.store) ? listFingerprint(member.store.id, checklistId) : null,
  );
}

/**
 * The store's customers a task may be about (P4.7), found by name or email for the task's editor: for a member who may change projects and
 * read customers, while Projects is on; nothing for anyone else.
 */
export async function findTaskCustomersAction(store: string, query: string): Promise<CustomerChoice[]> {
  return storeAction({ store, key: "projects:write", action: "projects.findCustomers", extension: "projects", answer: (): CustomerChoice[] => [] }, async (member): Promise<CustomerChoice[]> =>
    projectsOn(member.store) && memberCan(member, "customers:read") ? findCustomerChoices(member.store.id, String(query ?? "")) : [],
  );
}

function formAnswer(w: ProjectsMessages, result: Extract<ProjectsResult, { ok: false }>): FormState {
  const fields = Object.fromEntries((result.fields ?? []).filter((f) => f in w.fieldProblems).map((f) => [f, w.fieldProblems[f as keyof ProjectsMessages["fieldProblems"]]]));
  return { status: "error", messages: [problemText(w, result)], fields };
}

/** What a making form answers: its refusal, or the id of what it made, which the page then moves to. */
type Made = FormState | { id: string };

/** A new project from its name (and a target date, if given); the page moves to it. */
export async function createProjectAction(store: string, _state: FormState, form: FormData): Promise<FormState> {
  const made = await storeAction(
    { store, key: "projects:write", action: "projects.create", extension: "projects", answer: (message): Made => ({ status: "error", messages: [message] }) },
    async (member, lang): Promise<Made> => {
      const w = wordsOf(lang);
      const off = featureOff(member, lang);
      if (off) return { status: "error", messages: [off] };
      const result = await createProject(member, { name: "", ...formFields(form, ["name", "targetDate"]) });
      return result.ok ? { id: result.id } : formAnswer(w, result);
    },
  );
  if ("id" in made) redirect(`/admin/${store}/projects/${made.id}`);
  return made;
}

/** A new checklist from its title, in a project when one is chosen; the page moves to it. */
export async function createChecklistAction(store: string, _state: FormState, form: FormData): Promise<FormState> {
  const made = await storeAction(
    { store, key: "projects:write", action: "projects.createList", extension: "projects", answer: (message): Made => ({ status: "error", messages: [message] }) },
    async (member, lang): Promise<Made> => {
      const w = wordsOf(lang);
      const off = featureOff(member, lang);
      if (off) return { status: "error", messages: [off] };
      const { title = "", projectId, from } = formFields(form, ["title", "projectId", "from"]);
      // From a template (P4.12): its copy, then in the project chosen.
      const result = from ? await duplicateChecklist(member, from, title) : await createChecklist(member, { title }, projectId || null);
      if (result.ok && from && projectId) {
        const linked = await linkChecklist(member, projectId, result.id);
        if (!linked.ok) return formAnswer(w, linked);
      }
      return result.ok ? { id: result.id } : formAnswer(w, result);
    },
  );
  if ("id" in made) redirect(`/admin/${store}/checklists/${made.id}`);
  return made;
}

/** A project's details, as its settings form sends them. */
export async function saveProjectAction(store: string, id: string, _state: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store, key: "projects:write", action: "projects.save", extension: "projects", answer: (message): FormState => ({ status: "error", messages: [message] }) }, async (member, lang): Promise<FormState> => {
    const w = wordsOf(lang);
    const off = featureOff(member, lang);
    if (off) return { status: "error", messages: [off] };
    const result = await updateProject(member, id, formFields(form, ["name", "description", "colour", "status", "health", "nextAction", "targetDate"]));
    if (!result.ok) return formAnswer(w, result);
    refresh();
    return { status: "ok", messages: [w.saved] };
  });
}

/** A day from a date field as the instant kept for it: noon UTC, the same calendar day in every European zone, marked a whole day. */
const dayAt = (day: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day}T12:00:00.000Z` : "");

/** A list's details, as its settings form sends them (its due date a day). */
export async function saveChecklistAction(store: string, id: string, _state: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store, key: "projects:write", action: "projects.saveList", extension: "projects", answer: (message): FormState => ({ status: "error", messages: [message] }) }, async (member, lang): Promise<FormState> => {
    const w = wordsOf(lang);
    const off = featureOff(member, lang);
    if (off) return { status: "error", messages: [off] };
    const fields = formFields(form, ["title", "description", "goal", "assignedTo", "dueAt", "status"]);
    const dueAt = fields.dueAt === undefined ? undefined : dayAt(fields.dueAt);
    const result = await updateChecklist(member, id, { ...fields, dueAt, ...(dueAt !== undefined && { allDay: dueAt ? true : null }) });
    if (!result.ok) return formAnswer(w, result);
    refresh();
    return { status: "ok", messages: [w.saved] };
  });
}

