import type { AdminLang } from "./admin-lang";
import { adminDate, type ZoneOf } from "./admin-date";
import { DATE_TRIGGER_DAYS, isDateTrigger } from "./flow-triggers";
import type { FlowCondition, FlowGoal, FlowStep } from "./flows";

/**
 * A flow as the owner reads it (D767 slice 2, email plan M3.3): the trigger, then each email with when it goes and on what condition, as
 * sentences (*When someone joins, the same day: Welcome. Three days later, if they have not ordered: Our best sellers*). Pure: the same
 * tree the canvas edits, so a change in either shows in both. Words come from the caller in the admin's language.
 */

export type StoryWords = {
  triggers: Record<string, string>;
  /** A segment trigger's segment before one is chosen (`{segment}`). */
  anySegment: string;
  /** A date trigger's sentence for one day, where `{n}` days would read wrong ("1 days"). */
  triggersOne?: Record<string, string>;
  /** A schedule that repeats (`{n}` days from `{when}`, to `{who}`), and its readers when it names no segment. */
  scheduleEvery?: string;
  everyone?: string;
  sameDay: string;
  after: { hours: { one: string; many: string }; days: { one: string; many: string } };
  conditions: { ordered: { yes: string; no: string }; clicked: { yes: string; no: string }; segment: { yes: string; no: string }; split: { yes: string; no: string } };
  /** A wait-until (M2.1): what the next emails wait for, or the days. */
  until: { ordered: string; clicked: string };
  goal: string;
  ends: string;
};

/** One line of the story: when, on what condition (if any), and the email's subject in the flow's first language. */
export type StoryLine = {
  stepId: string;
  when: string;
  condition: string | null;
  subject: string;
  depth: number;
  /** The wait just before this email on its way, which sets its "3 days later" and may be changed from its line; null for none. */
  waitId: string | null;
  /** The days that wait holds. */
  waitDays: number | null;
};

const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? `{${k}}`));

/** "3 days later", "5 hours later" or "the same day", from the hours waited since the last email. */
export function waitWords(hours: number, w: StoryWords): string {
  if (hours <= 0) return w.sameDay;
  if (hours % 24 === 0) {
    const days = hours / 24;
    return fill(days === 1 ? w.after.days.one : w.after.days.many, { n: days });
  }
  return fill(hours === 1 ? w.after.hours.one : w.after.hours.many, { n: hours });
}

function conditionWords(condition: FlowCondition, holds: boolean, w: StoryWords, segmentName: (id: string) => string): string {
  const pick = (pair: { yes: string; no: string }) => (holds ? pair.yes : pair.no);
  if (condition.kind === "ordered_since_entry") return pick(w.conditions.ordered);
  if (condition.kind === "clicked_flow_email") return pick(w.conditions.clicked);
  if (condition.kind === "split") return pick(w.conditions.split);
  return fill(pick(w.conditions.segment), { segment: segmentName(condition.segmentId) });
}

const subjectOf = (step: Extract<FlowStep, { kind: "email" }>): string => Object.values(step.content)[0]?.subject ?? "";

/**
 * The story's lines, in reading order: each email with the wait before it (summed since the last email on its way) and the conditions that
 * lead to it, joined with "and" when nested. The trigger and goals are the story's own lead (`storyLead()`).
 */
export function storyLines(steps: readonly FlowStep[], w: StoryWords, segmentName: (id: string) => string = () => "?"): StoryLine[] {
  const lines: StoryLine[] = [];
  const walk = (list: readonly FlowStep[], waited: number, given: string[], depth: number, before: Extract<FlowStep, { kind: "wait" }> | null): number => {
    let hours = waited;
    let wait = before;
    let conditions = given;
    for (const step of list) {
      if (step.kind === "wait") {
        hours += step.hours;
        wait = step;
      } else if (step.kind === "email") {
        lines.push({
          stepId: step.id,
          when: waitWords(hours, w),
          condition: conditions.length > 0 ? conditions.join(", ") : null,
          subject: subjectOf(step),
          depth,
          waitId: wait?.id ?? null,
          waitDays: wait ? wait.hours / 24 : null,
        });
        hours = 0;
        wait = null;
      } else if (step.kind === "until") {
        // The emails after it wait for its event or its days: said once, as a condition of their own, and time starts again from it.
        conditions = [...conditions, fill(w.until[step.until], { n: Math.round(step.hours / 24) })];
        hours = 0;
        wait = null;
      } else if (step.kind === "tag") {
        // A tag changes nothing a reader sees: the story reads on.
      } else if (step.kind === "if") {
        const yes = conditionWords(step.condition, true, w, segmentName);
        const no = conditionWords(step.condition, false, w, segmentName);
        walk(step.then, hours, [...conditions, yes], depth + 1, wait);
        walk(step.else, hours, [...conditions, no], depth + 1, wait);
        wait = null;
        // After a branch, time is told from the branch's last email again: the next line's wait starts at zero.
        hours = 0;
      } else return hours;
    }
    return hours;
  };
  walk(steps, 0, [], 0, null);
  return lines;
}

/**
 * What starts a flow as a label of its own (the canvas's trigger card and its choices): the story's sentence without its colon, a date
 * trigger's days filled in (its usual days when none are given).
 */
export function triggerLabel(trigger: string, w: StartWords, days: number | null, segment: string | null = null, schedule: Schedule | null = null): string {
  const range = isDateTrigger(trigger) ? DATE_TRIGGER_DAYS[trigger] : null;
  return startWords(trigger, w, days ?? range?.start ?? null, segment, schedule).replace(/:$/, "");
}

type StartWords = Pick<StoryWords, "triggers" | "anySegment" | "triggersOne" | "scheduleEvery" | "everyone">;

/** A schedule trigger's time as the reader's admin shows it, and how often it repeats in days (null: once). */
export type Schedule = { when: string; every: number | null };

/** A flow's schedule for its story (M2.3): its next time on the store's clock in the admin's language; null for any other trigger. */
export function scheduleOf(flow: { scheduleAt: string | null; scheduleEveryDays: number | null }, store: ZoneOf, lang: AdminLang | string): Schedule | null {
  return flow.scheduleAt ? { when: adminDate(store, flow.scheduleAt, "dayTime", lang), every: flow.scheduleEveryDays } : null;
}

/**
 * What starts a flow as the story says it: the trigger's sentence with its days and segment, the one-day sentence for a single day; a
 * schedule's when, how often and to whom.
 */
function startWords(trigger: string, w: StartWords, days: number | null, segment: string | null, schedule: Schedule | null = null): string {
  if (trigger === "schedule") {
    const text = schedule?.every && w.scheduleEvery ? w.scheduleEvery : (w.triggers[trigger] ?? trigger);
    return fill(text, { when: schedule?.when ?? "?", n: schedule?.every ?? "", who: segment ?? w.everyone ?? "" });
  }
  const text = (days === 1 ? w.triggersOne?.[trigger] : undefined) ?? w.triggers[trigger] ?? trigger;
  return fill(text, { n: days ?? "?", segment: segment ?? w.anySegment });
}

/** The story's first sentence: what starts it, and what ends it early. */
export function storyLead(
  trigger: string,
  goals: readonly FlowGoal[],
  w: StoryWords,
  days: number | null = null,
  segment: string | null = null,
  schedule: Schedule | null = null,
): string {
  const start = startWords(trigger, w, days, segment, schedule);
  return goals.length > 0 ? `${start} ${w.goal}` : start;
}
