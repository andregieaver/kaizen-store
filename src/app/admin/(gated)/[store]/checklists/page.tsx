import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { CreateButton } from "@/components/admin/projects/create-button";
import { AdminLink, EmptyState, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { adminDate } from "@/lib/admin-date";
import { countWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import type { ProjectsMessages } from "@/lib/admin-messages/projects.en";
import { PROJECTS_WORDS } from "@/lib/admin-words/projects";
import { PROJECT_LIMITS } from "@/lib/projects-model";
import type { Store } from "@/server/stores";
import { memberCan, requirePermission } from "@/server/permissions";
import { projectChoices } from "@/server/projects";
import { listChecklists, type ChecklistSummary } from "@/server/projects-lists";
import { ensureDefaultStatuses } from "@/server/projects-statuses";

import { createChecklistAction } from "../projects/actions";

export const metadata: Metadata = { title: "Checklists" };

/**
 * Checklists (D903, Life's `app/app/checklists`): Homer sees his open lists, each with how far it has come, and presses New checklist; an
 * empty page is one card to make the first. Routines are apart (habits used again), done and archived lists below.
 */
export default async function ChecklistsPage({ params }: PageProps<"/admin/[store]/checklists">) {
  const member = await requirePermission((await params).store, "projects:read");
  const off = requireFeature(member, "projects");
  if (off) return off;
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = PROJECTS_WORDS[lang];
  await ensureDefaultStatuses(store.id, w.defaults);
  const [lists, projects] = await Promise.all([listChecklists(store.id), projectChoices(store.id)]);
  const canChange = memberCan(member, "projects:write");
  const base = `/admin/${store.slug}/checklists`;
  const open = lists.filter((l) => l.status === "open" && !l.isRoutine);
  const routines = lists.filter((l) => l.status === "open" && l.isRoutine);
  const closed = lists.filter((l) => l.status !== "open");
  const openTasks = lists.filter((l) => l.status === "open").reduce((sum, l) => sum + (l.total - l.done), 0);
  const create = canChange ? (
    <CreateButton
      label={w.checklists.newChecklist}
      title={w.checklists.newChecklist}
      action={createChecklistAction.bind(null, store.slug)}
      fields={{
        name: { name: "title", label: w.checklists.titleField, max: PROJECT_LIMITS.checklistTitle },
        choice: {
          name: "projectId",
          label: w.checklists.project,
          none: w.none,
          options: projects.filter((p) => p.status !== "archived").map((p) => ({ id: p.id, label: p.name })),
        },
      }}
      submit={w.create}
      cancel={w.cancel}
    />
  ) : null;
  const group = (items: ChecklistSummary[]) => (
    <ul className="grid gap-3 md:grid-cols-2">
      {items.map((l) => (
        <ListCard key={l.id} list={l} href={`${base}/${l.id}`} w={w} store={store} lang={lang} />
      ))}
    </ul>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.checklists.title}
        meta={[<span key="lead">{lists.length === 0 ? w.checklists.leadNone : countWords(openTasks, w.checklists.leadOpen)}</span>]}
        actions={lists.length > 0 ? create : undefined}
      />
      {lists.length === 0 ? (
        <EmptyState title={w.checklists.firstTitle} action={create}>
          {w.checklists.firstText}
        </EmptyState>
      ) : (
        group(open)
      )}
      {routines.length > 0 && (
        <section aria-labelledby="routines" className="flex flex-col gap-3">
          <h2 id="routines" className="text-title text-ink">
            {w.checklists.routines}
          </h2>
          {group(routines)}
        </section>
      )}
      {closed.length > 0 && (
        <details className="flex flex-col gap-3">
          <summary className="cursor-pointer text-body-strong text-ink-2">
            {w.checklists.closed} <span className="text-muted tabular-nums">{closed.length}</span>
          </summary>
          <div className="mt-3">{group(closed)}</div>
        </details>
      )}
    </div>
  );
}

function ListCard({ list: l, href, w, store, lang }: { list: ChecklistSummary; href: string; w: ProjectsMessages; store: Store; lang: ReturnType<typeof adminLangOf> }) {
  const share = l.total === 0 ? 0 : Math.round((l.done / l.total) * 100);
  return (
    <li className="flex flex-col gap-2 rounded-card bg-card p-4 dark:border dark:border-line">
      <AdminLink href={href} className="text-title text-ink underline-offset-2 hover:underline">
        {l.title}
      </AdminLink>
      <div className="flex h-1.5 w-full overflow-hidden rounded-pill bg-sunken" aria-hidden>
        <span className="bg-positive-solid" style={{ width: `${share}%` }} />
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
        <span>{fillWords(w.progress, { done: l.done, total: l.total })}</span>
        {l.dueAt && <span>{fillWords(w.due, { date: adminDate(store, l.dueAt, l.allDay ? "day" : "dayTime", lang) })}</span>}
        {l.isAdvanced && <span>{w.checklists.advanced}</span>}
        {l.status !== "open" && <span>{w.checklistStates[l.status]}</span>}
        {l.projects.length > 0 && <span>{fillWords(w.checklist.inProjects, { projects: l.projects.map((p) => p.name).join(", ") })}</span>}
      </p>
    </li>
  );
}
