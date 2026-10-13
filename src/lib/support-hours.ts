import { hoursOn, type OpeningHours } from "./opening-hours";
import { ONLINE_SECONDS } from "./support-rules";

/**
 * Whether a desk can answer now (D216, `docs/support.md` 2.3): at least one agent online (switched on and seen within
 * `ONLINE_SECONDS`) and inside the desk's opening hours, in its time zone (no hours: always). Pure.
 */

export type AgentPresence = { status: "online" | "away"; lastSeenAt: Date | null };

export type Availability = { open: boolean; online: number; reason: "online" | "closed_hours" | "no_agents" };

/** The date (YYYY-MM-DD) and time (HH:MM) at `now` in `timeZone`. */
export function localClock(now: Date, timeZone: string): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** Inside a day's hours; a day closing at or before it opens runs past midnight. */
export function withinHours(hours: OpeningHours | null, now: Date, timeZone: string): boolean {
  if (!hours) return true;
  const { date, time } = localClock(now, timeZone);
  const today = hoursOn(hours, date);
  if (today && (today.close > today.open ? time >= today.open && time < today.close : time >= today.open)) return true;
  // Yesterday's hours that run past midnight.
  const yesterday = localClock(new Date(now.getTime() - 24 * 3600 * 1000), timeZone).date;
  const before = hoursOn(hours, yesterday);
  return before !== null && before.close <= before.open && time < before.close;
}

export const isOnline = (agent: AgentPresence, now: Date): boolean =>
  agent.status === "online" && agent.lastSeenAt !== null && now.getTime() - agent.lastSeenAt.getTime() <= ONLINE_SECONDS * 1000;

export function deskAvailability(input: { agents: readonly AgentPresence[]; now: Date; hours: OpeningHours | null; timeZone: string }): Availability {
  const online = input.agents.filter((a) => isOnline(a, input.now)).length;
  if (!withinHours(input.hours, input.now, input.timeZone)) return { open: false, online, reason: "closed_hours" };
  if (online === 0) return { open: false, online, reason: "no_agents" };
  return { open: true, online, reason: "online" };
}
