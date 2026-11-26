import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { adminLangOf } from "@/lib/admin-lang";
import type { AddTaskInput, ProjectsOverviewInput, TickTaskInput } from "@/lib/owner-tools";
import { dayIn } from "@/lib/work-dates";

import { passMembership, type Account, type Membership } from "./auth";
import { OwnerToolError } from "./owner-tool-error";
import type { Store } from "./stores";
import { col, typedRow } from "./typed-rows";

/**
 * The AI manager's Projects tools (D904, `docs/projects.md` P8.3c): what is open and due, a task added, a task ticked. Each answers only
 * with what the store's records say; the manager writes nothing it was not given. Projects' modules and words are loaded where a tool runs
 * (`import()`), so the many routes that reach the tool list do not carry them (`route-load`, `admin-text-reach`).
 */

const projectsModules = async () => {
  const [projects, items, lists] = await Promise.all([import("./projects"), import("./projects-items"), import("./projects-lists")]);
  return { ...projects, ...items, ...lists };
};

type Ctx = { account: Account; store: Store };

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHOWN = 25;

async function member(ctx: Ctx): Promise<Membership> {
  const found = await passMembership(ctx.store.slug, ctx.account.id);
  return found ?? fail("You are not a member of this store any more.");
}

const problemWords = (problem: string): string =>
  problem === "not_found" ? "That is not there any more." : problem === "forbidden" ? "The person's role may not change projects." : "That was refused: check the title.";

/** The store's projects, its open lists and its open tasks, the soonest due first. */
export async function projectsOverviewTool(ctx: Ctx, input: ProjectsOverviewInput) {
  const { store, account } = ctx;
  const { listProjects, listChecklists, openTasks } = await projectsModules();
  const [projects, lists, tasks] = await Promise.all([listProjects(store.id), listChecklists(store.id), openTasks(store.id)]);
  const mine = input.who === "me" ? tasks.filter((t) => t.assignedTo === account.id) : tasks;
  const today = dayIn(new Date().toISOString(), store.timeZone);
  const due = mine
    .filter((t) => t.dueAt)
    .sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""))
    .slice(0, SHOWN)
    .map((t) => {
      const day = dayIn(t.dueAt as string, store.timeZone);
      return { id: t.id, title: t.title, list: t.checklistTitle, due: day, late: day < today };
    });
  return {
    whose: input.who === "me" ? "the person's own" : "the whole team's",
    projects: projects
      .filter((p) => p.status !== "done" && p.status !== "archived")
      .map((p) => ({ name: p.name, status: p.status, health: p.health, target: p.targetDate, done: p.bar.finished, tasks: p.bar.total, next: p.nextAction })),
    lists: lists.filter((l) => l.status === "open" && !l.asTemplate).map((l) => ({ id: l.id, title: l.title })),
    open_tasks: mine.length,
    due_first: due,
    undated: mine.filter((t) => !t.dueAt).slice(0, SHOWN).map((t) => ({ id: t.id, title: t.title, list: t.checklistTitle })),
    page: `/admin/${store.slug}/checklists?view=tasks`,
  };
}

const LIST_ROW = z.object({ id: col.uuid, title: col.text });

/** Adds a task at the end of a list named by its title or id, or of the store's list for follow-ups, made the first time. */
export async function addTaskTool(ctx: Ctx, input: AddTaskInput) {
  const me = await member(ctx);
  const { addItem, createChecklist } = await projectsModules();
  const storeId = ctx.store.id;
  let list: { id: string; title: string } | null = null;
  if (input.list) {
    const ref = input.list.trim();
    list = await typedRow(
      LIST_ROW,
      UUID.test(ref)
        ? sql`select id, title from commerce.checklists where store_id = ${storeId}::uuid and id = ${ref}::uuid and status = 'open' and not as_template`
        : sql`select id, title from commerce.checklists where store_id = ${storeId}::uuid and lower(title) = lower(${ref}) and status = 'open' and not as_template order by updated_at desc limit 1`,
    );
    if (!list) fail(`No open list called "${ref}". projects_overview lists them.`);
  } else {
    const { PROJECT_SOURCES_WORDS } = await import("@/lib/admin-words/project-sources");
    const followUps = PROJECT_SOURCES_WORDS[adminLangOf(me.account.adminLocale)].followUps;
    list = await typedRow(
      LIST_ROW,
      sql`select id, title from commerce.checklists where store_id = ${storeId}::uuid and title = ${followUps} and status = 'open' and not as_template order by created_at limit 1`,
    );
    if (!list) {
      const made = await createChecklist(me, { title: followUps });
      if (!made.ok) fail(problemWords(made.problem));
      list = { id: (made as { id: string }).id, title: followUps };
    }
  }
  const target = list as { id: string; title: string };
  const added = await addItem(me, target.id, { title: input.title });
  if (!added.ok) fail(problemWords(added.problem));
  return { done: `Added "${input.title}" to ${target.title}.`, page: `/admin/${ctx.store.slug}/checklists/${target.id}` };
}

/** Ticks off one open task named by its id or its title; several with that title are listed to choose from. */
export async function tickTaskTool(ctx: Ctx, input: TickTaskInput) {
  const me = await member(ctx);
  const { openTasks, setItemDone } = await projectsModules();
  const ref = input.task.trim();
  const open = await openTasks(ctx.store.id);
  const exact = UUID.test(ref) ? open.filter((t) => t.id === ref) : open.filter((t) => t.title.toLowerCase() === ref.toLowerCase());
  const found = exact.length > 0 ? exact : open.filter((t) => t.title.toLowerCase().includes(ref.toLowerCase()));
  if (found.length === 0) fail(`No open task called "${ref}". projects_overview lists them.`);
  if (found.length > 1)
    fail(`Several open tasks match "${ref}": ${found.slice(0, 5).map((t) => `"${t.title}" in ${t.checklistTitle} (id ${t.id})`).join("; ")}. Name one by its id.`);
  const task = found[0];
  const done = await setItemDone(me, task.id, true);
  if (!done.ok) fail(problemWords(done.problem));
  return { done: `Ticked off "${task.title}" in ${task.checklistTitle}.`, page: `/admin/${ctx.store.slug}/checklists/${task.checklistId}` };
}
