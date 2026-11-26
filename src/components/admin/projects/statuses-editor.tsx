"use client";

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Trash2 } from "lucide-react";
import { useOptimistic, useState } from "react";

import { Modal } from "@/components/admin/modal";
import { Button } from "@/components/admin/ui/button";
import { Select, TextInput } from "@/components/admin/ui/field";
import { fillWords } from "@/lib/admin-fill";
import type { ProjectsMessages } from "@/lib/admin-messages/projects.en";
import { PROJECT_COLOURS, STATUS_BUCKETS, type ProjectColour, type StatusBucket } from "@/lib/projects-model";

import { DragHandle } from "./drag-handle";
import { ColourDot } from "./parts";
import { useAct, type ProjectsAct } from "./use-act";

export type EditorStatus = { id: string; name: string; colour: ProjectColour; bucket: StatusBucket };
export type StatusEditorWords = Pick<ProjectsMessages, "statusEditor" | "buckets" | "colours" | "cancel" | "save" | "delete">;

/**
 * The statuses of a scope (D903, Life's `workflow-status-editor.tsx`): the store's task statuses or project stages, or a list's or a
 * project's own. Each has a name, a colour and what it counts as (open, done, archived); dragged by its handle (or moved with the keyboard)
 * into order; deleted with what used it moved to another first. A change is saved as it is made.
 */
export function StatusesEditor({
  kind,
  scopeId,
  statuses,
  canChange,
  words,
  act,
}: {
  kind: "checklist" | "project";
  scopeId: string | null;
  statuses: EditorStatus[];
  canChange: boolean;
  words: StatusEditorWords;
  act: ProjectsAct;
}) {
  const w = words.statusEditor;
  const { run, said, pending } = useAct(act);
  const [shown, reorder] = useOptimistic(statuses, (_state, next: EditorStatus[]) => next);
  const [removing, setRemoving] = useState<EditorStatus | null>(null);
  const [replacement, setReplacement] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const save = (status: EditorStatus, change: Partial<EditorStatus>) => {
    const next = { ...status, ...change };
    if (!next.name.trim()) return;
    run({ op: "status.update", kind, id: status.id, input: { name: next.name, colour: next.colour, bucket: next.bucket } });
  };
  const onDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return;
    const from = shown.findIndex((s) => s.id === event.active.id);
    const to = shown.findIndex((s) => s.id === event.over?.id);
    const next = arrayMove(shown, from, to);
    run({ op: "status.reorder", kind, scopeId, ids: next.map((s) => s.id) }, undefined, () => reorder(next));
  };

  return (
    <div className="flex flex-col gap-3">
      {canChange && <p className="text-sm text-muted">{w.dragHint}</p>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={shown.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col rounded-panel border border-line bg-card">
            {shown.map((status) => (
              <Row key={status.id} status={status} canChange={canChange} canRemove={shown.length > 1} words={words} onSave={save} onRemove={() => {
                  setReplacement(shown.find((s) => s.id !== status.id)?.id ?? "");
                  setRemoving(status);
                }} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {canChange && (
        <Button
          kind="quiet"
          size="dense"
          className="self-start"
          disabled={pending}
          onClick={() => run({ op: "status.add", kind, scopeId, input: { name: kind === "project" ? w.newStage : w.newStatus, colour: "neutral", bucket: "active" } })}
        >
          {kind === "project" ? w.addStage : w.add}
        </Button>
      )}
      <p role="status" aria-live="polite" className="text-sm text-danger-text">
        {said}
      </p>
      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={fillWords(w.removeTitle, { name: removing?.name ?? "" })}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button kind="quiet" onClick={() => setRemoving(null)}>
              {words.cancel}
            </Button>
            <Button
              kind="danger"
              disabled={!replacement}
              onClick={() => {
                if (removing) run({ op: "status.delete", kind, id: removing.id, replacementId: replacement });
                setRemoving(null);
              }}
            >
              {words.delete}
            </Button>
          </div>
        }
      >
        <div className="p-5">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.moveItemsTo}
            <Select value={replacement} onChange={(e) => setReplacement(e.target.value)} full>
              {shown
                .filter((s) => s.id !== removing?.id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Select>
          </label>
        </div>
      </Modal>
    </div>
  );
}

function Row({
  status,
  canChange,
  canRemove,
  words,
  onSave,
  onRemove,
}: {
  status: EditorStatus;
  canChange: boolean;
  canRemove: boolean;
  words: StatusEditorWords;
  onSave: (status: EditorStatus, change: Partial<EditorStatus>) => void;
  onRemove: () => void;
}) {
  const w = words.statusEditor;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: status.id, disabled: !canChange });
  const [name, setName] = useState(status.name);
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex flex-wrap items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0 ${isDragging ? "relative z-10 bg-card shadow-lg" : ""}`}
    >
      {canChange && (
        <DragHandle handle={setActivatorNodeRef} {...attributes} {...listeners} label={fillWords(w.move, { name: status.name })} />
      )}
      <ColourDot colour={status.colour} size="size-3" />
      <TextInput
        aria-label={w.name}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== status.name && onSave(status, { name })}
        maxLength={40}
        disabled={!canChange}
        dense
        className="min-w-32 flex-1"
      />
      <Select aria-label={w.colour} value={status.colour} onChange={(e) => onSave(status, { colour: e.target.value as ProjectColour })} disabled={!canChange} dense>
        {PROJECT_COLOURS.map((c) => (
          <option key={c} value={c}>
            {words.colours[c]}
          </option>
        ))}
      </Select>
      <Select aria-label={w.bucket} value={status.bucket} onChange={(e) => onSave(status, { bucket: e.target.value as StatusBucket })} disabled={!canChange} dense>
        {STATUS_BUCKETS.map((b) => (
          <option key={b} value={b}>
            {words.buckets[b]}
          </option>
        ))}
      </Select>
      {canChange && canRemove && (
        <Button kind="icon" size="dense" aria-label={fillWords(w.remove, { name: status.name })} onClick={onRemove}>
          <Trash2 />
        </Button>
      )}
    </li>
  );
}
