import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { CreateButton } from "@/components/admin/projects/create-button";
import { ColourDot, healthColour, projectStatusColour, StatusBarView, StatusPill } from "@/components/admin/projects/parts";
import { AdminLink, ButtonLink, EmptyState, PageHeader } from "@/components/admin/ui";
import { adminDay } from "@/lib/admin-date";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import type { ProjectsMessages } from "@/lib/admin-messages/projects.en";
import { PROJECTS_WORDS } from "@/lib/admin-words/projects";
import { PROJECT_LIMITS } from "@/lib/projects-model";
import { memberCan, requirePermission } from "@/server/permissions";
import { listProjects, type ProjectSummary } from "@/server/projects";
import { ensureDefaultStatuses } from "@/server/projects-statuses";

import { createProjectAction } from "./actions";

export const metadata: Metadata = { title: "Projects" };


/**
 * Projects (D903, Life's `app/app/tasks/projects`): Homer sees each project with where its tasks stand and presses New project; an empty
 * page is one card to plan the first. Done and archived projects are below. Lisa sets the store's statuses and stages from here.
 */
export default async function ProjectsPage({ params }: PageProps<"/admin/[store]/projects">) {
  const member = await requirePermission((await params).store, "projects:read");
  const off = requireFeature(member, "projects");
  if (off) return off;
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = PROJECTS_WORDS[lang];
  await ensureDefaultStatuses(store.id, w.defaults);
  const projects = await listProjects(store.id);
  const canChange = memberCan(member, "projects:write");
  const base = `/admin/${store.slug}/projects`;
  const open = projects.filter((p) => p.status !== "done" && p.status !== "archived");
  const closed = projects.filter((p) => p.status === "done" || p.status === "archived");
  const active = projects.filter((p) => p.status === "active").length;
  const create = canChange ? (
    <CreateButton
      label={w.projects.newProject}
      title={w.projects.newProject}
      action={createProjectAction.bind(null, store.slug)}
      fields={{ name: { name: "name", label: w.projects.name, max: PROJECT_LIMITS.projectName }, date: { name: "targetDate", label: w.projects.targetDate } }}
      submit={w.create}
      cancel={w.cancel}
    />
  ) : null;
  const card = (p: ProjectSummary) => <ProjectCard key={p.id} project={p} href={`${base}/${p.id}`} w={w} when={(day) => adminDay(day, "day", lang)} />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.projects.title}
        meta={[<span key="lead">{active === 0 ? w.projects.leadNone : countWords(active, w.projects.leadActive)}</span>]}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {projects.length > 0 && create}
            <ButtonLink kind="quiet" href={`${base}/statuses`}>
              {w.projects.statuses}
            </ButtonLink>
          </div>
        }
      />
      {projects.length === 0 ? (
        <EmptyState title={w.projects.firstTitle} action={create}>
          {w.projects.firstText}
        </EmptyState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">{open.map(card)}</ul>
      )}
      {closed.length > 0 && (
        <details className="flex flex-col gap-3">
          <summary className="cursor-pointer text-body-strong text-ink-2">
            {w.projects.closed} <span className="text-muted tabular-nums">{closed.length}</span>
          </summary>
          <ul className="mt-3 grid gap-4 md:grid-cols-2">{closed.map(card)}</ul>
        </details>
      )}
    </div>
  );
}

function ProjectCard({ project: p, href, w, when }: { project: ProjectSummary; href: string; w: ProjectsMessages; when: (day: string) => string }) {
  return (
    <li className="flex flex-col gap-3 rounded-card bg-card p-4 dark:border dark:border-line">
      <div className="flex items-start gap-2">
        <span className="mt-1.5">
          <ColourDot colour={p.colour} size="size-3" />
        </span>
        <AdminLink href={href} className="min-w-0 flex-1 text-title text-ink underline-offset-2 hover:underline">
          {p.name}
        </AdminLink>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill colour={projectStatusColour(p.status)}>{w.projectStatuses[p.status]}</StatusPill>
        <StatusPill colour={healthColour(p.health)}>{w.health[p.health]}</StatusPill>
        {p.targetDate && <span className="text-sm text-ink-2">{fillWords(w.due, { date: when(p.targetDate) })}</span>}
      </div>
      {p.nextAction && <p className="text-sm text-ink-2">{fillWords(w.project.next, { text: p.nextAction })}</p>}
      <StatusBarView parts={p.bar.parts} label={w.projects.barLabel} />
      <p className="text-sm text-muted">
        {p.bar.total === 0 ? w.projects.noTasks : fillWords(w.progress, { done: p.bar.finished, total: p.bar.total })} · {countWords(p.lists, w.projects.lists)}
      </p>
    </li>
  );
}
