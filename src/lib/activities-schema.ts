import { z } from "zod";

import { zonedTime } from "./booking-slots";
import {
  ACTIVITY_DURATION_MAX,
  ACTIVITY_NOTE_MAX,
  ACTIVITY_TITLE_MAX,
  type ActivityInput,
  type ActivityKind,
  type ActivityProblem,
  DATE,
  TIME,
  blank,
  isActivityKind,
} from "./activities";

/**
 * The schemas of activities.ts (bloat review step 2.46), apart from its constants and helpers, so a screen that only reads a constant
 * or a helper loads no zod. Import this file only where a schema runs; activities.ts imports it as a type alone.
 */

/**
 * What a person typed, checked: a kind, a title, a day (and a time, if any) in the store's time zone, a length for a meeting, and who it
 * is about (a customer, a company or a deal: at least one). The note is kept as written, at most 2000 characters.
 */
export function cleanActivityInput(
  raw: Record<string, unknown>,
  timeZone: string,
): { ok: true; activity: ActivityInput } | { ok: false; problems: ActivityProblem[] } {
  const problems: ActivityProblem[] = [];
  const kind = blank(raw.kind);
  if (!isActivityKind(kind)) problems.push("kind");
  const title = blank(raw.title).replace(/\s+/g, " ");
  if (title.length < 1 || title.length > ACTIVITY_TITLE_MAX) problems.push("title");
  const noteText = typeof raw.note === "string" ? raw.note.trim() : "";
  if (noteText.length > ACTIVITY_NOTE_MAX) problems.push("note");
  const day = blank(raw.dueOn);
  const time = blank(raw.dueTime);
  let dueAt = "";
  if (!DATE.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`)) || (time !== "" && !TIME.test(time))) problems.push("due");
  else dueAt = new Date(zonedTime(day, time || "00:00", timeZone)).toISOString();
  let durationMinutes: number | null = null;
  if (blank(raw.duration)) {
    const n = Number(blank(raw.duration));
    if (!Number.isInteger(n) || n < 1 || n > ACTIVITY_DURATION_MAX) problems.push("duration");
    else durationMinutes = n;
  }
  const id = (value: unknown) => (blank(value) ? (z.uuid().safeParse(blank(value)).success ? blank(value) : undefined) : null);
  const assigneeId = id(raw.assigneeId);
  if (assigneeId === undefined) problems.push("assignee");
  const customerId = id(raw.customerId);
  const companyId = id(raw.companyId);
  const dealId = id(raw.dealId);
  if (customerId === undefined || companyId === undefined || dealId === undefined || (!customerId && !companyId && !dealId)) problems.push("who");
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    activity: {
      kind: kind as ActivityKind,
      title,
      note: noteText || null,
      dueAt,
      timed: time !== "",
      // A length belongs to a meeting; a call or a task has none.
      durationMinutes: kind === "meeting" ? durationMinutes : null,
      assigneeId: assigneeId ?? null,
      customerId: customerId ?? null,
      companyId: companyId ?? null,
      dealId: dealId ?? null,
    },
  };
}
