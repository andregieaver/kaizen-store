"use client";

import { CalendarClock } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { useAdminText } from "./admin-text";
import { fillWords } from "@/lib/admin-fill";
import type { PageOwnerContext, SaveDraft, ScheduleView } from "./page-context";

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm font-normal";


/** Tomorrow at nine on the store's clock, as the fields start: a sensible default Homer can keep. */
function tomorrowAtNine(zone: string): { day: string; time: string } {
  const now = new Date(Date.now() + 86_400_000);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return { day, time: "09:00" };
}

/**
 * *Schedule* beside Publish (wave 7 unit G, D341; the start of D340's model): the page's or article's draft is published at a day and time on
 * the store's clock by the five-minute job, in the name of who scheduled it. Shows a waiting schedule with *Cancel the schedule*, and the
 * last one that did not publish with why. With unsaved changes the draft is saved first (`saveDraft`), so what is scheduled is what is seen.
 */
export function ScheduleButton({
  pageId,
  noun,
  schedule,
  dirty,
  saveDraft,
}: {
  pageId: string;
  noun: "page" | "article";
  schedule: NonNullable<PageOwnerContext["schedule"]>;
  dirty: boolean;
  /** Saves the draft as Save draft does; false when it could not. */
  saveDraft: SaveDraft;
}) {
  const w = useAdminText("blog").editor;
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<ScheduleView | null>(null);
  const [fields, setFields] = useState(() => tomorrowAtNine(schedule.zone));
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();

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
    dialog.current?.showModal();
  };
  const submit = () =>
    start(async () => {
      setProblem(null);
      if (dirty && !(await saveDraft())) return;
      const answer = await schedule.set(pageId, fields.day, fields.time);
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
      <dialog ref={dialog} aria-labelledby={`${id}-title`} className="m-auto w-full max-w-md rounded-card border border-line bg-card p-6 text-ink backdrop:bg-black/40">
        <div className="flex flex-col gap-4">
          <h2 id={`${id}-title`} className="text-title text-ink">
            {w.scheduleTitle}
          </h2>
          <p className="text-sm text-muted">{fillWords(w.scheduleIntro, { noun, zone: schedule.zone })}</p>
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
          <div role="status" aria-live="polite" className="text-sm">
            {message && <p>{message}</p>}
            {problem && <p className="text-danger-text">{problem}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={submit} disabled={busy} className="min-h-11 rounded-pill bg-brand px-5 font-medium text-brand-ink disabled:opacity-50">
              {dirty ? w.scheduleSaveDraftFirst : w.scheduleSave}
            </button>
            {view?.waiting && (
              <button type="button" onClick={cancel} disabled={busy} className="min-h-11 rounded-pill border border-edge px-4 font-medium disabled:opacity-50">
                {w.cancelSchedule}
              </button>
            )}
            <button type="button" onClick={() => dialog.current?.close()} className="min-h-11 rounded-pill px-4 font-medium">
              {w.close}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
