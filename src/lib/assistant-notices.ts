/**
 * The AI manager's notices (wave 8 unit F, D350): what it finished or waits on while the person was away. Pure, so the launcher, the panel
 * and the account's page share the kinds and their words' keys.
 */

/** `test_decided` (E4.1, D729): the store decided an autopilot test of its own change, at *Do it and tell me* (`{page}`, outcome `live` or `kept`). */
export const NOTICE_KINDS = ["page_built", "follow_up", "plan_question", "plan_done", "approval_waiting", "report_ready", "life_handoff", "test_answered", "test_decided"] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/** How long a notice is kept, read or not. */
export const NOTICE_DAYS = 60;

/** How often an open admin asks again how many notices wait while the count was lately above zero, the assistant was lately used, or an approval waits. */
export const NOTICE_POLL_MS = 60_000;

/** How often a tab nobody touches asks. */
export const NOTICE_IDLE_MS = 600_000;

/** How long after the last sign of use the one-minute pace is kept. */
export const NOTICE_ACTIVE_MS = 600_000;

/** A change of path asks again, at most this often. */
export const NOTICE_PATH_MS = 60_000;

/**
 * The milliseconds until an open tab asks again; `activeAt` is when the count was last above zero or the person last used the assistant;
 * `waiting` is whether one of their approvals waits.
 */
export function noticeWait(state: { now: number; activeAt: number | null; waiting: boolean }): number {
  if (state.waiting || (state.activeAt !== null && state.now - state.activeAt < NOTICE_ACTIVE_MS)) return NOTICE_POLL_MS;
  return NOTICE_IDLE_MS;
}

/** A notice's words from its kind's template and its facts (`{title}`, `{summary}`, `{plan}`, `{step}`), a missing fact left out. */
export function noticeText(template: string, facts: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => facts[key] ?? "").replace(/\s+/g, " ").replace(/\s([.,:;])/g, "$1").trim();
}

/** Which words a notice takes: its kind's, or the failure's where a build or follow-up did not succeed. */
export function noticeWordKey(kind: NoticeKind, facts: Record<string, string>): string {
  if (kind === "page_built" && facts.problem && !facts.title) return "page_failed";
  if (kind === "follow_up" && facts.outcome === "failed") return "follow_up_failed";
  // A task handed to Kaizen Life (docs/assistants-together.md): what it came to.
  if (kind === "life_handoff" && facts.outcome === "waiting") return "life_handoff_waiting";
  if (kind === "life_handoff" && facts.outcome === "failed") return "life_handoff_failed";
  // An autopilot test of its change that kept the page as it was (E4.1).
  if (kind === "test_decided" && facts.outcome === "kept") return "test_kept";
  return kind;
}
