"use client";

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { useOptimistic, useState, type ReactNode } from "react";

import { Button } from "@/components/admin/ui/button";
import { ConfirmButton } from "@/components/admin/ui/confirm-button";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { Select, TextInput } from "@/components/admin/ui/field";
import { adminDate } from "@/lib/admin-date";
import { countWords, fillWords } from "@/lib/admin-fill";
import type { AdminLang } from "@/lib/admin-lang";
import type { ProjectsMessages } from "@/lib/admin-messages/projects.en";
import { formatMoney } from "@/lib/money";
import { dueState } from "@/lib/projects-dates";
import type { ChecklistFeatures } from "@/lib/projects-features";
import type { ProjectColour, StatusBucket } from "@/lib/projects-model";

import { DragHandle } from "./drag-handle";
import { ItemEditor, type EditorItem } from "./item-editor";
import { StatusPill } from "./parts";
import { useAct, type ProjectsAct } from "./use-act";

export type ViewItem = EditorItem & { sortOrder: number; subtasks: (EditorItem["subtasks"][number] & { sortOrder?: number })[] };
export type ViewEntry = { kind: "section"; section: { id: string; title: string } } | { kind: "item"; item: ViewItem };
export type ViewStatus = { id: string; name: string; colour: ProjectColour; bucket: StatusBucket };

export type ChecklistWords = Pick<ProjectsMessages, "checklist" | "item" | "priorities" | "cancel" | "save" | "delete" | "none" | "nobody" | "due">;

type Props = {
  list: { id: string; title: string; isRoutine: boolean; features: ChecklistFeatures };
  entries: ViewEntry[];
  done: ViewItem[];
  statuses: ViewStatus[];
  team: { id: string; name: string }[];
  /** The store's other lists, where tasks can be moved. */
  otherLists: { id: string; title: string }[];
  folds: string[];
  canChange: boolean;
  timeZone: string;
  lang: AdminLang;
  locale: string;
  currency: string;
  now: string;
  words: ChecklistWords;
  act: ProjectsAct;
};

const keyOf = (e: ViewEntry) => (e.kind === "section" ? `section:${e.section.id}` : `item:${e.item.id}`);

/**
 * A checklist (D903, Life's `checklist-detail-body.tsx` and `checklist-items-sortable-list.tsx`): Homer types a task and presses Enter
 * (several pasted lines are a task each) and ticks it off; a ticked task sinks below the Done line. Lisa drags tasks and sections into one
 * order (a handle, or the keyboard), folds a section or the Done line for herself, opens a task for its fields and subtasks, and with Select
 * gives many tasks a status, moves, archives or deletes them. Every change shows at once and the page's next drawing confirms it; a refusal
 * is said in the line at the foot.
 */
export function ChecklistView(props: Props) {
  const { list, statuses, team, canChange, words } = props;
  const w = words.checklist;
  const { run, said } = useAct(props.act);
  const [entries, reorder] = useOptimistic(props.entries, (_state, next: ViewEntry[]) => next);
  const [ticked, tick] = useOptimistic(new Map<string, boolean>(), (state, change: { id: string; done: boolean }) => new Map(state).set(change.id, change.done));
  const [folds, fold] = useOptimistic(new Set(props.folds), (state, change: { key: string; folded: boolean }) => {
    const next = new Set(state);
    if (change.folded) next.add(change.key);
    else next.delete(change.key);
    return next;
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState("");
  const [sectionDraft, setSectionDraft] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const allItems = [...props.entries.flatMap((e) => (e.kind === "item" ? [e.item] : [])), ...props.done];
  const isDone = (item: ViewItem) => ticked.get(item.id) ?? item.done;
  const editingItem = allItems.find((i) => i.id === editing) ?? null;
  const statusOf = (id: string | null) => statuses.find((s) => s.id === id) ?? null;
  const personOf = (id: string | null) => team.find((p) => p.id === id)?.name ?? null;
  const now = new Date(props.now);

  const add = () => {
    const titles = draft
      .split(/\r?\n/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (titles.length === 0) return;
    run({ op: "item.add", checklistId: list.id, titles }, (answer) => answer.ok && setDraft(""));
  };
  const setDone = (item: ViewItem, done: boolean) => run({ op: "item.done", id: item.id, done }, undefined, () => tick({ id: item.id, done }));
  const toggleFold = (key: string, sectionId: string | null) => {
    const folded = !folds.has(key);
    run({ op: "list.fold", id: list.id, sectionId, folded }, undefined, () => fold({ key, folded }));
  };
  const onDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return;
    const from = entries.findIndex((e) => keyOf(e) === event.active.id);
    const to = entries.findIndex((e) => keyOf(e) === event.over?.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(entries, from, to);
    run(
      { op: "entries.reorder", checklistId: list.id, entries: next.map((e) => (e.kind === "section" ? { kind: "section" as const, id: e.section.id } : { kind: "item" as const, id: e.item.id })) },
      undefined,
      () => reorder(next),
    );
  };
  const toggleSelected = (id: string) =>
    setSelected((state) => {
      const next = new Set(state);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const bulk = (op: "status" | "move" | "archive" | "delete", value?: string) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const done = (answer: { ok: boolean }) => {
      if (answer.ok) setSelected(new Set());
    };
    if (op === "status") run({ op: "item.status", ids, statusId: value || null }, done);
    if (op === "move" && value) run({ op: "item.move", ids, checklistId: value }, done);
    if (op === "archive") run({ op: "item.archive", ids, archived: true }, done);
    if (op === "delete") run({ op: "item.delete", ids }, done);
  };

  // A folded section hides the tasks after it, up to the next section.
  const sectionAbove = (index: number) => entries.slice(0, index).findLast((e) => e.kind === "section");
  const shown = entries.filter((entry, index) => {
    if (entry.kind === "section") return true;
    const above = sectionAbove(index);
    return !(above?.kind === "section" && folds.has(above.section.id)) && !isDone(entry.item);
  });
  const countUnder = (sectionId: string) => {
    const at = entries.findIndex((e) => e.kind === "section" && e.section.id === sectionId);
    let n = 0;
    for (const e of entries.slice(at + 1)) {
      if (e.kind === "section") break;
      if (!isDone(e.item)) n += 1;
    }
    return n;
  };
  const doneItems = [...props.done.filter((i) => isDone(i)), ...props.entries.flatMap((e) => (e.kind === "item" && isDone(e.item) && !e.item.done ? [e.item] : []))];
  const openCount = allItems.filter((i) => !isDone(i)).length;

  const row = (item: ViewItem, sortable: boolean) => (
    <ItemRow
      key={item.id}
      item={item}
      done={isDone(item)}
      sortable={sortable && canChange && !selecting}
      selecting={selecting}
      selected={selected.has(item.id)}
      onSelect={() => toggleSelected(item.id)}
      onDone={(done) => setDone(item, done)}
      onOpen={() => setEditing(item.id)}
      canChange={canChange}
      words={w}
    >
      <ItemFacts item={item} features={list.features} status={statusOf(item.statusId)} person={personOf(item.assignedTo)} props={props} now={now} />
    </ItemRow>
  );

  return (
    <div className="flex flex-col gap-4">
      {canChange && (
        <form
          className="flex flex-col gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <label htmlFor={`add-${list.id}`} className="text-sm font-medium">
            {w.addLabel}
          </label>
          <div className="flex gap-2">
            <TextInput
              id={`add-${list.id}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text");
                if (!text.includes("\n")) return;
                e.preventDefault();
                setDraft(text);
              }}
              aria-describedby={`add-${list.id}-hint`}
              maxLength={20000}
              full
            />
            <Button type="submit" kind="main" disabled={!draft.trim()}>
              {w.add}
            </Button>
          </div>
          <p id={`add-${list.id}-hint`} className="text-xs text-muted">
            {draft.includes("\n") ? countWords(draft.split(/\r?\n/).filter((t) => t.trim()).length, w.pasted) : w.addHint}
          </p>
        </form>
      )}

      {canChange && allItems.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">{selecting ? countWords(selected.size, w.selected) : w.dragHint}</p>
          <Button
            kind="quiet"
            size="dense"
            aria-pressed={selecting}
            onClick={() => {
              setSelecting((s) => !s);
              setSelected(new Set());
            }}
          >
            {selecting ? w.selectDone : w.selectMode}
          </Button>
        </div>
      )}

      {selecting && selected.size > 0 && (
        <div role="toolbar" aria-label={w.bulkLabel} className="flex flex-wrap items-center gap-2 rounded-panel bg-sunken p-3">
          {list.features.status && (
            <Select aria-label={w.bulkStatus} value="" onChange={(e) => bulk("status", e.target.value)} dense>
              <option value="">{w.bulkStatus}</option>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
          {props.otherLists.length > 0 && (
            <Select aria-label={w.bulkMove} value="" onChange={(e) => bulk("move", e.target.value)} dense>
              <option value="">{w.bulkMove}</option>
              {props.otherLists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </Select>
          )}
          <Button size="dense" onClick={() => bulk("archive")}>
            {w.bulkArchive}
          </Button>
          <ConfirmButton size="dense" kind="danger" question={countWords(selected.size, w.bulkDeleteConfirm)} confirm={words.delete} action={() => bulk("delete")}>
            {w.bulkDelete}
          </ConfirmButton>
        </div>
      )}

      {openCount === 0 && entries.every((e) => e.kind === "item") ? (
        <EmptyState compact title={allItems.length === 0 ? w.empty : w.allDone} />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={shown.map(keyOf)} strategy={verticalListSortingStrategy}>
            <ul className="flex flex-col rounded-panel border border-line bg-card">
              {shown.map((entry) =>
                entry.kind === "section" ? (
                  <SectionRow
                    key={keyOf(entry)}
                    section={entry.section}
                    folded={folds.has(entry.section.id)}
                    count={countUnder(entry.section.id)}
                    onFold={() => toggleFold(entry.section.id, entry.section.id)}
                    canChange={canChange && !selecting}
                    words={words}
                    run={run}
                  />
                ) : (
                  row(entry.item, true)
                ),
              )}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {canChange &&
        (sectionDraft === null ? (
          <Button kind="quiet" size="dense" className="self-start" onClick={() => setSectionDraft("")}>
            {w.addSection}
          </Button>
        ) : (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (sectionDraft.trim()) run({ op: "section.add", checklistId: list.id, title: sectionDraft }, (answer) => answer.ok && setSectionDraft(null));
            }}
          >
            <TextInput aria-label={w.sectionTitle} value={sectionDraft} onChange={(e) => setSectionDraft(e.target.value)} maxLength={120} autoFocus full />
            <Button type="submit" disabled={!sectionDraft.trim()}>
              {w.addSection}
            </Button>
            <Button kind="quiet" onClick={() => setSectionDraft(null)}>
              {words.cancel}
            </Button>
          </form>
        ))}

      {doneItems.length > 0 && (
        <section aria-labelledby={`done-${list.id}`} className="flex flex-col gap-2">
          <h2 id={`done-${list.id}`}>
            <button
              type="button"
              aria-expanded={!folds.has("done")}
              aria-label={fillWords(folds.has("done") ? w.unfold : w.fold, { title: w.doneLine })}
              onClick={() => toggleFold("done", null)}
              className="flex items-center gap-2 text-body-strong text-ink-2"
            >
              {folds.has("done") ? <ChevronRight className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}
              {w.doneLine} <span className="text-muted tabular-nums">{doneItems.length}</span>
            </button>
          </h2>
          {!folds.has("done") && <ul className="flex flex-col rounded-panel border border-line bg-card">{doneItems.map((item) => row(item, false))}</ul>}
        </section>
      )}

      <p role="status" aria-live="polite" className="text-sm text-danger-text">
        {said}
      </p>

      {editingItem && (
        <ItemEditor
          key={editingItem.id}
          item={editingItem}
          features={list.features}
          statuses={statuses}
          team={team}
          others={allItems.filter((i) => i.id !== editingItem.id).map((i) => ({ id: i.id, title: i.title }))}
          timeZone={props.timeZone}
          currency={props.currency}
          words={words}
          act={props.act}
          canChange={canChange}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** What a task's row says besides its title: only the fields its list uses. */
function ItemFacts({ item, features, status, person, props, now }: { item: ViewItem; features: ChecklistFeatures; status: ViewStatus | null; person: string | null; props: Props; now: Date }) {
  const w = props.words;
  const facts: ReactNode[] = [];
  if (features.status && status) facts.push(<StatusPill key="status" colour={status.colour}>{status.name}</StatusPill>);
  if (features.status && (item.blockedReason || item.blockedByItemId)) facts.push(<span key="blocked" className="text-chip text-warning-text">{w.checklist.blocked}</span>);
  if (features.priority && item.priority) facts.push(<span key="priority" className="text-chip text-ink-2">{w.priorities[item.priority]}</span>);
  if (features.dueDate && item.dueAt) {
    const state = item.done ? "later" : dueState(item.dueAt, item.allDay, now, props.timeZone);
    facts.push(
      <span key="due" className={`text-chip tabular-nums ${state === "late" ? "text-danger-text" : state === "today" ? "text-warning-text" : "text-ink-2"}`}>
        {fillWords(w.due, { date: adminDate(props.timeZone, item.dueAt, item.allDay ? "day" : "dayTime", props.lang) })}
      </span>,
    );
  }
  if (features.assignment && person) facts.push(<span key="person" className="text-chip text-ink-2">{person}</span>);
  if (features.subtasks && item.subtasks.length > 0) {
    facts.push(
      <span key="steps" className="text-chip text-ink-2 tabular-nums">
        {fillWords(w.checklist.subtasks, { done: item.subtasks.filter((s) => s.done).length, total: item.subtasks.length })}
      </span>,
    );
  }
  if (features.cost && item.cost) facts.push(<span key="cost" className="text-chip text-ink-2 tabular-nums">{formatMoney(item.cost.minor, item.cost.currency, props.locale)}</span>);
  return facts.length > 0 ? <span className="flex flex-wrap items-center gap-x-3 gap-y-1">{facts}</span> : null;
}

function ItemRow({
  item,
  done,
  sortable,
  selecting,
  selected,
  onSelect,
  onDone,
  onOpen,
  canChange,
  words,
  children,
}: {
  item: ViewItem;
  done: boolean;
  sortable: boolean;
  selecting: boolean;
  selected: boolean;
  onSelect: () => void;
  onDone: (done: boolean) => void;
  onOpen: () => void;
  canChange: boolean;
  words: ChecklistWords["checklist"];
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: `item:${item.id}`, disabled: !sortable });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-start gap-3 border-b border-line px-3 py-2.5 last:border-b-0 ${isDragging ? "relative z-10 bg-card shadow-lg" : ""}`}
    >
      {sortable && (
        <DragHandle handle={setActivatorNodeRef} {...attributes} {...listeners} label={fillWords(words.drag, { title: item.title })} className="mt-0.5" />
      )}
      {selecting ? (
        <input type="checkbox" checked={selected} onChange={onSelect} aria-label={fillWords(words.select, { title: item.title })} className="mt-1 size-4 shrink-0 accent-brand" />
      ) : (
        <input
          type="checkbox"
          checked={done}
          disabled={!canChange}
          onChange={(e) => onDone(e.target.checked)}
          aria-label={fillWords(words.tick, { title: item.title })}
          className="mt-1 size-4 shrink-0 accent-brand"
        />
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <button
          type="button"
          onClick={onOpen}
          aria-label={fillWords(words.edit, { title: item.title })}
          className={`text-left text-body underline-offset-2 hover:underline ${done ? "text-muted line-through" : "text-ink"}`}
        >
          {item.title}
        </button>
        {children}
      </span>
    </li>
  );
}

function SectionRow({
  section,
  folded,
  count,
  onFold,
  canChange,
  words,
  run,
}: {
  section: { id: string; title: string };
  folded: boolean;
  count: number;
  onFold: () => void;
  canChange: boolean;
  words: ChecklistWords;
  run: ReturnType<typeof useAct>["run"];
}) {
  const w = words.checklist;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: `section:${section.id}`, disabled: !canChange });
  const [renaming, setRenaming] = useState<string | null>(null);
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-3 border-b border-line bg-sunken px-3 py-2 last:border-b-0 ${isDragging ? "relative z-10 shadow-lg" : ""}`}
    >
      {canChange && (
        <DragHandle handle={setActivatorNodeRef} {...attributes} {...listeners} label={fillWords(w.drag, { title: section.title })} />
      )}
      {renaming === null ? (
        <button
          type="button"
          aria-expanded={!folded}
          aria-label={fillWords(folded ? w.unfold : w.fold, { title: section.title })}
          onClick={onFold}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-body-strong text-ink"
        >
          {folded ? <ChevronRight className="size-4 shrink-0" aria-hidden /> : <ChevronDown className="size-4 shrink-0" aria-hidden />}
          <span className="truncate">{section.title}</span>
          {folded && count > 0 && <span className="text-muted tabular-nums">{count}</span>}
        </button>
      ) : (
        <form
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (renaming.trim()) run({ op: "section.rename", id: section.id, title: renaming }, (answer) => answer.ok && setRenaming(null));
          }}
        >
          <TextInput aria-label={w.sectionTitle} value={renaming} onChange={(e) => setRenaming(e.target.value)} maxLength={120} autoFocus dense full />
          <Button type="submit" size="dense" disabled={!renaming.trim()}>
            {words.save}
          </Button>
          <Button kind="quiet" size="dense" onClick={() => setRenaming(null)}>
            {words.cancel}
          </Button>
        </form>
      )}
      {canChange && renaming === null && (
        <span className="flex shrink-0 items-center gap-1">
          <Button kind="icon" size="dense" aria-label={fillWords(w.renameSection, { title: section.title })} onClick={() => setRenaming(section.title)}>
            <Pencil />
          </Button>
          <ConfirmButton
            kind="icon"
            size="dense"
            aria-label={fillWords(w.deleteSection, { title: section.title })}
            question={fillWords(w.deleteSectionConfirm, { title: section.title })}
            confirm={words.delete}
            action={() => run({ op: "section.delete", id: section.id })}
            icon={<Trash2 />}
          />
        </span>
      )}
    </li>
  );
}
