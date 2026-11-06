"use client";

import { DndContext, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type Announcements, type DragEndEvent } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";

import { Modal } from "@/components/admin/modal";
import { Button } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { DealsMessages } from "@/lib/admin-messages/deals.en";
import type { DealStatus } from "@/lib/deals";

/** One deal as the board draws it: every text made by the page in the viewer's words. */
export type BoardCard = {
  id: string;
  title: string;
  href: string;
  who: string | null;
  value: string | null;
  /** Where the value comes from when it is not the linked things' ("estimate"), or what it leaves out. */
  valueNote: string | null;
  days: string | null;
  closes: string | null;
  late: boolean;
  /** An open deal's next step (S3, D468): its earliest activity not done ("Next: call Mon 9 Nov"), or that it has none. */
  next: { text: string; late: boolean } | "none" | null;
};

export type BoardColumnView = { key: string; title: string; status: DealStatus; count: string; total: string | null; weighted: string | null; cards: BoardCard[] };
export type DealBoardWords = Pick<DealsMessages, "board" | "lost" | "statuses">;
export type PlaceDeal = (dealId: string, target: string, reason: string | null) => Promise<{ ok: boolean; message: string }>;

/**
 * The board of deals (S2, D464): a column per stage, then Won and Lost. A deal is dragged to another column, or sent there with its own
 * "Move to" (the way for a keyboard and a screen reader); Lost asks why first. The move shows at once and the page's next drawing confirms
 * it; a refusal is said in the line under the board. Members who may not change customers see the board without moving anything.
 */
export function DealBoard({ columns, words, place, canChange }: { columns: BoardColumnView[]; words: DealBoardWords; place: PlaceDeal; canChange: boolean }) {
  const w = words.board;
  const [shown, move] = useOptimistic(columns, (state, { dealId, to }: { dealId: string; to: string }) => {
    const card = state.flatMap((c) => c.cards).find((c) => c.id === dealId);
    if (!card) return state;
    return state.map((c) => ({ ...c, cards: c.key === to ? [card, ...c.cards.filter((x) => x.id !== dealId)] : c.cards.filter((x) => x.id !== dealId) }));
  });
  const [, start] = useTransition();
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [losing, setLosing] = useState<{ id: string; title: string } | null>(null);
  const [reason, setReason] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }));

  const titleOf = (key: string | number) => columns.find((c) => c.key === key)?.title ?? "";
  const cardOf = (id: string | number) => columns.flatMap((c) => c.cards).find((c) => c.id === id);
  const columnOf = (dealId: string) => shown.find((c) => c.cards.some((x) => x.id === dealId))?.key;

  const go = (dealId: string, to: string, why: string | null = null) =>
    start(async () => {
      move({ dealId, to });
      const result = await place(dealId, to, why);
      setSaid({ ok: result.ok, text: result.message });
    });
  const choose = (card: BoardCard, to: string) => {
    if (!to || columnOf(card.id) === to) return;
    if (to === "lost") {
      setReason("");
      setLosing({ id: card.id, title: card.title });
      return;
    }
    go(card.id, to);
  };
  const onDragEnd = (event: DragEndEvent) => {
    const card = cardOf(event.active.id);
    if (card && event.over) choose(card, String(event.over.id));
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => fillWords(w.picked, { title: cardOf(active.id)?.title ?? "" }),
    onDragOver: ({ over }) => (over ? fillWords(w.over, { stage: titleOf(over.id) }) : undefined),
    onDragEnd: ({ active, over }) => (over ? fillWords(w.dropped, { title: cardOf(active.id)?.title ?? "", stage: titleOf(over.id) }) : w.cancelled),
    onDragCancel: () => w.cancelled,
  };

  return (
    <div className="flex flex-col gap-3">
      {canChange && <p className="text-sm text-muted">{w.dragHint}</p>}
      <DndContext sensors={sensors} onDragEnd={onDragEnd} accessibility={{ announcements }}>
        <div aria-label={w.label} role="region" className="flex flex-col gap-4">
          {/* The open stages side by side (scrolling sideways when they do not fit); Won and Lost below, always in view and still places to drop. */}
          <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
            {shown
              .filter((column) => column.status === "open")
              .map((column) => (
                <Column key={column.key} column={column} targets={columns} words={words} canChange={canChange} onChoose={choose} />
              ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {shown
              .filter((column) => column.status !== "open")
              .map((column) => (
                <Column key={column.key} column={column} targets={columns} words={words} canChange={canChange} onChoose={choose} closed />
              ))}
          </div>
        </div>
      </DndContext>
      <p role="status" aria-live="polite" className={`text-sm ${said && !said.ok ? "text-danger-text" : "text-muted"}`}>
        {said?.text}
      </p>
      <Modal
        open={losing !== null}
        onClose={() => setLosing(null)}
        title={words.lost.title}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button kind="quiet" onClick={() => setLosing(null)}>
              {words.lost.cancel}
            </Button>
            <Button
              kind="danger"
              onClick={() => {
                if (losing) go(losing.id, "lost", reason.trim() || null);
                setLosing(null);
              }}
            >
              {words.lost.save}
            </Button>
          </div>
        }
      >
        <label className="flex flex-col gap-1 text-sm font-medium">
          {words.lost.reason}
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} className="min-h-10 rounded-md border border-line bg-card px-3 font-normal" />
          <span className="font-normal text-muted">{words.lost.reasonHint}</span>
        </label>
      </Modal>
    </div>
  );
}

function Column({
  column,
  targets,
  words,
  canChange,
  onChoose,
  closed = false,
}: {
  column: BoardColumnView;
  targets: BoardColumnView[];
  words: DealBoardWords;
  canChange: boolean;
  onChoose: (card: BoardCard, to: string) => void;
  /** Won or Lost: as wide as half the board, under the stages. */
  closed?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key, disabled: !canChange });
  const headingId = `deal-column-${column.key}`;
  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      className={`flex flex-col gap-3 rounded-panel p-3 ${closed ? "min-w-0" : "w-64 shrink-0 snap-start"} ${isOver ? "bg-brand-soft" : "bg-sunken"}`}
    >
      <header className="flex flex-col gap-0.5">
        <h2 id={headingId} className="text-title text-ink">
          {column.title}
        </h2>
        <p className="text-sm text-muted">
          {[column.count, column.total, column.weighted].filter(Boolean).join(" · ")}
        </p>
      </header>
      {column.cards.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">{words.board.emptyColumn}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {column.cards.map((card) => (
            <Card key={card.id} card={card} at={column.key} targets={targets} words={words} canChange={canChange} onChoose={onChoose} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Card({
  card,
  at,
  targets,
  words,
  canChange,
  onChoose,
}: {
  card: BoardCard;
  at: string;
  targets: BoardColumnView[];
  words: DealBoardWords;
  canChange: boolean;
  onChoose: (card: BoardCard, to: string) => void;
}) {
  const { setNodeRef, listeners, transform, isDragging } = useDraggable({ id: card.id, disabled: !canChange });
  const w = words.board;
  return (
    <li
      ref={setNodeRef}
      {...listeners}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={`flex flex-col gap-2 rounded-md border border-line bg-card p-3 text-sm ${canChange ? "cursor-grab touch-manipulation" : ""} ${isDragging ? "relative z-10 shadow-lg" : ""}`}
    >
      <Link href={card.href} className="font-medium text-ink underline-offset-2 hover:underline">
        {card.title}
      </Link>
      {card.who && <p className="text-ink-2">{card.who}</p>}
      <p className="text-ink">
        {card.value ?? <span className="text-muted">{w.noValue}</span>}
        {card.valueNote && <span className="text-muted"> · {card.valueNote}</span>}
      </p>
      {(card.days || card.closes) && (
        <p className="text-muted">
          {card.days}
          {card.days && card.closes && " · "}
          {card.closes && <span className={card.late ? "text-danger-text" : undefined}>{card.closes}</span>}
        </p>
      )}
      {card.next === "none" ? (
        <p className="text-warning-text">{w.noNext}</p>
      ) : (
        card.next && <p className={card.next.late ? "text-danger-text" : "text-ink-2"}>{card.next.text}</p>
      )}
      {canChange && (
        <select
          aria-label={fillWords(w.moveLabel, { title: card.title })}
          value=""
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => onChoose(card, e.target.value)}
          className="min-h-9 rounded-md border border-line bg-card px-2 text-sm text-ink-2"
        >
            <option value="">{w.moveTo}</option>
            {targets
              .filter((t) => t.key !== at)
              .map((t) => (
                <option key={t.key} value={t.key}>
                  {t.title}
                </option>
              ))}
        </select>
      )}
    </li>
  );
}
