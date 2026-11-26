import { ButtonLink } from "@/components/admin/ui/button";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { AdminLink } from "@/components/admin/ui/link";
import { dueState } from "@/lib/projects-dates";
import type { ProjectColour } from "@/lib/projects-model";
import { monthWeeks, shiftMonth, timelineBar } from "@/lib/projects-views";
import { dayIn } from "@/lib/work-dates";

import { colourVar } from "./parts";

export type CalendarTask = { id: string; title: string; checklistId: string; done: boolean; startAt: string | null; dueAt: string | null; allDay: boolean | null; colour: ProjectColour };
type Words = { earlier: string; later: string; monthLabel: string; noDates: string };

/** A month's name in the person's language. */
const monthName = (month: string, locale: string) => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-15T00:00:00Z`));

/** The month's name with links to the one before and after. */
function MonthNav({ month, href, locale, words }: { month: string; href: (month: string) => string; locale: string; words: Words }) {
  return (
    <nav aria-label={words.monthLabel} className="flex flex-wrap items-center gap-2">
      <ButtonLink kind="quiet" size="dense" href={href(shiftMonth(month, -1))}>
        {words.earlier}
      </ButtonLink>
      <span className="text-body-strong text-ink">{monthName(month, locale)}</span>
      <ButtonLink kind="quiet" size="dense" href={href(shiftMonth(month, 1))}>
        {words.later}
      </ButtonLink>
    </nav>
  );
}

const taskTone = (task: CalendarTask, now: Date, timeZone: string) =>
  task.done ? "text-muted line-through" : task.dueAt && dueState(task.dueAt, task.allDay, now, timeZone) === "late" ? "text-danger-text" : "text-ink-2";

/**
 * A project's tasks on a month's calendar (D903 P4.13, Life's project calendar): each on its due day in the store's zone, late ones in the
 * danger colour, done ones struck through, each a link to its list. Drawn on the server; the month is in the address.
 */
export function ProjectCalendar({ tasks, month, now, href, listHref, timeZone, locale, words }: { tasks: CalendarTask[]; month: string; now: Date; href: (month: string) => string; listHref: (id: string) => string; timeZone: string; locale: string; words: Words }) {
  const today = dayIn(now, timeZone);
  const byDay = new Map<string, CalendarTask[]>();
  for (const task of tasks) {
    if (!task.dueAt) continue;
    const day = dayIn(task.dueAt, timeZone);
    byDay.set(day, [...(byDay.get(day) ?? []), task]);
  }
  const weeks = monthWeeks(month);
  // 30 November 2026 is a Monday: the headers' names in the person's language.
  const weekdays = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(Date.UTC(2026, 10, 30 + i)));
  return (
    <div className="flex flex-col gap-3">
      <MonthNav month={month} href={href} locale={locale} words={words} />
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-panel border border-line bg-line">
        {weekdays.map((name) => (
          <span key={name} className="bg-sunken px-2 py-2 text-caption text-muted">
            {name}
          </span>
        ))}
        {weeks.flat().map((day) => (
          <div key={day} className={`flex min-h-24 min-w-0 flex-col gap-1 p-2 ${day.startsWith(month) ? "bg-card" : "bg-sunken"}`}>
            <span className={`text-caption tabular-nums ${day === today ? "font-medium text-ink" : "text-muted"}`}>{Number(day.slice(8))}</span>
            {(byDay.get(day) ?? []).map((task) => (
              <AdminLink key={task.id} href={listHref(task.checklistId)} className={`truncate text-chip underline-offset-2 hover:underline ${taskTone(task, now, timeZone)}`}>
                {task.title}
              </AdminLink>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A project's tasks on a month's timeline (D903 P4.13): a bar from each task's start to its due day in its stage's colour, cut to the month,
 * the tasks that touch the month only, the earliest first.
 */
export function ProjectTimeline({ tasks, month, now, href, listHref, timeZone, locale, words }: { tasks: CalendarTask[]; month: string; now: Date; href: (month: string) => string; listHref: (id: string) => string; timeZone: string; locale: string; words: Words }) {
  const rows = tasks.flatMap((task) => {
    if (!task.dueAt) return [];
    const bar = timelineBar(task.startAt ? dayIn(task.startAt, timeZone) : null, dayIn(task.dueAt, timeZone), month);
    return bar ? [{ task, bar }] : [];
  });
  rows.sort((a, b) => a.bar.left - b.bar.left || a.bar.width - b.bar.width);
  return (
    <div className="flex flex-col gap-3">
      <MonthNav month={month} href={href} locale={locale} words={words} />
      {rows.length === 0 ? (
        <EmptyState compact title={words.noDates} />
      ) : (
        <ul className="flex flex-col rounded-panel border border-line bg-card">
          {rows.map(({ task, bar }) => (
            <li key={task.id} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0">
              <AdminLink href={listHref(task.checklistId)} className={`w-40 shrink-0 truncate text-body underline-offset-2 hover:underline ${taskTone(task, now, timeZone)}`}>
                {task.title}
              </AdminLink>
              <span className="relative h-5 min-w-0 flex-1 rounded-pill bg-sunken" aria-hidden>
                <span className="absolute inset-y-0 rounded-pill" style={{ left: `${bar.left * 100}%`, width: `${bar.width * 100}%`, backgroundColor: colourVar(task.colour) }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
