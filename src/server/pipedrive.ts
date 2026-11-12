import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { zonedTime } from "@/lib/booking-slots";
import { CUSTOMER_NOTE_MAX } from "@/lib/customer-staff";
import { mainCurrency } from "@/lib/markets";
import {
  PD_LINK_KIND,
  PD_READERS,
  PD_TRIES,
  checkPage,
  countIn,
  emptySeen,
  newRun,
  nextFeed,
  noteHomes,
  ownersOf,
  runOf,
  skipIn,
  skipOf,
  type PdActivity,
  type PdDeal,
  type PdFeed,
  type PdHere,
  type PdLinkKind,
  type PdNote,
  type PdOrganization,
  type PdPerson,
  type PdPipeline,
  type PdRecord,
  type PdRun,
  type PdStage,
  type PdUser,
} from "@/lib/pipedrive";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";

import { audit, type Membership } from "./auth";
import { log } from "./log";
import {
  PipedriveError,
  pipedrivePage,
  pipedriveWhoAmI,
  type PipedriveDeps,
} from "./pipedrive-client";
import { encryptionKey } from "./encryption-key";
import { listStaff } from "./settings";
import { getStore } from "./stores";
import { textList, uuidList } from "./sql-arrays";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Moving in from Pipedrive (S7 of `docs/own-books-and-sales.md`, D477): the owner pastes the account's API token, which is checked (whose
 * it is) and kept encrypted; *Check* reads the whole account and counts what would come over and why the rest would not, writing nothing;
 * *Bring it over* reads it again and brings it: organisations as companies, persons as customers (D366's rules: nobody is subscribed or
 * emailed), pipelines and stages, deals, activities (marked told, so none pushes) and notes (kept by a person's email). A run goes feed by
 * feed and page by page within a budget, each page saved with its counts, under a short lease: the open page's ticks and the dispatcher's
 * `pipedrive` job move it on. What came over is linked to where it came from, so a second run brings only what is new. Reads only from
 * Pipedrive. The owner's (the actions check).
 */

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

const SOURCE = "pipedrive";
const LEASE_SECONDS = 90;
/** A tick's budget: the page's (a request) and the dispatcher's, which shares its own among stores. */
export const PD_TICK_MS = 25_000;

export type PipedriveMove = {
  tokenHint: string;
  account: string;
  accountName: string;
  connectedAt: string;
  run: PdRun | null;
};

const MOVE_ROW = z.object({
  token_hint: col.text,
  account: col.text,
  account_name: col.text,
  connected_at: col.timestamp,
  run: z.unknown(),
});

/** The store's Pipedrive account, while connected: whose it is and the latest run. */
export async function pipedriveMove(
  storeId: string,
): Promise<PipedriveMove | null> {
  const row = await typedRow(
    MOVE_ROW,
    sql`select token_hint, account, account_name, connected_at, run from commerce.crm_moves
         where store_id = ${storeId}::uuid and source = ${SOURCE} and token_encrypted is not null`,
  );
  return row
    ? {
        tokenHint: row.token_hint,
        account: row.account,
        accountName: row.account_name,
        connectedAt: row.connected_at,
        run: runOf(row.run),
      }
    : null;
}

/** Whether moving in from Pipedrive can be offered here: a token is kept only encrypted. */
export function pipedriveOffered(): boolean {
  return encryptionKey() !== null;
}

/** A Pipedrive API token in what was pasted (40 hex characters as Pipedrive makes them; any word of 20 to 100 letters and digits taken). */
export function readPipedriveToken(raw: string): string | null {
  const words = raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .split(/\s+/)
    .filter(Boolean);
  const token = (words[words.length - 1] ?? "").replace(/^["'`]+|["'`]+$/g, "");
  return /^[A-Za-z0-9]{20,100}$/.test(token) ? token : null;
}

export type PipedriveConnectProblem =
  | "empty"
  | "not_a_token"
  | "no_key"
  | "refused"
  | "unreachable";

/**
 * Connects the store to the Pipedrive account the token opens: asks Pipedrive whose it is, and keeps it encrypted. Another account than the
 * one connected before starts afresh (its ids are its own); the same one keeps its last run.
 */
export async function connectPipedrive(
  member: Membership,
  pasted: string,
  deps: PipedriveDeps = {},
): Promise<
  | { ok: true; name: string; company: string }
  | { ok: false; problem: PipedriveConnectProblem }
> {
  if (!pasted.trim()) return { ok: false, problem: "empty" };
  const token = readPipedriveToken(pasted);
  if (!token) return { ok: false, problem: "not_a_token" };
  const key = encryptionKey();
  if (!key) return { ok: false, problem: "no_key" };
  let me: Awaited<ReturnType<typeof pipedriveWhoAmI>>;
  try {
    me = await pipedriveWhoAmI(token, deps);
  } catch (error) {
    const problem =
      error instanceof PipedriveError && error.problem === "token_refused"
        ? "refused"
        : "unreachable";
    log("warn", "pipedrive.connect_refused", {
      storeId: member.store.id,
      problem,
    });
    return { ok: false, problem };
  }
  if (!me.companyId) return { ok: false, problem: "unreachable" };
  const store = member.store.id;
  await db().execute(sql`
    insert into commerce.crm_moves (store_id, source, token_encrypted, token_hint, account, account_name, connected_by, connected_at, run)
    values (${store}::uuid, ${SOURCE}, ${encryptSecret(token, key)}, ${`…${token.slice(-4)}`}, ${me.companyId}, ${me.company.slice(0, 200)},
            ${member.account.id}::uuid, now(), '{}'::jsonb)
    on conflict (store_id, source) do update set
      token_encrypted = excluded.token_encrypted, token_hint = excluded.token_hint, connected_by = excluded.connected_by, connected_at = now(),
      run = case when crm_moves.account = excluded.account then crm_moves.run else '{}'::jsonb end,
      account = excluded.account, account_name = excluded.account_name, lease_until = null, updated_at = now()
  `);
  await audit(member.account.id, store, "integration.pipedrive_connected", {
    account: me.companyId,
  });
  return { ok: true, name: me.name, company: me.company };
}

/** Forgets the token and the run; what came over stays, and stays linked, so connecting again brings only what is new. */
export async function disconnectPipedrive(member: Membership): Promise<void> {
  const gone = await typedRow(
    z.object({ account: col.text }),
    sql`delete from commerce.crm_moves where store_id = ${member.store.id}::uuid and source = ${SOURCE} returning account`,
  );
  if (gone)
    await audit(
      member.account.id,
      member.store.id,
      "integration.pipedrive_disconnected",
      { account: gone.account },
    );
}

/** Starts a check or an import; refused while one runs, or when not connected. */
export async function startPipedriveRun(
  member: Membership,
  mode: PdRun["mode"],
  now = new Date(),
): Promise<{ ok: boolean }> {
  const run = newRun(mode, member.account.id, now);
  const started = await typedRow(
    z.object({ account: col.text }),
    sql`update commerce.crm_moves set run = ${JSON.stringify(run)}::jsonb, lease_until = null, updated_at = now()
         where store_id = ${member.store.id}::uuid and source = ${SOURCE} and token_encrypted is not null and coalesce(run->>'status', '') <> 'running'
         returning account`,
  );
  if (!started) return { ok: false };
  if (mode === "import")
    await audit(
      member.account.id,
      member.store.id,
      "integration.pipedrive_import_started",
      { account: started.account },
    );
  return { ok: true };
}

type Ctx = {
  storeId: string;
  account: string;
  by: string | null;
  currency: string;
  timeZone: string;
  owners: Record<string, string>;
};

const TABLES: Record<PdLinkKind, string> = {
  organization: "customer_companies",
  person: "customers",
  pipeline: "deal_pipelines",
  stage: "deal_stages",
  deal: "deals",
  activity: "activities",
  note: "customer_notes",
};

/** Which of these came over before (linked, whether or not the row is still here), and which are here: linked to a row that still is. */
async function linksOf(
  tx: Tx,
  ctx: Ctx,
  kind: PdLinkKind,
  ids: readonly string[],
): Promise<{ linked: Set<string>; here: Map<string, string> }> {
  const linked = new Set<string>();
  const here = new Map<string, string>();
  if (ids.length === 0) return { linked, here };
  const rows = await tx.execute<{
    external_id: string;
    our_id: string;
    present: boolean;
  }>(sql`
    select l.external_id, l.our_id, (t.id is not null) as present
      from commerce.crm_move_links l
      left join ${sql.raw(`commerce.${TABLES[kind]}`)} t on t.store_id = l.store_id and t.id = l.our_id
     where l.store_id = ${ctx.storeId}::uuid and l.source = ${SOURCE} and l.account = ${ctx.account} and l.kind = ${kind}
       and l.external_id = any(${textList([...new Set(ids)])})
  `);
  for (const r of rows) {
    linked.add(String(r.external_id));
    if (r.present) here.set(String(r.external_id), String(r.our_id));
  }
  return { linked, here };
}

async function link(
  tx: Tx,
  ctx: Ctx,
  kind: PdLinkKind,
  externalId: string,
  ourId: string,
): Promise<void> {
  await tx.execute(sql`
    insert into commerce.crm_move_links (store_id, source, account, kind, external_id, our_id)
    values (${ctx.storeId}::uuid, ${SOURCE}, ${ctx.account}, ${kind}, ${externalId}, ${ourId}::uuid)
    on conflict do nothing
  `);
}

const ids = (values: readonly (string | null)[]) =>
  values.filter((v): v is string => !!v);
const noSet = new Set<string>();
const hereOf = (
  parts: Partial<{ [K in keyof PdHere]: PdHere[K] }>,
): PdHere => ({
  organization: parts.organization ?? noSet,
  person: parts.person ?? noSet,
  pipeline: parts.pipeline ?? noSet,
  stage: parts.stage ?? noSet,
  deal: parts.deal ?? new Map(),
  orgPeople: parts.orgPeople ?? noSet,
});
const keys = (map: ReadonlyMap<string, string>) => new Set(map.keys());

async function one(
  tx: Tx,
  query: ReturnType<typeof sql>,
): Promise<string | null> {
  const [row] = await tx.execute<{ id: string }>(query);
  return row ? String(row.id) : null;
}

/** An import's page: each record that is not here yet, and comes over, written and linked; counted in the run either way. */
async function importPage(
  tx: Tx,
  ctx: Ctx,
  feed: Exclude<PdFeed, "users">,
  records: readonly PdRecord[],
  run: PdRun,
): Promise<void> {
  const kind = PD_LINK_KIND[feed];
  const { linked } = await linksOf(
    tx,
    ctx,
    kind,
    records.map((r) => (r as { id: string }).id),
  );
  const fresh = records.filter((r) => {
    if (!linked.has((r as { id: string }).id)) return true;
    run.already += 1;
    return false;
  });
  if (fresh.length === 0) return;
  const store = ctx.storeId;

  if (feed === "organizations") {
    for (const o of fresh as PdOrganization[]) {
      const id =
        (await one(
          tx,
          sql`select id from commerce.customer_companies where store_id = ${store}::uuid and lower(name) = lower(${o.name})`,
        )) ??
        (await one(
          tx,
          sql`insert into commerce.customer_companies (store_id, name) values (${store}::uuid, ${o.name}) on conflict do nothing returning id`,
        ));
      if (!id) continue;
      await link(tx, ctx, kind, o.id, id);
      countIn(run.plan, feed, o);
    }
    return;
  }

  if (feed === "persons") {
    const orgs = (
      await linksOf(
        tx,
        ctx,
        "organization",
        ids((fresh as PdPerson[]).map((p) => p.orgId)),
      )
    ).here;
    for (const p of fresh as PdPerson[]) {
      const why = skipOf(feed, p, hereOf({}));
      if (why && why !== "quiet") skipIn(run.plan, why);
      if (why || !p.email) continue;
      const companyId = p.orgId ? (orgs.get(p.orgId) ?? null) : null;
      // A company keeps to its most members; past that, the person comes over without it.
      const room = companyId
        ? await one(
            tx,
            sql`select c.id from commerce.customer_companies c where c.store_id = ${store}::uuid and c.id = ${companyId}::uuid
                 and (select count(*) from commerce.customers m where m.store_id = c.store_id and m.company_id = c.id) < c.max_members`,
          )
        : null;
      const name = p.name.slice(0, 200);
      const phone = (p.phone ?? "").slice(0, 40);
      // Someone the store has already keeps what it has; only what is empty is filled in.
      const id =
        (await one(
          tx,
          sql`update commerce.customers set
                name = case when name = '' then ${name} else name end,
                phone = case when phone = '' then ${phone} else phone end,
                company_id = case when company_id is null and ${room}::uuid is not null then ${room}::uuid else company_id end,
                company_role = case when company_id is null and ${room}::uuid is not null then 'employee' else company_role end,
                updated_at = now()
              where store_id = ${store}::uuid and lower(email) = ${p.email} returning id`,
        )) ??
        (await one(
          tx,
          sql`insert into commerce.customers (store_id, email, name, phone, company_id, company_role)
              values (${store}::uuid, ${p.email}, ${name}, ${phone}, ${room}::uuid, ${room ? "employee" : null})
              on conflict (store_id, lower(email)) do nothing returning id`,
        ));
      if (!id) continue;
      await link(tx, ctx, kind, p.id, id);
      countIn(run.plan, feed, p);
    }
    return;
  }

  if (feed === "pipelines") {
    for (const p of fresh as PdPipeline[]) {
      const id =
        (await one(
          tx,
          sql`select id from commerce.deal_pipelines where store_id = ${store}::uuid and lower(name) = lower(${p.name})`,
        )) ??
        (await one(
          tx,
          sql`insert into commerce.deal_pipelines (store_id, name, sort) values (${store}::uuid, ${p.name}, ${p.order}) on conflict do nothing returning id`,
        ));
      if (!id) continue;
      await link(tx, ctx, kind, p.id, id);
      countIn(run.plan, feed, p);
    }
    return;
  }

  if (feed === "stages") {
    const pipelines = (
      await linksOf(
        tx,
        ctx,
        "pipeline",
        (fresh as PdStage[]).map((s) => s.pipelineId),
      )
    ).here;
    for (const s of fresh as PdStage[]) {
      const pipelineId = pipelines.get(s.pipelineId);
      if (!pipelineId) continue;
      const id =
        (await one(
          tx,
          sql`select id from commerce.deal_stages where store_id = ${store}::uuid and pipeline_id = ${pipelineId}::uuid and lower(name) = lower(${s.name}) limit 1`,
        )) ??
        (await one(
          tx,
          sql`insert into commerce.deal_stages (store_id, pipeline_id, name, position, probability)
              values (${store}::uuid, ${pipelineId}::uuid, ${s.name}, ${s.order}, ${s.probability}) returning id`,
        ));
      if (!id) continue;
      await link(tx, ctx, kind, s.id, id);
      countIn(run.plan, feed, s);
    }
    return;
  }

  if (feed === "deals") {
    const deals = fresh as PdDeal[];
    const persons = (
      await linksOf(tx, ctx, "person", ids(deals.map((d) => d.personId)))
    ).here;
    const orgs = (
      await linksOf(tx, ctx, "organization", ids(deals.map((d) => d.orgId)))
    ).here;
    const stages = (
      await linksOf(tx, ctx, "stage", ids(deals.map((d) => d.stageId)))
    ).here;
    const pipelineOf = new Map<string, string>();
    if (stages.size > 0) {
      const rows = await tx.execute<{ id: string; pipeline_id: string }>(
        sql`select id, pipeline_id from commerce.deal_stages where store_id = ${store}::uuid and id = any(${uuidList([...stages.values()])})`,
      );
      for (const r of rows) pipelineOf.set(String(r.id), String(r.pipeline_id));
    }
    const here = hereOf({
      person: keys(persons),
      organization: keys(orgs),
      stage: keys(stages),
    });
    for (const d of deals) {
      const why = skipOf(feed, d, here);
      if (why && why !== "quiet") skipIn(run.plan, why);
      if (why) continue;
      const stageId = stages.get(d.stageId!)!;
      const pipelineId = pipelineOf.get(stageId);
      if (!pipelineId) continue;
      const closed = d.status !== "open";
      const closedAt = closed ? (d.closedAt ?? new Date().toISOString()) : null;
      const added = d.addedAt ?? new Date().toISOString();
      const id = await one(
        tx,
        sql`insert into commerce.deals (store_id, title, customer_id, company_id, owner_id, pipeline_id, stage_id, status, estimate_minor, currency,
              expected_close_on, closed_at, closed_via, close_reason, stage_entered_at, created_by, updated_by, created_at)
            values (${store}::uuid, ${d.title}, ${d.personId ? (persons.get(d.personId) ?? null) : null}::uuid, ${d.orgId ? (orgs.get(d.orgId) ?? null) : null}::uuid,
              ${d.ownerId ? (ctx.owners[d.ownerId] ?? null) : null}::uuid, ${pipelineId}::uuid, ${stageId}::uuid, ${d.status},
              ${d.valueMinor}, ${d.currency ?? ctx.currency}, ${d.expectedCloseOn}::date, ${closedAt}::timestamptz, ${closed ? "person" : null},
              ${closed && d.status === "lost" && d.lostReason ? d.lostReason.slice(0, 200).trim() : null}, ${d.stageEnteredAt ?? added}::timestamptz,
              ${ctx.by}::uuid, ${ctx.by}::uuid, ${added}::timestamptz)
            returning id`,
      );
      if (!id) continue;
      await link(tx, ctx, kind, d.id, id);
      countIn(run.plan, feed, d);
    }
    return;
  }

  if (feed === "activities") {
    const acts = fresh as PdActivity[];
    const deals = (
      await linksOf(tx, ctx, "deal", ids(acts.map((a) => a.dealId)))
    ).here;
    const persons = (
      await linksOf(tx, ctx, "person", ids(acts.map((a) => a.personId)))
    ).here;
    const orgs = (
      await linksOf(tx, ctx, "organization", ids(acts.map((a) => a.orgId)))
    ).here;
    const here = hereOf({
      person: keys(persons),
      organization: keys(orgs),
      deal: new Map(
        [...deals.keys()].map((k) => [k, { personId: null, orgId: null }]),
      ),
    });
    for (const a of acts) {
      const why = skipOf(feed, a, here);
      if (why && why !== "quiet") skipIn(run.plan, why);
      if (why || !a.dueOn) continue;
      // Pipedrive keeps an activity's time in UTC; one without a time is due on its day, here.
      const dueAt = new Date(
        a.dueTime
          ? Date.parse(`${a.dueOn}T${a.dueTime}:00Z`)
          : zonedTime(a.dueOn, "00:00", ctx.timeZone),
      ).toISOString();
      const doneAt = a.done ? (a.doneAt ?? dueAt) : null;
      const note =
        [
          a.originalType && a.title !== a.originalType ? a.originalType : null,
          a.note,
        ]
          .filter(Boolean)
          .join("\n\n")
          .slice(0, 2000)
          .trim() || null;
      const id = await one(
        tx,
        sql`insert into commerce.activities (store_id, kind, title, note, due_at, timed, duration_minutes, assignee_id, customer_id, company_id, deal_id,
              done_at, notified_at, created_by)
            values (${store}::uuid, ${a.kind}, ${a.title}, ${note}, ${dueAt}::timestamptz, ${a.dueTime !== ""}, ${a.durationMinutes},
              ${a.ownerId ? (ctx.owners[a.ownerId] ?? null) : null}::uuid, ${a.personId ? (persons.get(a.personId) ?? null) : null}::uuid,
              ${a.orgId ? (orgs.get(a.orgId) ?? null) : null}::uuid, ${a.dealId ? (deals.get(a.dealId) ?? null) : null}::uuid,
              ${doneAt}::timestamptz, now(), ${ctx.by}::uuid)
            returning id`,
      );
      if (!id) continue;
      await link(tx, ctx, kind, a.id, id);
      countIn(run.plan, feed, a);
    }
    return;
  }

  // Notes: kept by a person's email, on its person, its deal's, or someone of its organisation (`noteHomes`).
  const notes = fresh as PdNote[];
  const deals = (
    await linksOf(tx, ctx, "deal", ids(notes.map((n) => n.dealId)))
  ).here;
  const dealPeople = new Map<
    string,
    { personId: string | null; orgId: string | null }
  >();
  if (deals.size > 0) {
    const rows = await tx.execute<{
      id: string;
      customer_id: string | null;
      company_id: string | null;
    }>(
      sql`select id, customer_id, company_id from commerce.deals where store_id = ${store}::uuid and id = any(${uuidList([...deals.values()])})`,
    );
    const byOurs = new Map(rows.map((r) => [String(r.id), r]));
    // Here a deal's person and organisation are ours (`c:` a customer, `o:` a company), looked up as such below.
    for (const [external, ours] of deals) {
      const r = byOurs.get(ours);
      dealPeople.set(external, {
        personId: r?.customer_id ? `c:${r.customer_id}` : null,
        orgId: r?.company_id ? `o:${r.company_id}` : null,
      });
    }
  }
  const persons = (
    await linksOf(tx, ctx, "person", ids(notes.map((n) => n.personId)))
  ).here;
  const orgs = (
    await linksOf(tx, ctx, "organization", ids(notes.map((n) => n.orgId)))
  ).here;
  for (const n of notes) {
    const homes = noteHomes(n, { deal: dealPeople });
    let email: string | null = null;
    for (const p of homes.persons) {
      const customer = p.startsWith("c:") ? p.slice(2) : persons.get(p);
      if (customer)
        email = await one(
          tx,
          sql`select lower(email) as id from commerce.customers where store_id = ${store}::uuid and id = ${customer}::uuid`,
        );
      if (email) break;
    }
    for (const o of email ? [] : homes.orgs) {
      const company = o.startsWith("o:") ? o.slice(2) : orgs.get(o);
      if (company) {
        email = await one(
          tx,
          sql`select lower(email) as id from commerce.customers where store_id = ${store}::uuid and company_id = ${company}::uuid order by created_at, id limit 1`,
        );
      }
      if (email) break;
    }
    if (!email) {
      skipIn(run.plan, "note_no_one");
      continue;
    }
    const body = n.text.slice(0, CUSTOMER_NOTE_MAX).trim();
    const id = await one(
      tx,
      sql`insert into commerce.customer_notes (store_id, email, body, created_at) values (${store}::uuid, ${email}, ${body}, ${n.addedAt ?? new Date().toISOString()}::timestamptz) returning id`,
    );
    if (!id) continue;
    await link(tx, ctx, kind, n.id, id);
    countIn(run.plan, feed, n);
  }
}

/** A check's page: what came over before is looked up (reads only), the rest counted with what is here so far. */
async function checkOnePage(
  tx: Tx,
  ctx: Ctx,
  feed: Exclude<PdFeed, "users">,
  records: readonly PdRecord[],
  run: PdRun,
): Promise<void> {
  const { linked, here } = await linksOf(
    tx,
    ctx,
    PD_LINK_KIND[feed],
    records.map((r) => (r as { id: string }).id),
  );
  // One linked to a row since deleted here stays away, and is counted as having come before.
  const gone = records.filter(
    (r) =>
      linked.has((r as { id: string }).id) &&
      !here.has((r as { id: string }).id),
  );
  run.already += gone.length;
  const rest = records.filter((r) => !gone.includes(r));
  run.seen ??= emptySeen();
  run.already += checkPage(feed, rest, run.seen, run.plan, keys(here));
}

/** The store's main currency and time zone, for what comes over without them. */
async function storeFacts(
  storeId: string,
): Promise<{ currency: string; timeZone: string } | null> {
  const row = await typedRow(
    z.object({ slug: col.text }),
    sql`select slug from commerce.stores where id = ${storeId}::uuid`,
  );
  const store = row ? await getStore(row.slug) : null;
  return store
    ? { currency: mainCurrency(store), timeZone: store.timeZone }
    : null;
}

const LEASED = z.object({
  token_encrypted: col.text,
  account: col.text,
  run: z.unknown(),
});

/**
 * Moves a running run on, page by page, until `budgetMs` is spent or it ends: under the lease, so two ticks never run it at once. A page is
 * written and its counts saved in one transaction, so a tick that stops anywhere picks up at the page it was on. Pipedrive refusing the token
 * ends the run (*Connect* again); not answering is tried again on the next tick, a few times.
 */
export async function advancePipedrive(
  storeId: string,
  deps: PipedriveDeps & { budgetMs?: number } = {},
): Promise<PdRun | null> {
  const leased = await typedRow(
    LEASED,
    sql`update commerce.crm_moves set lease_until = now() + make_interval(secs => ${LEASE_SECONDS})
         where store_id = ${storeId}::uuid and source = ${SOURCE} and token_encrypted is not null and run->>'status' = 'running'
           and (lease_until is null or lease_until < now())
         returning token_encrypted, account, run`,
  );
  if (!leased) return (await pipedriveMove(storeId))?.run ?? null;
  const run = runOf(leased.run);
  const key = encryptionKey();
  const facts = await storeFacts(storeId);
  const now = deps.now ?? Date.now;
  const started = now();
  const budget = deps.budgetMs ?? PD_TICK_MS;
  const save = async (tx: Tx | null, r: PdRun, release: boolean) => {
    await (tx ?? db()).execute(sql`
      update commerce.crm_moves set run = ${JSON.stringify(r)}::jsonb, updated_at = now(), lease_until = ${release ? null : sql`lease_until`}
       where store_id = ${storeId}::uuid and source = ${SOURCE}
    `);
  };
  if (!run || !key || !facts) {
    if (run)
      await save(
        null,
        {
          ...run,
          status: "failed",
          problem: "unexpected",
          finishedAt: new Date(now()).toISOString(),
        },
        true,
      );
    return run;
  }
  const token = decryptSecret(leased.token_encrypted, key);
  const ctx: Ctx = {
    storeId,
    account: leased.account,
    by: run.by,
    currency: facts.currency,
    timeZone: facts.timeZone,
    owners: run.owners,
  };

  while (run.status === "running" && now() - started < budget) {
    let page: { records: unknown[]; next: string | null };
    try {
      page = await pipedrivePage(token, run.feed, run.cursor, deps);
    } catch (error) {
      const problem =
        error instanceof PipedriveError ? error.problem : "unexpected";
      run.tries += 1;
      if (problem === "token_refused" || run.tries >= PD_TRIES) {
        run.status = "failed";
        run.problem = problem;
        run.finishedAt = new Date(now()).toISOString();
      }
      log("warn", "pipedrive.page_failed", {
        storeId,
        feed: run.feed,
        problem,
        tries: run.tries,
      });
      break;
    }
    run.tries = 0;
    const read = PD_READERS[run.feed];
    const records = page.records
      .map(read)
      .filter((r): r is PdRecord => r !== null);
    const before = structuredClone(run);
    try {
      await db().transaction(async (tx) => {
        if (run.feed === "users") {
          const team = (await listStaff(storeId))
            .filter((s) => !s.disabled)
            .map((s) => ({ accountId: s.accountId, email: s.email }));
          run.owners = {
            ...run.owners,
            ...ownersOf(records as PdUser[], team),
          };
          ctx.owners = run.owners;
        } else if (run.mode === "check")
          await checkOnePage(tx, ctx, run.feed, records, run);
        else await importPage(tx, ctx, run.feed, records, run);
        if (page.next) run.cursor = page.next;
        else {
          const next = nextFeed(run.feed);
          run.cursor = null;
          if (next) run.feed = next;
          else {
            run.status = "done";
            run.finishedAt = new Date(now()).toISOString();
            // A check's ids are no longer needed once it has counted.
            delete run.seen;
          }
        }
        await save(tx, run, false);
      });
    } catch (error) {
      // The page's writes were rolled back: its counts too. Tried again on the next tick, a few times, then the run says so.
      Object.assign(run, before, { tries: before.tries + 1 });
      log(
        "error",
        "pipedrive.page_not_written",
        { storeId, feed: run.feed, tries: run.tries },
        error,
      );
      if (run.tries >= PD_TRIES)
        Object.assign(run, {
          status: "failed",
          problem: "unexpected",
          finishedAt: new Date(now()).toISOString(),
        });
      break;
    }
  }
  await save(null, run, true);
  if (run.status === "done" && run.mode === "import") {
    await audit(run.by, storeId, "integration.pipedrive_imported", {
      account: ctx.account,
      already: run.already,
      ...countsOf(run),
    });
  }
  return run;
}

/** A run's counts for the audit log: numbers only. */
function countsOf(run: PdRun): Record<string, number> {
  const p = run.plan;
  return {
    companies: p.companies,
    customers: p.customers,
    pipelines: p.pipelines,
    stages: p.stages,
    deals: p.deals.open + p.deals.won + p.deals.lost,
    activities: p.activities,
    notes: p.notes,
  };
}

/**
 * The dispatcher's `pipedrive` job (D477): each store's running check or import moved on, one store after another within the job's budget,
 * so a run the owner left goes on without the page.
 */
export async function runPipedriveMoves(
  deps: PipedriveDeps & { budgetMs?: number } = {},
): Promise<{ advanced: number }> {
  const rows = await typedRows(
    z.object({ store_id: col.uuid }),
    sql`select store_id from commerce.crm_moves
         where source = ${SOURCE} and token_encrypted is not null and run->>'status' = 'running' and (lease_until is null or lease_until < now())
         order by updated_at limit 20`,
  );
  const now = deps.now ?? Date.now;
  const started = now();
  const budget = deps.budgetMs ?? 40_000;
  let advanced = 0;
  for (const r of rows) {
    const left = budget - (now() - started);
    if (left < 5_000) break;
    await advancePipedrive(r.store_id, {
      ...deps,
      budgetMs: Math.min(PD_TICK_MS, left),
    });
    advanced += 1;
  }
  return { advanced };
}
