import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { addDays, todayIn } from "@/lib/analytics-period";
import { HANDOFF_WORDS, OUTCOME_WORDS, topicWords } from "@/lib/support-inbox-text";
import { durationFigureWords, rateWords, type SupportReport } from "@/lib/support-reports";
import { MIN_SUPPORT_SAMPLE } from "@/lib/support-rules";

import type { Store } from "./stores";
import { deskSettings } from "./support";
import { managerDesk, type Desk } from "./support-desk";
import { storeTotals } from "./support-platform";
import { KAIZEN_TIME_ZONE, deskReport, supportNow } from "./support-reports";

type Row = Record<string, unknown>;

/**
 * The AI manager's support tools (D216, `docs/support.md` 5.5, step 14): `support_overview` and `list_support_conversations` for a
 * store (`support:read`), and the platform's `support_overview` (Kaizen's desk and the stores' totals). Every figure is worked out
 * in code by the report's own functions (`docs/analytics.md`, Support) and written in words with what is missing; a conversation is
 * given by its title, summary, status and link, never its transcript.
 */

const MODE_WORDS = { off: "the chat assistant answers alone (support is off)", ai_first: "the AI answers first, then a person", people: "people answer, no AI" } as const;

/** The last 30 days' figures in words, the same as the report page's. */
function figures(report: SupportReport) {
  return {
    conversations: report.conversations,
    handled_by_ai_alone: rateWords(report.aiAlone),
    resolved_by_ai_its_own_judgement: rateWords(report.aiResolved),
    handed_to_a_person: rateWords(report.handover),
    why_handed_over: Object.fromEntries(
      Object.entries(report.handoverWhy)
        .filter(([, n]) => n > 0)
        .map(([why, n]) => [HANDOFF_WORDS[why] ?? "A person took it over", n]),
    ),
    time_to_first_answer: durationFigureWords(report.firstAnswer),
    missed: `${report.missed.count} (ended while waiting, no answer)`,
    time_to_end: durationFigureWords(report.timeToEnd, false),
    said_we_helped: rateWords(report.rating),
    top_topics: report.topics.slice(0, 5).map((t) => `${topicWords(t.topic)}: ${t.count}`),
    requests: { opened: report.requests.opened, done: report.requests.done, declined: report.requests.declined, still_open: report.requests.open },
  };
}

async function overviewOf(desk: Desk, timeZone: string, reportsPath: string) {
  const now = new Date();
  const today = todayIn(now, timeZone);
  const [settings, current, { report }] = await Promise.all([
    deskSettings(desk),
    supportNow(desk, timeZone, now),
    deskReport(desk, { from: addDays(today, -29), to: addDays(today, 1) }, timeZone),
  ]);
  const mode = settings?.mode ?? "off";
  return {
    who_answers: MODE_WORDS[mode],
    now: {
      waiting_for_a_person: current.waiting,
      with_the_ai: current.withAi,
      with_a_person: current.withPerson,
      tone_alerts_open: current.toneAlerts,
      started_today: current.startedToday,
    },
    last_30_days: figures(report),
    note: `Rates and medians need ${MIN_SUPPORT_SAMPLE} conversations; with fewer the figure says what is missing. Per desk, never per person. The full report: ${reportsPath}.`,
  };
}

/** `support_overview` for a store. */
export async function supportOverviewTool({ store }: { store: Store }) {
  return overviewOf(managerDesk(store.id), store.timeZone, `/admin/${store.slug}/support/reports`);
}

/** `list_support_conversations`: titles, summaries, status and links, never the words of a conversation. */
export async function listSupportConversationsTool({ store }: { store: Store }, input: { status: "open" | "ended" | "all"; limit: number }) {
  const rows = await db().execute<Row>(sql`
    select c.id, c.status, c.handler, c.created_at, c.ended_at, c.tone_alert_at, c.rating,
      c.summary->>'title' as title, c.summary->>'text' as text, c.summary->>'outcome' as outcome, c.summary->'topics' as topics, c.summary_status
    from commerce.support_conversations c
    where c.store_id = ${store.id}::uuid ${input.status === "all" ? sql`` : sql`and c.status = ${input.status}`}
    order by c.last_message_at desc
    limit ${input.limit}
  `);
  return {
    count: rows.length,
    conversations: rows.map((r) => ({
      title: r.title ? String(r.title) : r.status === "open" ? "Still open: no summary yet" : "No summary",
      summary: r.text ? String(r.text) : null,
      status: r.status === "open" ? (r.handler === "queue" ? "waiting for a person" : r.handler === "human" ? "with a person" : "with the AI") : "ended",
      outcome: r.outcome ? (OUTCOME_WORDS[String(r.outcome)] ?? String(r.outcome)) : null,
      topics: Array.isArray(r.topics) ? (r.topics as unknown[]).filter((t): t is string => typeof t === "string").map(topicWords) : [],
      tone_alert: Boolean(r.tone_alert_at),
      rating: r.rating === "good" ? "said we helped" : r.rating === "bad" ? "said we did not help" : null,
      started: new Date(String(r.created_at)).toISOString().slice(0, 16).replace("T", " "),
      link: `/admin/${store.slug}/support?c=${String(r.id)}`,
    })),
    note: "Summaries are written by AI for staff. The words of a conversation are read in the inbox, not here.",
  };
}

/** The platform's `support_overview`: Kaizen's own desk, and the stores' support in totals (counts only, never a conversation). */
export async function platformSupportOverviewTool() {
  const now = new Date();
  const today = todayIn(now, KAIZEN_TIME_ZONE);
  const period = { from: addDays(today, -29), to: addDays(today, 1) };
  const [kaizen, { stores }] = await Promise.all([overviewOf(managerDesk(null), KAIZEN_TIME_ZONE, "/admin/platform/support/reports"), storeTotals(period)]);
  const conversations = stores.reduce((sum, s) => sum + s.report.conversations, 0);
  return {
    kaizen_desk: kaizen,
    stores_last_30_days: {
      stores_with_support: stores.length,
      conversations,
      waiting_now: stores.reduce((sum, s) => sum + s.waiting, 0),
      most_waiting_now: stores
        .filter((s) => s.waiting > 0)
        .sort((a, b) => b.waiting - a.waiting)
        .slice(0, 5)
        .map((s) => ({ store: s.store.name, waiting: s.waiting })),
      busiest: stores
        .filter((s) => s.report.conversations > 0)
        .sort((a, b) => b.report.conversations - a.report.conversations)
        .slice(0, 5)
        .map((s) => ({ store: s.store.name, conversations: s.report.conversations, handed_to_a_person: rateWords(s.report.handover), missed: s.report.missed.count })),
      page: "/admin/platform/support/stores",
    },
    note: "Stores' conversations are theirs: Kaizen sees counts and rates only.",
  };
}
