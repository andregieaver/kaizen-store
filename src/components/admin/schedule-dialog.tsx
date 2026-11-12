"use client";

import { CalendarClock } from "lucide-react";
import { useEffect, useId, useState, useTransition } from "react";

import { useAdminText } from "./admin-text";
import { CARD_CLASS } from "./ui";
import { MoveButton, ResizeHandles, dialogStyle, focusPastMoveButton, useMovable } from "./movable";
import { fillWords } from "@/lib/admin-fill";
import type { PageOwnerContext, SaveDraft, ScheduleView } from "./page-context";

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm font-normal";

/** A day on the store's clock `days` from now, at `time`: a sensible default Homer can keep. */
function dayAt(zone: string, days: number, time: string): { day: string; time: string } {
  const at = new Date(Date.now() + days * 86_400_000);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  return { day, time };
}

/**
 * *Schedule* beside Publish (wave 7 unit G, D341; unit F, D340): the draft of a page, article, header or footer is published at a day and
 * time on the store's clock by the five-minute job, in the name of who scheduled it, and optionally the version before is put back at
 * another (behind *Put the version before back later*, for Lisa). Shows a waiting schedule with *Cancel the schedule*, a way back that
 * waits, and the last leg that did not happen with why. With unsaved changes the draft is saved first (`saveDraft`), so what is scheduled
 * is what is seen.
 */
export function ScheduleButton({
  pageId,
  noun,
  schedule,
  dirty,
  saveDraft,
}: {
  pageId: string;
  noun: "page" | "article" | "header" | "footer";
  schedule: NonNullable<PageOwnerContext["schedule"]>;
  dirty: boolean;
  /** Saves the draft as Save draft does; false when it could not. */
  saveDraft: SaveDraft;
}) {
  const all = useAdminText("schedules");
  const w = all.dialog;
  const id = useId();
  // Moves by its title and resizes from its edges, as every dialog in the builder does.
  const movable = useMovable<HTMLDialogElement>();
  const { ref: dialog } = movable;
  const [view, setView] = useState<ScheduleView | null>(null);
  const [fields, setFields] = useState(() => dayAt(schedule.zone, 1, "09:00"));
  const [backOpen, setBackOpen] = useState(false);
  const [back, setBack] = useState(() => dayAt(schedule.zone, 8, "09:00"));
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const named = all.nouns[noun];

  useEffect(() => {
    let live = true;
    schedule.read(pageId).then((next) => {
      if (live) setView(next);
    });
    return () => {
      live = false;
    };
  }, [pageId, schedule]);

  const open = () => {
    setMessage(null);
    setProblem(null);
    movable.reset();
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    focusPastMoveButton(element);
  };
  const submit = () =>
    start(async () => {
      setProblem(null);
      if (dirty && !(await saveDraft())) return;
      const answer = await schedule.set(pageId, fields.day, fields.time, backOpen ? back : null);
      if (!answer.ok) {
        setProblem(answer.problem);
        return;
      }
      setView(answer.view);
      setMessage(answer.message);
    });
  const cancel = () =>
    start(async () => {
      const answer = await schedule.cancel(pageId);
      if (!answer.ok) setProblem(answer.problem);
      else {
        setView(answer.view);
        setMessage(answer.message);
      }
    });

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        data-schedule-button=""
        className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-edge px-4 font-medium"
      >
        <CalendarClock aria-hidden className="size-4" />
        {view?.waiting ? view.waiting.label : w.schedule}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={`${id}-title`}
        style={dialogStyle(movable.rect)}
        className={`m-auto w-[min(30rem,calc(100vw-2rem))] overflow-visible p-0 text-ink backdrop:bg-black/40 ${CARD_CLASS}`}
      >
        <div className={`flex flex-col ${movable.rect?.h != null ? "h-full" : "max-h-[calc(90dvh-2px)]"}`}>
          <div {...movable.bar} className="flex cursor-move touch-none items-center justify-between gap-4 px-6 pt-4 select-none">
            <h2 id={`${id}-title`} className="text-title text-ink">
              {w.title}
            </h2>
            <MoveButton movable={movable} />
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pt-2 pb-6">
            <p className="text-sm text-muted">{fillWords(w.intro, { noun: named, zone: schedule.zone })}</p>
            {view?.waiting?.back && <p className="text-sm">{view.waiting.back}</p>}
            {view?.going && !view.waiting && <p className="rounded-panel bg-sunken p-3 text-sm">{view.going}</p>}
            {view?.failure && !view.waiting && <p className="rounded-panel bg-warning-soft p-3 text-sm text-warning-text">{view.failure}</p>}
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm font-medium">
                {w.day}
                <input type="date" value={fields.day} onChange={(e) => setFields((f) => ({ ...f, day: e.target.value }))} className={input} />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                {w.time}
                <input type="time" value={fields.time} onChange={(e) => setFields((f) => ({ ...f, time: e.target.value }))} className={input} />
              </label>
            </div>
            <details open={backOpen} onToggle={(e) => setBackOpen((e.target as HTMLDetailsElement).open)} data-schedule-back="">
              <summary className="cursor-pointer text-sm font-medium">{w.back}</summary>
              <div className="mt-3 flex flex-col gap-3">
                <p className="text-sm text-muted">{fillWords(w.backHint, { noun: named })}</p>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    {w.backDay}
                    <input type="date" value={back.day} onChange={(e) => setBack((f) => ({ ...f, day: e.target.value }))} className={input} />
                  </label>
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    {w.backTime}
                    <input type="time" value={back.time} onChange={(e) => setBack((f) => ({ ...f, time: e.target.value }))} className={input} />
                  </label>
                </div>
              </div>
            </details>
            <div role="status" aria-live="polite" className="text-sm">
              {message && <p>{message}</p>}
              {problem && <p className="text-danger-text">{problem}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={submit} disabled={busy} className="min-h-11 rounded-pill bg-brand px-5 font-medium text-brand-ink disabled:opacity-50">
                {dirty ? w.saveDraftFirst : w.save}
              </button>
              {(view?.waiting || view?.going) && (
                <button type="button" onClick={cancel} disabled={busy} className="min-h-11 rounded-pill border border-edge px-4 font-medium disabled:opacity-50">
                  {w.cancel}
                </button>
              )}
              <button type="button" onClick={() => dialog.current?.close()} className="min-h-11 rounded-pill px-4 font-medium">
                {w.close}
              </button>
            </div>
          </div>
        </div>
        <ResizeHandles movable={movable} />
      </dialog>
    </>
  );
}
