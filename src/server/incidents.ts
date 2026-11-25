import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { fillWords } from "@/lib/admin-fill";
import { PLATFORM_WORDS } from "@/lib/admin-words/platform";
import {
  AUTOPILOT_GAPS,
  canMove,
  CLAIM_HOURS,
  cleanTitle,
  CLOSED_STATUSES,
  firstStatus,
  DEFAULT_AUTOPILOT_GAP,
  INCIDENT_KEEP_DAYS,
  INCIDENT_LIMITS,
  INCIDENT_STATUSES,
  QUIET_HOURS,
  REPEAT_WRITE_SECONDS,
  workableStatus,
  type IncidentKind,
  type IncidentSource,
  type IncidentStatus,
} from "@/lib/incidents";

import { audit } from "./auth";
import { log } from "./log";
import { sendPlatformPush } from "./push";
import { col, typedRow, typedRows, type Executor } from "./typed-rows";

/**
 * The incident log (D895, `docs/audits/incident-autopilot-2026-11.md`): the one writer of `commerce.platform_incidents` and its events. Errors
 * and warnings arrive through `logIncident()` (which never throws and never slows its caller); proposals and the owner's ideas through it
 * too; every change of status through `moveIncident()`, which checks `canMove()` before the database's trigger does and writes the event.
 * Facts are ids and counts only (as `log()`'s fields): never a person's name, email, address or a secret.
 */

export type IncidentFacts = Record<string, string | number | boolean | null>;

export type IncidentInput = {
  kind: IncidentKind;
  source: IncidentSource;
  fingerprint: string;
  title: string;
  facts?: IncidentFacts;
  evidence?: Record<string, unknown>;
  storeId?: string | null;
};

/** Who changed an entry: a platform admin's account, or the autopilot's session (its link). */
export type IncidentActor = { accountId: string } | { session: string };

export type LoggedIncident = { id: string; status: IncidentStatus; created: boolean; reopened: boolean };

const statusCol = z.enum(INCIDENT_STATUSES);

/** Facts cut to the row's limit: values to 500 characters, at most 30 keys, and nothing past the byte limit. */
function cleanFacts(facts: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(facts ?? {}).slice(0, 30)) {
    out[key.slice(0, 60)] = typeof value === "string" ? value.slice(0, 500) : value;
  }
  return JSON.stringify(out).length <= INCIDENT_LIMITS.factsBytes ? out : { cut: true };
}

const noteOf = (note: string | null | undefined) => {
  const text = (note ?? "").trim().slice(0, INCIDENT_LIMITS.note);
  return text === "" ? null : text;
};

async function writeEvent(
  tx: Executor,
  incidentId: string,
  actor: IncidentActor | null,
  move: { from: IncidentStatus | null; to: IncidentStatus | null },
  note: string | null,
): Promise<void> {
  await tx.execute(sql`
    insert into commerce.platform_incident_events (incident_id, account_id, session, from_status, to_status, note)
    values (${incidentId}::uuid, ${actor && "accountId" in actor ? actor.accountId : null}::uuid,
            ${actor && "session" in actor ? actor.session.slice(0, 300) : null}, ${move.from}, ${move.to}, ${note})
  `);
}

/**
 * Puts a problem or a proposal in the log, met by its fingerprint: a new one starts as `firstStatus()`; a repeat counts (at most once every
 * `REPEAT_WRITE_SECONDS`) and reopens a fixed or done problem; a dismissed or won't-fix one only counts. Never throws:
 * a failure is logged and gives null, so a broken log never breaks the request that met the problem.
 */
export async function logIncident(input: IncidentInput): Promise<LoggedIncident | null> {
  const logged = await writeIncident(input);
  // A proposal waits for the owner: a push at once, except the nightly run's, which waits for the 07:00 summary (the owner's answer).
  if (logged?.created && logged.status === "proposed" && input.source !== "nightly") await tellOwner(logged.id, "proposed", input.title);
  return logged;
}

async function writeIncident(input: IncidentInput): Promise<LoggedIncident | null> {
  const fingerprint = input.fingerprint.trim().slice(0, INCIDENT_LIMITS.fingerprint);
  const title = cleanTitle(input.title);
  if (!fingerprint || !title) return null;
  try {
    const facts = JSON.stringify(cleanFacts(input.facts));
    const evidence = JSON.stringify(cleanFacts(input.evidence));
    const status = firstStatus(input.kind, input.source);
    // One statement, so it is atomic without a transaction (a dispatcher job that logs opens none): `prev` is the row as it stood, `up`
    // inserts or counts it (a repeat within REPEAT_WRITE_SECONDS writes nothing; a fixed or done problem reopens, a proposal only counts),
    // `ev` writes the event of a new entry or a reopened one.
    const row = await typedRow(
      z.object({ id: col.uuid, status: statusCol, created: col.bool, reopened: col.bool }),
      sql`
        with prev as (
          select id, status from commerce.platform_incidents where fingerprint = ${fingerprint}
        ),
        up as (
          insert into commerce.platform_incidents as i (kind, source, fingerprint, title, facts, evidence, about_store_id, status)
          values (${input.kind}, ${input.source}, ${fingerprint}, ${title}, ${facts}::jsonb, ${evidence}::jsonb, ${input.storeId ?? null}::uuid, ${status})
          on conflict (fingerprint) do update set
            occurrences = i.occurrences + 1,
            last_seen_at = now(),
            status = case when i.kind <> 'enhancement' and i.status in ('fixed', 'done') then 'open' else i.status end,
            reopened_count = i.reopened_count + case when i.kind <> 'enhancement' and i.status in ('fixed', 'done') then 1 else 0 end,
            facts = case when i.kind <> 'enhancement' and i.status in ('fixed', 'done') then excluded.facts else i.facts end,
            done_at = case when i.kind <> 'enhancement' and i.status in ('fixed', 'done') then null else i.done_at end
          where (i.kind <> 'enhancement' and i.status in ('fixed', 'done'))
             or i.last_seen_at <= now() - make_interval(secs => ${REPEAT_WRITE_SECONDS})
          returning i.id, i.status, (xmax = 0) as created
        ),
        ev as (
          insert into commerce.platform_incident_events (incident_id, from_status, to_status, note)
          select up.id, prev.status, up.status, case when prev.id is null then null else 'Happened again' end
          from up left join prev on prev.id = up.id
          where prev.id is null or prev.status is distinct from up.status
          returning 1
        )
        select coalesce(up.id, prev.id) as id, coalesce(up.status, prev.status) as status, coalesce(up.created, false) as created,
               coalesce(prev.status is distinct from up.status and prev.id is not null and up.id is not null, false) as reopened
        from prev full join up on up.id = prev.id
      `,
    );
    return row;
  } catch (error) {
    log("error", "incidents.log_failed", { source: input.source, kind: input.kind }, error);
    return null;
  }
}

export type MoveProblem = "unknown" | "move" | "commit" | "note";

/**
 * Moves an entry to `to` when `canMove()` allows it, filling what the status needs: a claim its session and expiry, a fix its commit, a
 * decision of the owner's account its time. A note goes into the event (and, for `fixed` and `needs_owner`, onto the entry). Leaving `claimed`
 * clears the claim. Returns the problem rather than throwing for a move the log does not allow.
 */
export async function moveIncident(
  id: string,
  to: IncidentStatus,
  actor: IncidentActor,
  options: { note?: string | null; commit?: string | null; claimHours?: number } = {},
): Promise<{ ok: true; from: IncidentStatus } | { ok: false; problem: MoveProblem }> {
  if (!z.uuid().safeParse(id).success) return { ok: false, problem: "unknown" };
  const note = noteOf(options.note);
  const commit = options.commit?.trim().toLowerCase() ?? null;
  if (to === "fixed" && (!commit || !/^[0-9a-f]{7,40}$/.test(commit))) return { ok: false, problem: "commit" };
  if ((to === "needs_owner" || to === "wont_fix") && !note) return { ok: false, problem: "note" };
  if (to === "claimed" && !("session" in actor)) return { ok: false, problem: "move" };
  return db().transaction(async (tx) => {
    const row = await typedRow(
      z.object({ kind: z.enum(["error", "warning", "enhancement"]), status: statusCol }),
      sql`select kind, status from commerce.platform_incidents where id = ${id}::uuid for update`,
      tx,
    );
    if (!row) return { ok: false as const, problem: "unknown" as const };
    if (!canMove(row.kind, row.status, to)) return { ok: false as const, problem: "move" as const };
    const account = "accountId" in actor ? actor.accountId : null;
    const session = "session" in actor ? actor.session.slice(0, 300) : null;
    const hours = Math.min(Math.max(options.claimHours ?? CLAIM_HOURS, 1), 12);
    await tx.execute(sql`
      update commerce.platform_incidents
         set status = ${to},
             claimed_by = case when ${to} = 'claimed' then ${session} else null end,
             claim_expires_at = case when ${to} = 'claimed' then now() + make_interval(hours => ${hours}) else null end,
             fix_commit = case when ${to} = 'fixed' then ${commit} else fix_commit end,
             fixed_at = case when ${to} = 'fixed' then now() else fixed_at end,
             fix_note = case when ${to} in ('fixed', 'needs_owner') then ${note} else fix_note end,
             done_at = case when ${to} = 'done' then now() when ${to} in ('open', 'approved') then null else done_at end,
             decided_by = case when ${account}::uuid is not null then ${account}::uuid else decided_by end,
             decided_at = case when ${account}::uuid is not null then now() else decided_at end
       where id = ${id}::uuid
    `);
    await writeEvent(tx, id, actor, { from: row.status, to }, note);
    return { ok: true as const, from: row.status };
  }).then(async (done) => {
    if (done.ok && to === "needs_owner") await tellOwner(id, "needs_owner", null);
    return done;
  });
}

/**
 * A push to the platform's admins (D361) when something needs them: a new proposal, or an entry handed to them. Never throws (as
 * `sendPlatformPush()`); the entry's title is the platform's own words, never a person's data.
 */
async function tellOwner(id: string, why: "proposed" | "needs_owner", title: string | null): Promise<void> {
  try {
    const text =
      title ??
      (await typedRow(z.object({ title: col.text }), sql`select title from commerce.platform_incidents where id = ${id}::uuid`))?.title ??
      "";
    await sendPlatformPush(
      (lang) => {
        const w = PLATFORM_WORDS[lang].incidents.push;
        return { title: why === "proposed" ? w.proposedTitle : w.needsOwnerTitle, body: text, url: `/admin/platform/incidents/${id}`, tag: `incident-${id}` };
      },
      `incident-${id.slice(0, 20)}`,
    );
  } catch (error) {
    log("warn", "incidents.push_failed", { why }, error);
  }
}

/** The morning push, with the 07:00 summary: how many entries wait for the owner, if any (the night's proposals among them). */
export async function pushMorning(waiting: number): Promise<number> {
  if (waiting === 0) return 0;
  return sendPlatformPush(
    (lang) => {
      const w = PLATFORM_WORDS[lang].incidents.push;
      return { title: fillWords(w.morningTitle, { n: waiting }), body: PLATFORM_WORDS[lang].incidents.needsYou, url: "/admin/platform/incidents", tag: "incidents-morning" };
    },
    "incidents-morning",
  );
}

/** What the owner decides on an entry from the incidents page; each is written to the change log. */
export type OwnerDecision = "approve" | "dismiss" | "send_back" | "wont_fix" | "reopen";

/**
 * The owner's decision on an entry: Approve and Dismiss a proposal, Send back an entry handed to them, Won't fix (with why), Reopen. The
 * status it moves to depends on the entry's kind (`workableStatus()`). Written to the platform's change log.
 */
export async function decideIncident(
  accountId: string,
  id: string,
  decision: OwnerDecision,
  note: string | null = null,
): Promise<{ ok: true } | { ok: false; problem: MoveProblem }> {
  const kind = await typedRow(z.object({ kind: z.enum(["error", "warning", "enhancement"]) }), sql`select kind from commerce.platform_incidents where id = ${z.uuid().safeParse(id).success ? id : null}::uuid`);
  if (!kind) return { ok: false, problem: "unknown" };
  const to: IncidentStatus =
    decision === "approve" ? "approved" : decision === "dismiss" ? "dismissed" : decision === "wont_fix" ? "wont_fix" : workableStatus(kind.kind);
  const moved = await moveIncident(id, to, { accountId }, { note });
  if (!moved.ok) return moved;
  await audit(accountId, null, `platform.incident_${decision}`, { incident: id, from: moved.from, to });
  return { ok: true };
}

export type AutopilotSettings = { on: boolean; gapHours: number };

/** The autopilot's switch and gap (`platform_settings`). */
export async function autopilotSettings(): Promise<AutopilotSettings> {
  const row = await typedRow(z.object({ on: col.bool, gap: col.int }), sql`select autopilot_on as on, autopilot_gap_hours as gap from commerce.platform_settings limit 1`);
  return { on: row?.on ?? false, gapHours: row?.gap ?? DEFAULT_AUTOPILOT_GAP };
}

/** Saves the switch and the gap (one of `AUTOPILOT_GAPS`), written to the change log. */
export async function saveAutopilotSettings(accountId: string, settings: AutopilotSettings): Promise<boolean> {
  if (!(AUTOPILOT_GAPS as readonly number[]).includes(settings.gapHours)) return false;
  await db().execute(sql`
    update commerce.platform_settings set autopilot_on = ${settings.on}, autopilot_gap_hours = ${settings.gapHours}, updated_by = ${accountId}::uuid
  `);
  await audit(accountId, null, "platform.autopilot_settings", { on: settings.on, gapHours: settings.gapHours });
  return true;
}

/** An idea the owner wrote: an enhancement approved when saved (the owner's answer, 20 November 2026), its own fingerprint each time. */
export async function addIdea(accountId: string, title: string, note: string | null = null): Promise<LoggedIncident | null> {
  if (!cleanTitle(title)) return null;
  const logged = await logIncident({
    kind: "enhancement",
    source: "owner",
    fingerprint: `idea:${crypto.randomUUID()}`,
    title,
    facts: { by: accountId },
  });
  if (logged) await writeEvent(db(), logged.id, { accountId }, { from: null, to: null }, noteOf(note) ?? "Added by the owner");
  return logged;
}

/**
 * The log's upkeep, from the dispatcher's `incidents` job: claims past their time go back to the workable status (a session that died frees
 * its entries), and fixed entries quiet for `QUIET_HOURS` since the fix are done (a repeat would have reopened them). Each move writes its
 * event. Returns the counts.
 */
export async function keepIncidents(): Promise<{ released: number; done: number }> {
  // Each is one statement with its events written in the same one (a data-modifying CTE): an idle tick opens no transaction (the
  // dispatcher's jobs, idle, open none: `shop-journey.int.test.ts`).
  const released = await typedRows(
    z.object({ id: col.uuid }),
    sql`
      with gone as (
        update commerce.platform_incidents
           set status = case when kind = 'enhancement' then 'approved' else 'open' end, claimed_by = null, claim_expires_at = null
         where status = 'claimed' and claim_expires_at < now()
        returning id, status
      )
      insert into commerce.platform_incident_events (incident_id, from_status, to_status, note)
      select id, 'claimed', status, 'The claim ran out' from gone
      returning incident_id as id
    `,
  );
  const done = await typedRows(
    z.object({ id: col.uuid }),
    sql`
      with quiet as (
        update commerce.platform_incidents set status = 'done', done_at = now()
         where status = 'fixed' and fixed_at < now() - make_interval(hours => ${QUIET_HOURS})
        returning id
      )
      insert into commerce.platform_incident_events (incident_id, from_status, to_status, note)
      select id, 'fixed', 'done', ${`Quiet for ${QUIET_HOURS} hours`} from quiet
      returning incident_id as id
    `,
  );
  return { released: released.length, done: done.length };
}

/** Closed entries (and so the memory of a dismissed proposal) and old runs go after `INCIDENT_KEEP_DAYS`. Once a day, with the summary. */
export async function pruneIncidents(): Promise<number> {
  const gone = await db().execute(sql`
    delete from commerce.platform_incidents
     where status in (${sql.join(CLOSED_STATUSES.map((s) => sql`${s}`), sql`, `)})
       and updated_at < now() - make_interval(days => ${INCIDENT_KEEP_DAYS})
    returning 1 as x
  `);
  await db().execute(sql`
    delete from commerce.platform_autopilot_runs where requested_at < now() - make_interval(days => ${INCIDENT_KEEP_DAYS})
  `);
  return gone.length;
}

const entryRow = z.object({
  id: col.uuid,
  kind: z.enum(["error", "warning", "enhancement"]),
  source: col.text,
  title: col.text,
  status: statusCol,
  occurrences: col.int,
  reopened_count: col.int,
  first_seen_at: col.timestamp,
  last_seen_at: col.timestamp,
  claimed_by: col.textOrNull,
  fix_commit: col.textOrNull,
  fix_note: col.textOrNull,
  fixed_at: col.timestampOrNull,
  store_slug: col.textOrNull,
});

export type IncidentEntry = {
  id: string;
  kind: IncidentKind;
  source: string;
  title: string;
  status: IncidentStatus;
  occurrences: number;
  reopenedCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  claimedBy: string | null;
  fixCommit: string | null;
  fixNote: string | null;
  fixedAt: string | null;
  storeSlug: string | null;
};

const toEntry = (row: z.output<typeof entryRow>): IncidentEntry => ({
  id: row.id,
  kind: row.kind,
  source: row.source,
  title: row.title,
  status: row.status,
  occurrences: row.occurrences,
  reopenedCount: row.reopened_count,
  firstSeenAt: row.first_seen_at,
  lastSeenAt: row.last_seen_at,
  claimedBy: row.claimed_by,
  fixCommit: row.fix_commit,
  fixNote: row.fix_note,
  fixedAt: row.fixed_at,
  storeSlug: row.store_slug,
});

const entryColumns = sql`
  i.id, i.kind, i.source, i.title, i.status, i.occurrences, i.reopened_count, i.first_seen_at, i.last_seen_at, i.claimed_by,
  i.fix_commit, i.fix_note, i.fixed_at, s.slug as store_slug
`;

/**
 * What the incidents page shows by default: everything waiting or being worked, and what was fixed or done in the last `fixedDays` days.
 * Closed entries older than that are left out (Lisa's filters reach them).
 */
export async function incidentBoard(fixedDays = 14): Promise<IncidentEntry[]> {
  const rows = await typedRows(
    entryRow,
    sql`
      select ${entryColumns}
      from commerce.platform_incidents i left join commerce.stores s on s.id = i.about_store_id
      where i.status in ('open', 'proposed', 'approved', 'claimed', 'needs_owner')
         or (i.status in ('fixed', 'done') and coalesce(i.done_at, i.fixed_at) > now() - make_interval(days => ${fixedDays}))
      order by i.last_seen_at desc
      limit 300
    `,
  );
  return rows.map(toEntry);
}

export type IncidentEvent = { at: string; fromStatus: string | null; toStatus: string | null; note: string | null; who: string | null; session: string | null };

/** One entry with its facts, evidence and history, for its own page. */
export async function incidentDetail(
  id: string,
): Promise<(IncidentEntry & { facts: Record<string, unknown>; evidence: Record<string, unknown>; events: IncidentEvent[] }) | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const row = await typedRow(
    entryRow.extend({ facts: z.record(z.string(), z.unknown()), evidence: z.record(z.string(), z.unknown()) }),
    sql`
      select ${entryColumns}, i.facts, i.evidence
      from commerce.platform_incidents i left join commerce.stores s on s.id = i.about_store_id
      where i.id = ${id}::uuid
    `,
  );
  if (!row) return null;
  const events = await typedRows(
    z.object({
      at: col.timestamp,
      from_status: col.textOrNull,
      to_status: col.textOrNull,
      note: col.textOrNull,
      who: col.textOrNull,
      session: col.textOrNull,
    }),
    sql`
      select e.at, e.from_status, e.to_status, e.note, coalesce(a.name, a.email) as who, e.session
      from commerce.platform_incident_events e left join commerce.accounts a on a.id = e.account_id
      where e.incident_id = ${id}::uuid order by e.at, e.id
    `,
  );
  return {
    ...toEntry(row),
    facts: row.facts,
    evidence: row.evidence,
    events: events.map((e) => ({ at: e.at, fromStatus: e.from_status, toStatus: e.to_status, note: e.note, who: e.who, session: e.session })),
  };
}
