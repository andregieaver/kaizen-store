/**
 * The AI manager's notices (wave 8 unit F, D350): what it finished or waits on while the person was away. Pure, so the launcher, the panel
 * and the account's page share the kinds and their words' keys.
 */

export const NOTICE_KINDS = ["page_built", "follow_up", "plan_question", "plan_done", "approval_waiting", "report_ready", "life_handoff"] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/** How long a notice is kept, read or not. */
export const NOTICE_DAYS = 60;

/** How often an open admin asks again how many notices wait (and at once when the tab is shown again). */
export const NOTICE_POLL_MS = 60_000;

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
  return kind;
}
