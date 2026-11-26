"use client";

import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type Announcements, type DragEndEvent } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useOptimistic } from "react";

import { EmptyState } from "@/components/admin/ui/empty-state";
import { Select } from "@/components/admin/ui/field";
import { fillWords } from "@/lib/admin-fill";
import type { ProjectsMessages } from "@/lib/admin-messages/projects.en";
import type { ProjectColour } from "@/lib/projects-model";

import { ColourDot, StatusPill } from "./parts";
import { useAct, type ProjectsAct } from "./use-act";

/** A task as the board draws it: every text made by the page in the viewer's words. */
export type BoardCardView = {
  id: string;
  title: string;
  /** Its list's page, where it is edited. */
  href: string;
  list: string;
  done: boolean;
  stageId: string;
  status: { name: string; colour: ProjectColour } | null;
  facts: string[];
};

export type BoardStageView = { id: string; name: string; colour: ProjectColour };

/**
 * A project's board (D903, Life's `task-project-kanban.tsx`): a column per stage of the project, each task in its stage (no stage is the
 * first). A task is dragged to another column, or sent there with its own *Move to* (the way for a keyboard and a screen reader); the move
 * shows at once and the page's next drawing confirms it. A task's stage is where it sits in this project's process; its own status, shown on
 * the card, says what the work is, and neither changes the other.
 */
export function ProjectBoard({
  projectId,
  stages,
  cards,
  canChange,
  words,
  act,
}: {
  projectId: string;
  stages: BoardStageView[];
  cards: BoardCardView[];
  canChange: boolean;
  words: ProjectsMessages["board"];
  act: ProjectsAct;
}) {
  const w = words;
  const { run, said } = useAct(act);
  const [shown, move] = useOptimistic(cards, (state, change: { id: string; stageId: string }) => state.map((c) => (c.id === change.id ? { ...c, stageId: change.stageId } : c)));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const stageName = (id: string | number) => stages.find((s) => s.id === id)?.name ?? "";
  const cardOf = (id: string | number) => cards.find((c) => c.id === id);

  const choose = (card: BoardCardView, stageId: string) => {
    if (!stageId || card.stageId === stageId) return;
    run({ op: "project.stage", projectId, itemId: card.id, stageId }, undefined, () => move({ id: card.id, stageId }));
  };
  const onDragEnd = (event: DragEndEvent) => {
    const card = cardOf(event.active.id);
    if (card && event.over) choose(card, String(event.over.id));
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => fillWords(w.picked, { title: cardOf(active.id)?.title ?? "" }),
    onDragOver: ({ over }) => (over ? fillWords(w.over, { stage: stageName(over.id) }) : undefined),
    onDragEnd: ({ active, over }) => (over ? fillWords(w.dropped, { title: cardOf(active.id)?.title ?? "", stage: stageName(over.id) }) : w.cancelled),
    onDragCancel: () => w.cancelled,
  };

  return (
    <div className="flex flex-col gap-3">
      {canChange && <p className="text-sm text-muted">{w.dragHint}</p>}
      <DndContext sensors={sensors} onDragEnd={onDragEnd} accessibility={{ announcements }}>
        <div role="region" aria-label={w.label} className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          {stages.map((stage) => (
            <Column key={stage.id} stage={stage} stages={stages} cards={shown.filter((c) => c.stageId === stage.id)} canChange={canChange} words={w} onChoose={choose} />
          ))}
        </div>
      </DndContext>
      <p role="status" aria-live="polite" className="text-sm text-danger-text">
        {said}
      </p>
    </div>
  );
}

function Column({
  stage,
  stages,
  cards,
  canChange,
  words,
  onChoose,
}: {
  stage: BoardStageView;
  stages: BoardStageView[];
  cards: BoardCardView[];
  canChange: boolean;
  words: ProjectsMessages["board"];
  onChoose: (card: BoardCardView, stageId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, disabled: !canChange });
  const headingId = `stage-${stage.id}`;
  return (
    <section ref={setNodeRef} aria-labelledby={headingId} className={`flex w-72 shrink-0 snap-start flex-col gap-3 rounded-panel p-3 ${isOver ? "bg-brand-soft" : "bg-sunken"}`}>
      <header className="flex items-center gap-2">
        <ColourDot colour={stage.colour} />
        <h2 id={headingId} className="text-title text-ink">
          {stage.name}
        </h2>
        <span className="text-sm text-muted tabular-nums">{cards.length}</span>
      </header>
      {cards.length === 0 ? (
        <EmptyState compact title={words.emptyColumn} />
      ) : (
        <ul className="flex flex-col gap-2">
          {cards.map((card) => (
            <Card key={card.id} card={card} stages={stages} canChange={canChange} words={words} onChoose={onChoose} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Card({
  card,
  stages,
  canChange,
  words,
  onChoose,
}: {
  card: BoardCardView;
  stages: BoardStageView[];
  canChange: boolean;
  words: ProjectsMessages["board"];
  onChoose: (card: BoardCardView, stageId: string) => void;
}) {
  const { setNodeRef, listeners, attributes, transform, isDragging } = useDraggable({ id: card.id, disabled: !canChange });
  return (
    <li
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={`flex flex-col gap-2 rounded-md border border-line bg-card p-3 text-sm ${canChange ? "cursor-grab touch-manipulation" : ""} ${isDragging ? "relative z-10 shadow-lg" : ""}`}
    >
      <a href={card.href} className={`font-medium underline-offset-2 hover:underline ${card.done ? "text-muted line-through" : "text-ink"}`}>
        {card.title}
      </a>
      <p className="text-muted">{card.list}</p>
      {(card.status || card.facts.length > 0) && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-2">
          {card.status && <StatusPill colour={card.status.colour}>{card.status.name}</StatusPill>}
          {card.facts.map((fact) => (
            <span key={fact}>{fact}</span>
          ))}
        </p>
      )}
      {canChange && (
        <Select
          aria-label={fillWords(words.moveLabel, { title: card.title })}
          value=""
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => onChoose(card, e.target.value)}
          dense
        >
          <option value="">{words.moveTo}</option>
          {stages
            .filter((s) => s.id !== card.stageId)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </Select>
      )}
    </li>
  );
}
