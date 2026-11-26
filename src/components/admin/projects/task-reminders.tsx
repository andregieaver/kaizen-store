"use client";

import { Bell, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/admin/ui/button";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { Field, Select, TextInput } from "@/components/admin/ui/field";
import { adminDate } from "@/lib/admin-date";
import { fillWords } from "@/lib/admin-fill";
import type { AdminLang } from "@/lib/admin-lang";
import type { ProjectsMessages } from "@/lib/admin-messages/projects.en";
import { instantOf } from "@/lib/projects-dates";
import { REMINDER_CHANNELS, type ReminderChannel } from "@/lib/projects-model";
import type { ProjectsAnswer, ProjectsOpInput } from "@/lib/projects-ops";
import type { Recurrence } from "@/lib/projects-recurrence";

import { repeatSummary } from "./repeat-field";

/** A reminder as the screens show it (P4.3). */
export type ReminderView = { id: string; remindAt: string | null; offsetMinutes: number | null; recurrence: Recurrence | null; channels: ReminderChannel[] };
export type ReminderWords = Pick<ProjectsMessages, "reminders" | "repeat">;

/** The times before a due time Homer picks from; Lisa's other offsets read as minutes. */
const BEFORE = { m15: 15, h1: 60, d1: 1440 } as const;

/** When a reminder comes, in a few words: "1 hour before it is due", "On 3 Dec, 09:00", "Every Mon at 09:00". */
export function reminderWhen(r: Pick<ReminderView, "remindAt" | "offsetMinutes" | "recurrence">, words: ReminderWords, timeZone: string, lang: AdminLang, locale: string): string {
  const w = words.reminders;
  if (r.recurrence) return fillWords(w.repeating, { rule: repeatSummary(r.recurrence, words.repeat, locale), time: r.recurrence.times.join(", ") });
  if (r.remindAt) return fillWords(w.on, { when: adminDate(timeZone, r.remindAt, "dayTime", lang) });
  const offset = r.offsetMinutes ?? 0;
  if (offset === 0) return w.options.due;
  const preset = (Object.keys(BEFORE) as (keyof typeof BEFORE)[]).find((k) => BEFORE[k] === offset);
  return preset ? w.options[preset] : fillWords(w.minutesBefore, { n: offset });
}

/** How a reminder goes: by email, as a notification, or both. */
export function ChannelChoice({ chosen, onChange, words, disabled }: { chosen: ReminderChannel[]; onChange: (next: ReminderChannel[]) => void; words: ReminderWords["reminders"]; disabled: boolean }) {
  return (
    <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <legend className="sr-only">{words.by}</legend>
      <span className="text-muted" aria-hidden>
        {words.by}
      </span>
      {REMINDER_CHANNELS.map((c) => (
        <label key={c} className="flex items-center gap-2 text-ink">
          <input
            type="checkbox"
            className="size-4 accent-brand"
            checked={chosen.includes(c)}
            disabled={disabled || (chosen.length === 1 && chosen.includes(c))}
            onChange={(e) => onChange(e.target.checked ? [...chosen, c] : chosen.filter((x) => x !== c))}
          />
          {words.channels[c]}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * A task's reminders (D903 P4.3, Life's item reminders): each said in a few words with *Remove*, and a new one at the due time, so long
 * before it, or at a day and time of one's own, by email and as a notification unless one is left out. It goes to the task's person, or to
 * whoever set it when the task has none.
 */
export function TaskReminders({
  itemId,
  dueAt,
  reminders,
  canChange,
  timeZone,
  lang,
  locale,
  words,
  run,
  pending,
}: {
  itemId: string;
  dueAt: string | null;
  reminders: ReminderView[];
  canChange: boolean;
  timeZone: string;
  lang: AdminLang;
  locale: string;
  words: ReminderWords;
  run: (op: ProjectsOpInput, then?: (answer: ProjectsAnswer) => void) => void;
  pending: boolean;
}) {
  const w = words.reminders;
  const [when, setWhen] = useState<string>(dueAt ? "h1" : "at");
  const [day, setDay] = useState("");
  const [time, setTime] = useState("09:00");
  const [channels, setChannels] = useState<ReminderChannel[]>([...REMINDER_CHANNELS]);

  const add = () => {
    const base = { itemId, checklistId: null, channels, recurrence: null };
    if (when === "at") {
      const { at } = instantOf(day, time, timeZone);
      if (!at) return;
      run({ op: "reminder.add", ...base, remindAt: at, offsetMinutes: null });
    } else {
      run({ op: "reminder.add", ...base, remindAt: null, offsetMinutes: when === "due" ? 0 : BEFORE[when as keyof typeof BEFORE] });
    }
  };

  return (
    <section aria-labelledby={`reminders-${itemId}`} className="flex flex-col gap-2" data-task-reminders>
      <h3 id={`reminders-${itemId}`} className="text-body-strong text-ink">
        {w.heading}
      </h3>
      {reminders.length === 0 ? (
        <EmptyState compact title={w.none} />
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
          {reminders.map((r) => {
            const said = reminderWhen(r, words, timeZone, lang, locale);
            return (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <Bell className="size-4 shrink-0 text-ink-2" aria-hidden />
                <span className="min-w-0 flex-1 text-ink">{said}</span>
                <span className="text-muted">{r.channels.map((c) => w.channels[c]).join(", ")}</span>
                {canChange && (
                  <Button kind="icon" size="dense" aria-label={fillWords(w.remove, { when: said })} onClick={() => run({ op: "reminder.delete", id: r.id })}>
                    <Trash2 />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canChange && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <div className="flex flex-wrap items-end gap-2">
            <Field label={w.when} className="min-w-48">
              {(control) => (
                <Select {...control} value={when} onChange={(e) => setWhen(e.target.value)} full>
                  {dueAt && (
                    <>
                      <option value="due">{w.options.due}</option>
                      <option value="m15">{w.options.m15}</option>
                      <option value="h1">{w.options.h1}</option>
                      <option value="d1">{w.options.d1}</option>
                    </>
                  )}
                  <option value="at">{w.options.at}</option>
                </Select>
              )}
            </Field>
            {when === "at" && (
              <>
                <Field label={w.day} className="w-44">
                  {(control) => <TextInput {...control} type="date" value={day} onChange={(e) => setDay(e.target.value)} full />}
                </Field>
                <Field label={w.time} className="w-32">
                  {(control) => <TextInput {...control} type="time" value={time} onChange={(e) => setTime(e.target.value)} full />}
                </Field>
              </>
            )}
            <Button type="submit" disabled={pending || (when === "at" && !day)}>
              {w.add}
            </Button>
          </div>
          <ChannelChoice chosen={channels} onChange={setChannels} words={w} disabled={pending} />
          {!dueAt && <p className="text-caption text-muted">{w.noDue}</p>}
        </form>
      )}
    </section>
  );
}
