import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireFeature } from "@/components/admin/feature-off";
import { CreateButton } from "@/components/admin/projects/create-button";
import { healthColour, projectStatusColour, StatusBarView, StatusPill, ViewSwitch } from "@/components/admin/projects/parts";
import { ProjectBoard, type BoardCardView } from "@/components/admin/projects/project-board";
import { ProjectLists, type ProjectListView } from "@/components/admin/projects/project-lists";
import { ButtonLink, EmptyState, PageHeader } from "@/components/admin/ui";
import { adminDate, adminDay } from "@/lib/admin-date";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { PROJECTS_WORDS } from "@/lib/admin-words/projects";
import { PROJECT_LIMITS } from "@/lib/projects-model";
import { memberCan, requirePermission } from "@/server/permissions";
import { projectDetail, teamOf, type BoardItem } from "@/server/projects";
import { listChecklists } from "@/server/projects-lists";
import { ensureDefaultStatuses } from "@/server/projects-statuses";

import { createChecklistAction, projectsAction } from "../actions";

export const metadata: Metadata = { title: "Project" };


/**
 * A project (D903, Life's `app/app/tasks/projects/[id]`): its status, health, next action and target date, then its work as a List (each
 * checklist with its open tasks to tick) or a Board (a column per stage, tasks dragged on). Homer adds a checklist; Lisa customises the
 * project, its stages and its lists' membership.
 */
export default async function ProjectPage({ params, searchParams }: PageProps<"/admin/[store]/projects/[projectId]">) {
  const { store: slug, projectId } = await params;
  const member = await requirePermission(slug, "projects:read");
  const off = requireFeature(member, "projects");
  if (off) return off;
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = PROJECTS_WORDS[lang];
  await ensureDefaultStatuses(store.id, w.defaults);
  const [project, lists, team] = await Promise.all([projectDetail(store.id, projectId), listChecklists(store.id), teamOf(store.id)]);
  if (!project) notFound();
  const view = (await searchParams).view === "board" ? "board" : "list";
  const canChange = memberCan(member, "projects:write");
  const base = `/admin/${store.slug}`;
  const act = projectsAction.bind(null, store.slug);
  const person = (id: string | null) => team.find((p) => p.id === id)?.name ?? null;

  const factsOf = (item: BoardItem): string[] =>
    [
      item.priority ? w.priorities[item.priority] : null,
      item.dueAt ? fillWords(w.due, { date: adminDate(store, item.dueAt, item.allDay ? "day" : "dayTime", lang) }) : null,
      person(item.assignedTo),
      item.subtasks.total > 0 ? fillWords(w.board.subtasks, item.subtasks) : null,
    ].filter((f): f is string => f !== null);
  const statusOf = (item: BoardItem) => {
    const status = project.statusesByList[item.checklistId]?.find((s) => s.id === item.statusId);
    return status ? { name: status.name, colour: status.colour } : null;
  };

  const listViews: ProjectListView[] = project.checklists.map((list) => ({
    id: list.id,
    title: list.title,
    href: `${base}/checklists/${list.id}`,
    home: list.home,
    progress: fillWords(w.progress, { done: list.done, total: list.total }),
    tasks: project.items.filter((i) => i.checklistId === list.id && !i.done).map((i) => ({ id: i.id, title: i.title, done: i.done, status: statusOf(i), facts: factsOf(i) })),
  }));
  // A task without a stage of its own is in the first (Life's rule), or, once ticked, in the first done stage.
  const firstStage = project.stages[0]?.id ?? "";
  const firstDone = project.stages.find((x) => x.bucket === "done")?.id ?? firstStage;
  const cards: BoardCardView[] = project.items.map((i) => ({
    id: i.id,
    title: i.title,
    href: `${base}/checklists/${i.checklistId}`,
    list: i.checklistTitle,
    done: i.done,
    stageId: i.stageId && project.stages.some((s) => s.id === i.stageId) ? i.stageId : i.done ? firstDone : firstStage,
    status: statusOf(i),
    facts: factsOf(i),
  }));
  const inProject = new Set(project.checklists.map((l) => l.id));
  const addChecklist = canChange ? (
    <CreateButton
      label={w.project.addChecklist}
      title={w.project.addChecklist}
      action={createChecklistAction.bind(null, store.slug)}
      fields={{
        name: { name: "title", label: w.checklists.titleField, max: PROJECT_LIMITS.checklistTitle },
        choice: { name: "projectId", label: w.checklists.project, none: w.none, options: [{ id: project.id, label: project.name }], chosen: project.id },
      }}
      submit={w.create}
      cancel={w.cancel}
    />
  ) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `${base}/projects`, label: w.project.back }}
        title={project.name}
        meta={[
          <StatusPill key="status" colour={projectStatusColour(project.status)}>
            {w.projectStatuses[project.status]}
          </StatusPill>,
          <StatusPill key="health" colour={healthColour(project.health)}>
            {w.health[project.health]}
          </StatusPill>,
          ...(project.targetDate ? [<span key="target">{fillWords(w.due, { date: adminDay(project.targetDate, "day", lang) })}</span>] : []),
          ...(project.statusReviewedAt ? [<span key="reviewed">{fillWords(w.project.reviewed, { date: adminDate(store, project.statusReviewedAt, "day", lang) })}</span>] : []),
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {project.checklists.length > 0 && addChecklist}
            <ButtonLink kind="quiet" href={`${base}/projects/${project.id}/settings`}>
              {w.project.customise}
            </ButtonLink>
          </div>
        }
      />
      {project.description && <p className="max-w-prose text-body text-ink-2">{project.description}</p>}
      {project.nextAction && <p className="text-body text-ink">{fillWords(w.project.next, { text: project.nextAction })}</p>}
      <StatusBarView parts={project.bar.parts} label={w.projects.barLabel} />

      {project.checklists.length === 0 ? (
        <EmptyState title={w.project.empty} action={addChecklist}>
          {w.project.emptyText}
        </EmptyState>
      ) : (
        <>
          <ViewSwitch
            label={w.project.viewsLabel}
            current={view}
            views={[
              { key: "list", label: w.project.views.list, href: `${base}/projects/${project.id}` },
              { key: "board", label: w.project.views.board, href: `${base}/projects/${project.id}?view=board` },
            ]}
          />
          {view === "board" ? (
            <ProjectBoard projectId={project.id} stages={project.stages.map((s) => ({ id: s.id, name: s.name, colour: s.colour }))} cards={cards} canChange={canChange} words={w.board} act={act} />
          ) : (
            <ProjectLists
              projectId={project.id}
              lists={listViews}
              addable={lists.filter((l) => !inProject.has(l.id) && l.status !== "archived").map((l) => ({ id: l.id, title: l.title }))}
              canChange={canChange}
              words={{ project: w.project, checklist: w.checklist }}
              act={act}
            />
          )}
        </>
      )}
    </div>
  );
}
