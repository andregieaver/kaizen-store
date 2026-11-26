import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireFeature } from "@/components/admin/feature-off";
import { ActButton } from "@/components/admin/projects/act-button";
import { DuplicateButton } from "@/components/admin/projects/duplicate-button";
import { ChecklistView, type ViewEntry, type ViewItem } from "@/components/admin/projects/checklist-view";
import { AdminLink, ButtonLink, PageHeader } from "@/components/admin/ui";
import { adminDate } from "@/lib/admin-date";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { PROJECTS_WORDS } from "@/lib/admin-words/projects";
import { mainCurrency } from "@/lib/markets";
import { memberCan, requirePermission } from "@/server/permissions";
import { teamOf } from "@/server/projects";
import { checklistDetail, listChecklists, type ChecklistItem } from "@/server/projects-lists";
import { ensureDefaultStatuses } from "@/server/projects-statuses";

import { projectsAction } from "../../projects/actions";

export const metadata: Metadata = { title: "Checklist" };

/**
 * A checklist (D903, Life's `app/app/checklists/[id]`): its tasks to add and tick, sections, the Done line and each task's editor
 * (`ChecklistView`). The header says how far it has come, when it is due and which projects it is in; More holds what is done to the whole
 * list (untick everything, duplicate it, mark it done or archive it, delete it), Customise how it works.
 */
export default async function ChecklistPage({ params }: PageProps<"/admin/[store]/checklists/[checklistId]">) {
  const { store: slug, checklistId } = await params;
  const member = await requirePermission(slug, "projects:read");
  const off = requireFeature(member, "projects");
  if (off) return off;
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = PROJECTS_WORDS[lang];
  await ensureDefaultStatuses(store.id, w.defaults);
  const [list, lists, team] = await Promise.all([checklistDetail(store.id, checklistId, member.account.id, store.timeZone), listChecklists(store.id), teamOf(store.id)]);
  if (!list) notFound();
  const canChange = memberCan(member, "projects:write");
  const act = projectsAction.bind(null, store.slug);
  const base = `/admin/${store.slug}`;
  const total = list.done.length + list.entries.filter((e) => e.kind === "item").length;
  const home = list.projects.find((p) => p.id === list.primaryProjectId);
  const toView = (item: ChecklistItem): ViewItem => ({ ...item, subtasks: item.subtasks.map((s) => ({ id: s.id, title: s.title, done: s.done, isGoal: s.isGoal })) });
  const entries: ViewEntry[] = list.entries.map((e) => (e.kind === "section" ? { kind: "section", section: { id: e.section.id, title: e.section.title } } : { kind: "item", item: toView(e.item) }));
  const assignee = team.find((p) => p.id === list.assignedTo)?.name;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={home ? { href: `${base}/projects/${home.id}`, label: home.name } : { href: `${base}/checklists`, label: w.checklist.back }}
        title={list.title}
        meta={[
          <span key="progress">{fillWords(w.progress, { done: list.done.length, total })}</span>,
          ...(list.dueAt ? [<span key="due">{fillWords(w.due, { date: adminDate(store, list.dueAt, list.allDay ? "day" : "dayTime", lang) })}</span>] : []),
          ...(assignee ? [<span key="who">{assignee}</span>] : []),
          ...(list.archived > 0 ? [<span key="archived">{countWords(list.archived, w.checklist.archived)}</span>] : []),
          ...(list.status !== "open" ? [<span key="state">{w.checklistStates[list.status]}</span>] : []),
          ...list.projects.map((p) => (
            <AdminLink key={p.id} href={`${base}/projects/${p.id}`} className="underline-offset-2 hover:underline">
              {p.name}
            </AdminLink>
          )),
        ]}
        actions={
          <ButtonLink kind="quiet" href={`${base}/checklists/${list.id}/settings`}>
            {w.checklist.customise}
          </ButtonLink>
        }
      />
      {list.description && <p className="max-w-prose text-body text-ink-2">{list.description}</p>}
      <ChecklistView
        list={{ id: list.id, title: list.title, isRoutine: list.isRoutine, features: list.features }}
        entries={entries}
        done={list.done.map(toView)}
        statuses={list.statuses.map((s) => ({ id: s.id, name: s.name, colour: s.colour, bucket: s.bucket }))}
        team={team}
        otherLists={lists.filter((l) => l.id !== list.id && l.status !== "archived").map((l) => ({ id: l.id, title: l.title }))}
        folds={list.folds}
        canChange={canChange}
        timeZone={store.timeZone}
        lang={lang}
        locale={ADMIN_LANG_FACTS[lang].locale}
        currency={mainCurrency(store)}
        now={new Date().toISOString()}
        words={w}
        act={act}
      />
      {canChange && (
        <details className="flex flex-col gap-3">
          <summary className="cursor-pointer text-body-strong text-ink-2">{w.checklist.more}</summary>
          <div className="mt-3 flex flex-wrap items-start gap-3">
            {list.done.length > 0 && (
              <ActButton
                op={{ op: "list.reset", id: list.id }}
                act={act}
                label={w.checklist.reset}
                ask={{ question: fillWords(w.checklist.resetConfirm, { title: list.title }), confirm: w.checklist.reset, danger: false }}
                done={w.checklist.resetDone}
              />
            )}
            <DuplicateButton
              listId={list.id}
              name={fillWords(w.checklist.duplicateCopy, { title: list.title })}
              base={base}
              act={act}
              words={{
                label: w.checklist.duplicate,
                title: w.checklist.duplicateTitle,
                field: w.checklist.duplicateName,
                hint: w.checklist.duplicateHint,
                submit: w.checklist.duplicateMake,
                cancel: w.cancel,
              }}
            />
            {list.status === "open" ? (
              <ActButton op={{ op: "list.update", id: list.id, patch: { status: "done" } }} act={act} label={w.checklist.markDone} />
            ) : (
              <ActButton op={{ op: "list.update", id: list.id, patch: { status: "open" } }} act={act} label={w.checklist.reopen} />
            )}
            {list.status !== "archived" && <ActButton op={{ op: "list.update", id: list.id, patch: { status: "archived" } }} act={act} label={w.checklist.archiveList} kind="quiet" />}
            <ActButton
              op={{ op: "list.delete", id: list.id }}
              act={act}
              label={w.checklist.deleteList}
              kind="danger"
              after={home ? `${base}/projects/${home.id}` : `${base}/checklists`}
              ask={{ question: fillWords(w.checklist.deleteListConfirm, { title: list.title }), confirm: w.delete }}
            />
          </div>
        </details>
      )}
    </div>
  );
}
