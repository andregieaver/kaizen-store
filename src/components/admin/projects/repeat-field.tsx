"use client";

import { Field, Select, TextInput } from "@/components/admin/ui/field";
import { fillWords } from "@/lib/admin-fill";
import type { ProjectsMessages } from "@/lib/admin-messages/projects.en";
import { TIME_WINDOW_ORDER, timesToWindows, WEEK_ORDER, windowsToTimes, type Recurrence, type Repeat, type TimeWindow } from "@/lib/projects-recurrence";

import { Toggle } from "./toggle";

export type RepeatWords = ProjectsMessages["repeat"];

/** The editor's state of a rule: every part kept while the kind changes, so going back to *Every week* finds its days. */
export type RepeatDraft = { freq: "off" | Repeat; weekdays: number[]; intervalDays: number; monthDays: number[]; intervalMonths: number; windows: TimeWindow[] };

export function draftOf(rule: Recurrence | null): RepeatDraft {
  return {
    freq: rule?.freq ?? "off",
    weekdays: rule?.weekdays ?? [1],
    intervalDays: rule?.intervalDays ?? 14,
    monthDays: rule?.monthDays ?? [1],
    intervalMonths: rule?.intervalMonths ?? 1,
    windows: rule ? timesToWindows(rule.times) : [],
  };
}

/**
 * The rule a draft says, as the operation sends it: none for *Never*, and only the parts its kind uses. A rule kept with times of its own
 * (Life's, the AI manager's) keeps them while no window is chosen, and one of the same kind keeps the day it counts from.
 */
export function ruleOf(draft: RepeatDraft, kept: Recurrence | null): Recurrence | null {
  if (draft.freq === "off") return null;
  const times = draft.windows.length === 0 && kept && timesToWindows(kept.times).length === 0 ? kept.times : windowsToTimes(draft.windows);
  const anchor = kept?.freq === draft.freq ? kept.anchor : undefined;
  const sorted = (days: number[]) => [...new Set(days)].sort((a, b) => a - b);
  switch (draft.freq) {
    case "daily":
      return { freq: "daily", times };
    case "weekly":
      return { freq: "weekly", weekdays: sorted(draft.weekdays), times };
    case "interval":
      return { freq: "interval", intervalDays: draft.intervalDays, times, ...(anchor && { anchor }) };
    case "monthly":
      return { freq: "monthly", monthDays: sorted(draft.monthDays), intervalMonths: draft.intervalMonths, times, ...(anchor && { anchor }) };
  }
}

/** A weekday's short name in the person's language (0 is Sunday): 29 November 2026 is a Sunday. */
const weekdayName = (day: number, locale: string) => new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(Date.UTC(2026, 10, 29 + day));

/** A rule in a few words for a task's row: "Every Mon and Thu", "Every 14 days", "Monthly on day 1 and 15". */
export function repeatSummary(rule: Recurrence, words: RepeatWords, locale: string): string {
  const list = (items: string[]) => new Intl.ListFormat(locale, { type: "conjunction", style: "short" }).format(items);
  const s = words.summary;
  switch (rule.freq) {
    case "daily":
      return s.daily;
    case "weekly":
      return fillWords(s.weekly, { days: list(WEEK_ORDER.filter((d) => rule.weekdays?.includes(d)).map((d) => weekdayName(d, locale))) });
    case "interval":
      return fillWords(s.interval, { n: rule.intervalDays ?? 1 });
    case "monthly": {
      const days = list((rule.monthDays ?? []).map(String));
      return (rule.intervalMonths ?? 1) > 1 ? fillWords(s.monthlyEvery, { n: rule.intervalMonths ?? 1, days }) : fillWords(s.monthly, { days });
    }
  }
}

/** Days to choose from, each a toggle; the last chosen cannot be taken away, since a rule without a day is refused. */
function Toggles({ label, options, chosen, onChange, disabled }: { label: string; options: { value: number; label: string }[]; chosen: number[]; onChange: (next: number[]) => void; disabled: boolean }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = chosen.includes(o.value);
        return (
          <Toggle
            key={o.value}
            on={on}
            disabled={disabled}
            onClick={() => {
              const next = on ? chosen.filter((v) => v !== o.value) : [...chosen, o.value];
              if (next.length > 0) onChange(next);
            }}
          >
            {o.label}
          </Toggle>
        );
      })}
    </div>
  );
}

/**
 * A task's repeat (P4.1, Life's `checklist-item-recurrence-field.tsx`): Homer picks how often (*Every day* asks nothing more), Lisa the
 * weekdays, the days apart, the days of the month and how many months apart, and the times of the day it is due at.
 */
export function RepeatField({ draft, onChange, words, locale, disabled }: { draft: RepeatDraft; onChange: (next: RepeatDraft) => void; words: RepeatWords; locale: string; disabled: boolean }) {
  const set = (patch: Partial<RepeatDraft>) => onChange({ ...draft, ...patch });
  const whole = (text: string, min: number, max: number) => Math.min(max, Math.max(min, Math.floor(Number(text)) || min));
  return (
    <div className="flex flex-col gap-3 sm:col-span-2">
      <Field label={words.label} hint={words.hint}>
        {(control) => (
          <Select {...control} value={draft.freq} onChange={(e) => set({ freq: e.target.value as RepeatDraft["freq"] })} disabled={disabled} full>
            {(["off", "daily", "weekly", "interval", "monthly"] as const).map((f) => (
              <option key={f} value={f}>
                {words.freqs[f]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {draft.freq === "weekly" && (
        <Toggles
          label={words.weekdays}
          options={WEEK_ORDER.map((d) => ({ value: d, label: weekdayName(d, locale) }))}
          chosen={draft.weekdays}
          onChange={(weekdays) => set({ weekdays })}
          disabled={disabled}
        />
      )}
      {draft.freq === "interval" && (
        <Field label={words.everyDays}>
          {(control) => <TextInput {...control} type="number" min={1} max={365} value={draft.intervalDays} onChange={(e) => set({ intervalDays: whole(e.target.value, 1, 365) })} disabled={disabled} />}
        </Field>
      )}
      {draft.freq === "monthly" && (
        <>
          <Toggles
            label={words.monthDays}
            options={Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: String(i + 1) }))}
            chosen={draft.monthDays}
            onChange={(monthDays) => set({ monthDays })}
            disabled={disabled}
          />
          {draft.monthDays.some((d) => d > 28) && <p className="text-xs text-muted">{words.clamp}</p>}
          <Field label={words.everyMonths}>
            {(control) => <TextInput {...control} type="number" min={1} max={24} value={draft.intervalMonths} onChange={(e) => set({ intervalMonths: whole(e.target.value, 1, 24) })} disabled={disabled} />}
          </Field>
        </>
      )}
      {draft.freq !== "off" && (
        <div className="flex flex-col gap-1.5">
          <div role="group" aria-label={words.when} className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium text-ink">{words.when}</span>
            {TIME_WINDOW_ORDER.map((w) => {
              const on = draft.windows.includes(w);
              return (
                <Toggle key={w} on={on} disabled={disabled} onClick={() => set({ windows: on ? draft.windows.filter((x) => x !== w) : [...draft.windows, w] })}>
                  {words.windows[w]}
                </Toggle>
              );
            })}
          </div>
          {draft.windows.length === 0 && <p className="text-xs text-muted">{words.anyTime}</p>}
        </div>
      )}
    </div>
  );
}
