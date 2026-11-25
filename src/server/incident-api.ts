import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import {
  claimBody,
  fixedBody,
  ingestBody,
  MAX_CLAIMS_PER_SESSION,
  MAX_PROPOSALS_PER_NIGHT,
  noteBody,
  problemOf,
  proposeBody,
  runFinishBody,
  runStartBody,
  type IncidentApiRoute,
} from "@/lib/incident-api";
import { workableStatus } from "@/lib/incidents";

import { autopilotSettings, incidentBoard, incidentDetail, logIncident, moveIncident, type MoveProblem } from "./incidents";
import { col, typedRow } from "./typed-rows";

/**
 * What the incident log's part of Kaizena Flow's own API answers (D895): the autopilot's Claude Code session reads the board and an entry,
 * asks whether to run, puts in what it pulled (Vercel's errors, the advisors, red CI), proposes at most `MAX_PROPOSALS_PER_NIGHT`
 * improvements a night, claims at most `MAX_CLAIMS_PER_SESSION` entries, and marks each fixed (with its commit), handed to the owner (with
 * a note) or given back. Every move goes through `moveIncident()`, so `INCIDENT_MOVES` holds here too: a proposal is never claimed before
 * the owner's Approve. JSON in and out; a problem is a 400 that says what, a move the log does not allow a 409.
 */

export type IncidentApiAnswer = { status: number; body: unknown };

const bad = (message: string): IncidentApiAnswer => ({ status: 400, body: { error: { code: "invalid", message } } });
const MOVE_ANSWERS: Record<MoveProblem, IncidentApiAnswer> = {
  unknown: { status: 404, body: { error: { code: "not_found", message: "No such entry." } } },
  move: { status: 409, body: { error: { code: "conflict", message: "The log does not allow that move from the entry's status now." } } },
  commit: bad("A fix needs its commit."),
  note: bad("Say why in the note."),
};
const moved = (outcome: Awaited<ReturnType<typeof moveIncident>>): IncidentApiAnswer =>
  outcome.ok ? { status: 200, body: { ok: true, from: outcome.from } } : MOVE_ANSWERS[outcome.problem];

async function kindOf(id: string) {
  return typedRow(z.object({ kind: z.enum(["error", "warning", "enhancement"]), claimed_by: col.textOrNull }), sql`select kind, claimed_by from commerce.platform_incidents where id = ${id}::uuid`);
}

/** Answers a route; `body` is the request's JSON (undefined for a GET). */
export async function runIncidentApiRoute(route: IncidentApiRoute, body: unknown): Promise<IncidentApiAnswer> {
  switch (route.name) {
    case "board":
      return { status: 200, body: { data: await incidentBoard() } };
    case "entry": {
      const entry = await incidentDetail(route.id);
      return entry ? { status: 200, body: entry } : MOVE_ANSWERS.unknown;
    }
    case "due": {
      const [settings, counts] = await Promise.all([
        autopilotSettings(),
        typedRow(
          z.object({ open: col.int, approved: col.int, claimed: col.int, proposed: col.int, needs_owner: col.int }),
          sql`select count(*) filter (where status = 'open')::int as open, count(*) filter (where status = 'approved')::int as approved,
                     count(*) filter (where status = 'claimed')::int as claimed, count(*) filter (where status = 'proposed')::int as proposed,
                     count(*) filter (where status = 'needs_owner')::int as needs_owner
              from commerce.platform_incidents`,
        ),
      ]);
      const waiting = (counts?.open ?? 0) + (counts?.approved ?? 0);
      return { status: 200, body: { on: settings.on, gap_hours: settings.gapHours, workable: waiting, counts, run: settings.on } };
    }
    case "ingest": {
      const parsed = ingestBody.safeParse(body);
      if (!parsed.success) return bad(problemOf(parsed.error));
      const logged = [];
      for (const entry of parsed.data.entries) {
        const result = await logIncident({ kind: entry.kind, source: entry.source, fingerprint: entry.fingerprint, title: entry.title, facts: entry.facts });
        logged.push(result ? { fingerprint: entry.fingerprint, id: result.id, status: result.status, created: result.created, reopened: result.reopened } : { fingerprint: entry.fingerprint, id: null });
      }
      return { status: 200, body: { data: logged } };
    }
    case "propose": {
      const parsed = proposeBody.safeParse(body);
      if (!parsed.success) return bad(problemOf(parsed.error));
      const made = await typedRow(
        z.object({ n: col.int }),
        sql`select count(*)::int as n from commerce.platform_incidents where source = 'nightly' and created_at > now() - interval '20 hours'`,
      );
      if ((made?.n ?? 0) >= MAX_PROPOSALS_PER_NIGHT) return { status: 429, body: { error: { code: "limit", message: `At most ${MAX_PROPOSALS_PER_NIGHT} proposals a night.` } } };
      const p = parsed.data;
      const logged = await logIncident({
        kind: "enhancement",
        source: "nightly",
        fingerprint: `nightly:${p.fingerprint}`,
        title: p.title,
        evidence: { ...p.evidence, reason: p.reason, session: p.session },
      });
      if (!logged) return { status: 500, body: { error: { code: "failed", message: "Not logged." } } };
      // A proposal made again (or once dismissed) only counts: say so, so the session proposes something else.
      return { status: 200, body: { id: logged.id, status: logged.status, created: logged.created } };
    }
    case "claim": {
      const parsed = claimBody.safeParse(body);
      if (!parsed.success) return bad(problemOf(parsed.error));
      const held = await typedRow(
        z.object({ n: col.int }),
        sql`select count(*)::int as n from commerce.platform_incidents where status = 'claimed' and claimed_by = ${parsed.data.session}`,
      );
      if ((held?.n ?? 0) >= MAX_CLAIMS_PER_SESSION) return { status: 429, body: { error: { code: "limit", message: `A session holds at most ${MAX_CLAIMS_PER_SESSION} entries.` } } };
      return moved(await moveIncident(route.id, "claimed", { session: parsed.data.session }, { claimHours: parsed.data.hours }));
    }
    case "fixed": {
      const parsed = fixedBody.safeParse(body);
      if (!parsed.success) return bad(problemOf(parsed.error));
      const entry = await kindOf(route.id);
      if (entry && entry.claimed_by !== parsed.data.session) return MOVE_ANSWERS.move;
      return moved(await moveIncident(route.id, "fixed", { session: parsed.data.session }, { commit: parsed.data.commit, note: parsed.data.note }));
    }
    case "needs_owner": {
      const parsed = noteBody.safeParse(body);
      if (!parsed.success) return bad(problemOf(parsed.error));
      const entry = await kindOf(route.id);
      if (entry && entry.claimed_by !== parsed.data.session) return MOVE_ANSWERS.move;
      return moved(await moveIncident(route.id, "needs_owner", { session: parsed.data.session }, { note: parsed.data.note }));
    }
    case "give_back": {
      const parsed = noteBody.safeParse(body);
      if (!parsed.success) return bad(problemOf(parsed.error));
      const entry = await kindOf(route.id);
      if (!entry) return MOVE_ANSWERS.unknown;
      if (entry.claimed_by !== parsed.data.session) return MOVE_ANSWERS.move;
      return moved(await moveIncident(route.id, workableStatus(entry.kind), { session: parsed.data.session }, { note: parsed.data.note }));
    }
    case "note": {
      const parsed = noteBody.safeParse(body);
      if (!parsed.success) return bad(problemOf(parsed.error));
      const row = await typedRow(
        z.object({ id: col.uuid }),
        sql`insert into commerce.platform_incident_events (incident_id, session, note)
            select id, ${parsed.data.session}, ${parsed.data.note} from commerce.platform_incidents where id = ${route.id}::uuid
            returning incident_id as id`,
      );
      return row ? { status: 200, body: { ok: true } } : MOVE_ANSWERS.unknown;
    }
    case "run_start": {
      const parsed = runStartBody.safeParse(body);
      if (!parsed.success) return bad(problemOf(parsed.error));
      const { session, reason, wake } = parsed.data;
      // The wake the app sent becomes this run; a run without one (the nightly, a hand run) is a row of its own.
      const run = wake
        ? await typedRow(
            z.object({ id: col.uuid }),
            sql`update commerce.platform_autopilot_runs set started_at = now(), session = ${session} where id = ${wake}::uuid and started_at is null returning id`,
          )
        : null;
      const id =
        run?.id ??
        (await typedRow(
          z.object({ id: col.uuid }),
          sql`insert into commerce.platform_autopilot_runs (reason, started_at, session) values (${reason}, now(), ${session}) returning id`,
        ))?.id;
      return { status: 200, body: { id } };
    }
    case "run_finish": {
      const parsed = runFinishBody.safeParse(body);
      if (!parsed.success) return bad(problemOf(parsed.error));
      const p = parsed.data;
      const row = await typedRow(
        z.object({ id: col.uuid }),
        sql`update commerce.platform_autopilot_runs
               set finished_at = now(), summary = ${p.summary}, claimed = ${p.claimed}, fixed = ${p.fixed}, proposed = ${p.proposed}
             where id = ${route.id}::uuid and started_at is not null and finished_at is null returning id`,
      );
      return row ? { status: 200, body: { ok: true } } : MOVE_ANSWERS.unknown;
    }
  }
}
