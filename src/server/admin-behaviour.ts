import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import {
  checkReading,
  pct,
  READING_SYSTEM,
  readingMessage,
  toolsWorthReading,
  worthReading,
  MAX_RECORDING_NOTES,
  MAX_USE_SCREENS,
  recordingNote,
  type AdminFigures,
  type RecordingNote,
  type ScreenFigure,
  type UseFigure,
} from "@/lib/admin-behaviour";
import { ADMIN_RECORDING_BUCKET, ADMIN_RECORDING_FOLDER, pathsOf } from "@/lib/recording";

import { adminScreenFigures } from "./admin-use";
import { aiFor, completeText } from "./ai";
import { logIncident } from "./incidents";
import { ownSpeedReport } from "./own-speed";
import { recordingFiles, type RecordingFiles } from "./recording-files";
import { readEvents } from "./recordings-read";
import { col, typedRows } from "./typed-rows";

/**
 * Learning from how store owners use the admin (D895 phase 3a, and 3b's admin heatmaps and recording notes): the week's figures from signals the
 * platform keeps as counts, and
 * the weekly reading by the platform's AI that turns them into at most three improvements for the owner to approve. Counts only, across
 * every store and the platform: never a message's words, never a store or a person. Owners' own app tools (`app__…`, D363) are left out:
 * their names are an owner's, and would point at one store.
 */

const DAY_MS = 86_400_000;

/** The AI manager's tools over the last seven days: calls, failures, and the thumbs on the answers that used each. */
async function toolFigures(since: Date) {
  const rows = await typedRows(
    z.object({
      tool: col.text,
      calls: col.int,
      failed: col.int,
      up: col.int,
      down: col.int,
    }),
    sql`
      select t.tool->>'name' as tool, count(*)::int as calls,
             count(*) filter (where (t.tool->>'ok')::boolean is false)::int as failed,
             count(*) filter (where m.feedback = 1)::int as up, count(*) filter (where m.feedback = -1)::int as down
      from commerce.assistant_messages m, jsonb_array_elements(m.tools) as t(tool)
      where m.role = 'assistant' and m.created_at >= ${since.toISOString()}::timestamptz
        and jsonb_typeof(m.tools) = 'array' and t.tool->>'name' ~ '^[a-z][a-z0-9_]{1,60}$' and t.tool->>'name' not like 'app\\_\\_%'
      group by 1
    `,
  );
  return rows.map((r) => ({ ...r, failedPct: pct(r.failed, r.calls) }));
}

/** The admin's screens that are not 'good' on largest paint or interaction time over the speed report's days (as the briefing's alert). */
async function screenFigures(now: Date): Promise<ScreenFigure[]> {
  const report = await ownSpeedReport("admin", now);
  return report.rows.flatMap((row) =>
    row.cells
      .filter((c) => (c.metric === "lcp" || c.metric === "inp") && c.value !== null && c.rating !== null && c.rating !== "good")
      .map((c) => ({
        screen: row.screen,
        kind: row.kind,
        loads: row.loads,
        metric: c.metric as "lcp" | "inp",
        p75Ms: Math.round(c.value ?? 0),
        rating: c.rating ?? "",
      })),
  );
}

/** The admin heatmaps' screens over the week whose shares are above their minimum, the most frustrated first (D895 phase 3b). */
async function heatFiguresOfWeek(now: Date): Promise<UseFigure[]> {
  const rows = await adminScreenFigures(now, 7);
  return rows
    .filter((r) => r.frustratedPct !== null && r.endPct !== null)
    .slice(0, MAX_USE_SCREENS)
    .map((r) => ({ screen: r.screen, views: r.views, frustratedPct: r.frustratedPct!, endPct: r.endPct!, deadClicks: r.deadClicks, rageClicks: r.rageClicks }));
}

/**
 * The notes of up to five of the week's recordings on the screens the figures point at, most frustrated first: what happened, written by
 * code from the kept events (`recordingNote()`), never the recording. Without the bucket, none.
 */
async function recordingNotes(since: Date, screens: readonly string[], files: RecordingFiles | null): Promise<RecordingNote[]> {
  if (!files || screens.length === 0) return [];
  const rows = await typedRows(
    z.object({ id: col.uuid, screens: z.array(z.string()), seqs: z.array(z.union([z.number(), z.string()]).transform(Number)) }),
    sql`select id, screens, seqs from commerce.platform_admin_recordings
        where started_at >= ${since.toISOString()}::timestamptz and segments > 0 and screens && ${`{${screens.join(",")}}`}::text[]
        order by rage_clicks desc, dead_clicks desc, started_at desc limit ${MAX_RECORDING_NOTES}`,
  );
  const notes: RecordingNote[] = [];
  for (const row of rows) {
    const paths = pathsOf({ storeId: ADMIN_RECORDING_FOLDER, id: row.id, sealed: false, seqs: row.seqs });
    const text = recordingNote(await readEvents(files, paths, [], { recordingId: row.id }));
    if (text) notes.push({ label: `r${notes.length + 1}`, id: row.id, screens: row.screens, text });
  }
  return notes;
}

/** The week's figures, worked out in code; only what is above its minimum volume. `files` is injectable for tests. */
export async function adminFigures(now: Date = new Date(), deps: { files?: RecordingFiles | null } = {}): Promise<AdminFigures> {
  const since = new Date(now.getTime() - 7 * DAY_MS);
  const [tools, screens, use] = await Promise.all([toolFigures(since), screenFigures(now), heatFiguresOfWeek(now)]);
  const files = deps.files === undefined ? recordingFiles(ADMIN_RECORDING_BUCKET) : deps.files;
  const notes = await recordingNotes(
    since,
    use.map((u) => u.screen),
    files,
  );
  return {
    from: since.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
    tools: toolsWorthReading(tools),
    screens,
    use,
    notes,
  };
}

/**
 * The weekly reading (Mondays, from the incidents job's daily step): the figures to the platform's AI, its answer checked in code
 * (`checkReading()`), and each proposal kept as an enhancement `proposed` by `platform_ai`, with the figures as its evidence, for the owner
 * to approve (a push goes at once). A proposal made before only counts (its fingerprint). Nothing to read, no AI set: no call. An error
 * is the caller's to report (the job's `report()`).
 */
export async function readAdminBehaviour(now: Date = new Date(), deps: { files?: RecordingFiles | null } = {}): Promise<{ read: boolean; proposed: number }> {
  const figures = await adminFigures(now, deps);
  if (!worthReading(figures)) return { read: false, proposed: 0 };
  const connection = await aiFor(null, { feature: "admin_reading" });
  if (!connection) return { read: false, proposed: 0 };
  const reply = await completeText(
    connection,
    [
      { role: "system", content: READING_SYSTEM },
      { role: "user", content: readingMessage(figures) },
    ],
    {
      maxTokens: 800,
      timeoutMs: 45_000,
      temperature: 0,
      reasoningEffort: "low",
    },
  );
  let proposed = 0;
  for (const p of checkReading(reply.text, figures)) {
    const logged = await logIncident({
      kind: "enhancement",
      source: "platform_ai",
      fingerprint: `platform_ai:${p.subject}:${p.title.toLowerCase().slice(0, 80)}`,
      title: p.title,
      evidence: {
        ...p.facts,
        why: p.why,
        figure: p.figure,
        week: `${figures.from}..${figures.to}`,
      },
    });
    if (logged?.created) proposed += 1;
  }
  return { read: true, proposed };
}
