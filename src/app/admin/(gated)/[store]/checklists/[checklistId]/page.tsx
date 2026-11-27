import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireExtension } from "@/components/admin/extension-off";
import { requireFeature } from "@/components/admin/feature-off";
import { ActButton } from "@/components/admin/projects/act-button";
import { DueCountdown } from "@/components/admin/projects/due-countdown";
import { DuplicateButton } from "@/components/admin/projects/duplicate-button";
import { RefreshWhile } from "@/components/admin/refresh-while";
import { ChecklistView, type ViewEntry, type ViewItem } from "@/components/admin/projects/checklist-view";
import { AdminLink, ButtonLink, PageHeader } from "@/components/admin/ui";
import { adminDate } from "@/lib/admin-date";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { PROJECTS_WORDS } from "@/lib/admin-words/projects";
import { mainCurrency } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { costSummary, dueTarget } from "@/lib/projects-views";
import { memberCan, requirePermission } from "@/server/permissions";
import { teamOf } from "@/server/projects";
import { labelsOf } from "@/server/projects-labels";
import { checklistDetail, listChecklists, listFingerprint, type ChecklistItem } from "@/server/projects-lists";
import { ensureDefaultStatuses } from "@/server/projects-statuses";
import { customerLinks, sourceLinks } from "@/server/projects-sources";
import { dealLinks } from "@/server/projects-deals";
import { listWork, taskMinutes, workPairOn } from "@/server/projects-work";
import { remindersOf } from "@/server/projects-reminders";
import { todayIn } from "@/lib/work-dates";
import { formatDuration } from "@/lib/work-time";

import { findTaskCustomersAction, listStatusAction, projectsAction } from "../../projects/actions";

export const metadata: Metadata = { title: "Checklist" };

/**
 * A checklist (D903, Life's `app/app/checklists/[id]`): its tasks to add and tick, sections, the Done line and each task's editor
 * (`ChecklistView`). The header says how far it has come, when it is due and which projects it is in; More holds what is done to the whole
 * list (untick everything, duplicate it, mark it done or archive it, delete it), Customise how it works.
 */
export default async function ChecklistPage({ params }: PageProps<"/admin/[store]/checklists/[checklistId]">) {
  const { store: slug, checklistId } = await params;
  const member = await requirePermission(slug, "projects:read");
  // Projects is a paid extension (D904): an account without it sees what it is and how to add it.
  const notInAccount = requireExtension(member, "projects");
  if (notInAccount) return notInAccount;
  const off = requireFeature(member, "projects");
  if (off) return off;
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = PROJECTS_WORDS[lang];
  await ensureDefaultStatuses(store.id, w.defaults);
  // Work's pair (D904 P8.3d): a list whose time goes to an assignment shows it, and its tasks their time, while the store has Work.
  const withWork = workPairOn(member);
  const [list, lists, team, labels, drawnAs, work, minutes, reminders] = await Promise.all([
    checklistDetail(store.id, checklistId, member.account.id, store.timeZone),
    listChecklists(store.id),
    teamOf(store.id),
    labelsOf(store.id),
    listFingerprint(store.id, checklistId),
    withWork ? listWork(store.id, checklistId) : null,
    withWork ? taskMinutes(store.id, checklistId) : {},
    remindersOf(store.id, checklistId),
  ]);
  if (!list) notFound();
  const canChange = memberCan(member, "projects:write");
  const act = projectsAction.bind(null, store.slug);
  const base = `/admin/${store.slug}`;
  const total = list.done.length + list.entries.filter((e) => e.kind === "item").length;
  const home = list.projects.find((p) => p.id === list.primaryProjectId);
  const toView = (item: ChecklistItem): ViewItem => ({ ...item, subtasks: item.subtasks.map((s) => ({ id: s.id, title: s.title, done: s.done, isGoal: s.isGoal })) });
  // Where tasks came from (D904 P8.3a): links back to orders, returns, reviews and conversations, while their arms are there.
  const tasks = [...list.entries.flatMap((e) => (e.kind === "item" ? [e.item] : [])), ...list.done];
  // Who tasks are about (P4.7): a link to each customer's page, and the editor's field, for a person who may read customers; and the deal
  // each is a next step of (D910), while the store has Deals.
  const [sources, about, deals] = await Promise.all([sourceLinks(member, tasks, w.sources), customerLinks(member, tasks), dealLinks(member, tasks)]);
  const customers = memberCan(member, "customers:read") ? { links: about, find: findTaskCustomersAction.bind(null, store.slug) } : undefined;
  const entries: ViewEntry[] = list.entries.map((e) => (e.kind === "section" ? { kind: "section", section: { id: e.section.id, title: e.section.title } } : { kind: "item", item: toView(e.item) }));
  const assignee = team.find((p) => p.id === list.assignedTo)?.name;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const drawn = new Date();
  const now = drawn.getTime();
  const costs = list.features.cost ? costSummary(tasks) : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={home ? { href: `${base}/projects/${home.id}`, label: home.name } : { href: `${base}/checklists`, label: w.checklist.back }}
        title={list.title}
        meta={[
          <span key="progress">{fillWords(w.progress, { done: list.done.length, total })}</span>,
          ...(list.dueAt ? [<span key="due">{fillWords(w.due, { date: adminDate(store, list.dueAt, list.allDay ? "day" : "dayTime", lang) })}</span>] : []),
          ...(list.dueAt && list.status === "open"
            ? [<DueCountdown key="countdown" target={dueTarget(list.dueAt, list.allDay, store.timeZone)} now={now} locale={locale} words={{ left: w.checklist.left, late: w.checklist.late }} />]
            : []),
          ...(assignee ? [<span key="who">{assignee}</span>] : []),
          ...(list.archived > 0 ? [<span key="archived">{countWords(list.archived, w.checklist.archived)}</span>] : []),
          ...(list.status !== "open" ? [<span key="state">{w.checklistStates[list.status]}</span>] : []),
          ...(list.asTemplate ? [<span key="template">{w.listSettings.template}</span>] : []),
          ...(work
            ? [
                <AdminLink key="work" href={`/admin/account/work/s/${store.slug}/assignments/${work.assignmentId}`} className="underline-offset-2 hover:underline" data-list-assignment>
                  {`${work.client} · ${work.assignment}`}
                  {work.minutes > 0 ? ` · ${fillWords(w.work.total, { time: formatDuration(work.minutes) })}` : ""}
                </AdminLink>,
              ]
            : []),
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
      {/* A teammate's change appears within twenty seconds while the page is shown (P4.10). */}
      <RefreshWhile seconds={20} status={listStatusAction.bind(null, store.slug, list.id)} drawn={drawnAs ?? undefined} />
      {list.description && <p className="max-w-prose text-body text-ink-2">{list.description}</p>}
      {costs.map((c) => (
        <p key={c.currency} className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted tabular-nums">
          <span className="text-ink">{fillWords(w.checklist.costTotal, { amount: formatMoney(c.total, c.currency, locale) })}</span>
          <span>{fillWords(w.checklist.costDone, { amount: formatMoney(c.done, c.currency, locale) })}</span>
          <span>{fillWords(w.checklist.costLeft, { amount: formatMoney(c.remaining, c.currency, locale) })}</span>
        </p>
      ))}
      <ChecklistView
        list={{ id: list.id, title: list.title, isRoutine: list.isRoutine, features: list.features }}
        entries={entries}
        done={list.done.map(toView)}
        statuses={list.statuses.map((s) => ({ id: s.id, name: s.name, colour: s.colour, bucket: s.bucket }))}
        labels={labels.map((l) => ({ id: l.id, kind: l.kind, name: l.name, colour: l.colour }))}
        me={member.account.id}
        team={team}
        otherLists={lists.filter((l) => l.id !== list.id && l.status !== "archived").map((l) => ({ id: l.id, title: l.title }))}
        folds={list.folds}
        canChange={canChange}
        timeZone={store.timeZone}
        lang={lang}
        locale={locale}
        currency={mainCurrency(store)}
        now={drawn.toISOString()}
        words={w}
        act={act}
        sources={sources}
        time={work ? { minutes, canLog: workPairOn(member, true), today: todayIn(store.timeZone) } : undefined}
        reminders={reminders.items}
        customers={customers}
        deals={deals}
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
