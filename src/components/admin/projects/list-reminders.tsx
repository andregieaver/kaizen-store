"use client";

import { Bell, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/admin/ui/button";
import { Field, Select, TextInput } from "@/components/admin/ui/field";
import { fillWords } from "@/lib/admin-fill";
import type { AdminLang } from "@/lib/admin-lang";
import { zonedDate } from "@/lib/booking-slots";
import { instantOf } from "@/lib/projects-dates";
import { REMINDER_CHANNELS, type ReminderChannel } from "@/lib/projects-model";
import type { Recurrence } from "@/lib/projects-recurrence";

import { ChannelChoice, reminderWhen, type ReminderView, type ReminderWords } from "./task-reminders";
import { useAct, type ProjectsAct } from "./use-act";

const REPEATS = ["off", "daily", "weekly", "monthly"] as const;
type RepeatChoice = (typeof REPEATS)[number];

/** The rule for a list's reminder from Homer's choice: every day, every week on the day chosen, every month on its date, at the time. */
function ruleFor(choice: RepeatChoice, day: string, time: string): Recurrence | null {
  if (choice === "off") return null;
  const date = new Date(`${day}T00:00:00Z`);
  if (choice === "daily") return { freq: "daily", times: [time] };
  if (choice === "weekly") return { freq: "weekly", weekdays: [date.getUTCDay()], times: [time] };
  return { freq: "monthly", monthDays: [date.getUTCDate()], intervalMonths: 1, anchor: day, times: [time] };
}

/**
 * A list's reminders (D903 P4.3, Life's list reminders), on its settings: a day and a time, once or every day, week or month from then,
 * to the list's person (or whoever set it), by email and as a notification unless one is left out.
 */
export function ListReminders({
  listId,
  reminders,
  canChange,
  timeZone,
  lang,
  locale,
  words,
  act,
}: {
  listId: string;
  reminders: ReminderView[];
  canChange: boolean;
  timeZone: string;
  lang: AdminLang;
  locale: string;
  words: ReminderWords;
  act: ProjectsAct;
}) {
  const w = words.reminders;
  const { run, pending, said } = useAct(act);
  const [day, setDay] = useState(() => zonedDate(Date.now(), timeZone));
  const [time, setTime] = useState("09:00");
  const [repeat, setRepeat] = useState<RepeatChoice>("weekly");
  const [channels, setChannels] = useState<ReminderChannel[]>([...REMINDER_CHANNELS]);

  return (
    <section aria-labelledby="list-reminders" className="flex flex-col gap-3" data-list-reminders>
      <h2 id="list-reminders" className="text-title text-ink">
        {w.heading}
      </h2>
      <p className="text-sm text-muted">{w.listText}</p>
      {reminders.length > 0 && (
        <ul className="flex flex-col divide-y divide-line rounded-panel border border-line bg-card">
          {reminders.map((r) => {
            const when = reminderWhen(r, words, timeZone, lang, locale);
            return (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2.5 text-body">
                <Bell className="size-4 shrink-0 text-ink-2" aria-hidden />
                <span className="min-w-0 flex-1 text-ink">{when}</span>
                <span className="text-sm text-muted">{r.channels.map((c) => w.channels[c]).join(", ")}</span>
                {canChange && (
                  <Button kind="icon" size="dense" aria-label={fillWords(w.remove, { when })} onClick={() => run({ op: "reminder.delete", id: r.id })}>
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
            const rule = ruleFor(repeat, day, time);
            const { at } = instantOf(day, time, timeZone);
            if (!at) return;
            run({
              op: "reminder.add",
              itemId: null,
              checklistId: listId,
              channels,
              offsetMinutes: null,
              ...(rule ? { recurrence: rule, remindAt: null, startsAt: at } : { recurrence: null, remindAt: at, startsAt: null }),
            });
          }}
        >
          <div className="flex flex-wrap items-end gap-2">
            <Field label={w.day} className="w-44">
              {(control) => <TextInput {...control} type="date" value={day} onChange={(e) => setDay(e.target.value)} required full />}
            </Field>
            <Field label={w.time} className="w-32">
              {(control) => <TextInput {...control} type="time" value={time} onChange={(e) => setTime(e.target.value)} required full />}
            </Field>
            <Field label={w.repeats} className="min-w-40">
              {(control) => (
                <Select {...control} value={repeat} onChange={(e) => setRepeat(e.target.value as RepeatChoice)} full>
                  {REPEATS.map((r) => (
                    <option key={r} value={r}>
                      {w.repeatOptions[r]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button type="submit" disabled={pending || !day || !time}>
              {w.add}
            </Button>
          </div>
          <ChannelChoice chosen={channels} onChange={setChannels} words={w} disabled={pending} />
        </form>
      )}
      <p role="status" aria-live="polite" className="text-sm text-danger-text">
        {said}
      </p>
    </section>
  );
}
