import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  cleanDealInput,
  cleanReason,
  dealValue,
  MAX_PIPELINES,
  MAX_STAGES,
  PIPELINE_NAME_MAX,
  STAGE_NAME_MAX,
  type DealInputProblem,
  type DealLinkKind,
  type DealStatus,
  type DealValue,
  type LinkValue,
  type WhoChoice,
} from "@/lib/deals";
import { mainCurrency } from "@/lib/markets";

import { audit, type Membership } from "./auth";
import { computeDraft } from "./draft-orders";
import { memberCan } from "./permissions";
import { uuidList } from "./sql-arrays";
import type { Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Deals and pipelines (S2 of `docs/own-books-and-sales.md`, D464): the one reader and writer of a store's deals for staff. A deal is
 * read with its person, company, owner and value (`dealValue()`: the linked things' amounts before VAT once there are any, else the
 * estimate, in the store's main currency); written only by someone who may change customers (`customers:write`), linking an order or a
 * quote only with `orders:read` and a Work assignment only where Work is on and they may read settings. Every statement carries the store
 * id, so another store's deal, stage, person or thing is `not_found`. The database keeps what no person writes (D464's rules): a stage's
 * clock and history, and the wins by a paid order or an issued Work invoice. Audited as `deal.*` and `pipeline.*` with ids only, never a
 * title or a reason.
 */

type Row = Record<string, unknown>;
type Db = ReturnType<typeof db>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const WRITE = "customers:write" as const;

export type Stage = { id: string; name: string; position: number; probability: number | null; quoteStage: boolean };
export type Pipeline = { id: string; name: string; stages: Stage[] };

export type DealLink = {
  id: string;
  kind: DealLinkKind;
  thingId: string;
  /** The thing's own name: an order's or a quote's number, an assignment's name. */
  label: string;
  /** An order's or a quote's status as kept; null for an assignment. */
  status: string | null;
  /** What it counts for, before VAT; null when it has no amount yet (an empty quote, an assignment with no price). */
  value: { minor: number; currency: string } | null;
};

export type Deal = {
  id: string;
  title: string;
  status: DealStatus;
  pipelineId: string;
  stageId: string;
  customer: { id: string; name: string; email: string } | null;
  company: { id: string; name: string } | null;
  owner: { id: string; name: string } | null;
  estimateMinor: number | null;
  currency: string;
  expectedCloseOn: string | null;
  closedAt: string | null;
  closedVia: string | null;
  closeReason: string | null;
  stageEnteredAt: string;
  createdAt: string;
  value: DealValue;
};

export type DealMove = { stageId: string | null; stageName: string | null; status: DealStatus; via: string | null; at: string; by: string | null };
export type DealDetail = Deal & { links: DealLink[]; moves: DealMove[] };

export type DealProblem = DealInputProblem | "forbidden" | "not_found" | "closed" | "taken";
export type DealResult = { ok: true; id: string } | { ok: false; problems: DealProblem[] };
export type PipelineProblem = "forbidden" | "not_found" | "name" | "taken" | "too_many" | "stages" | "has_deals";
export type PipelineResult = { ok: true; id: string } | { ok: false; problem: PipelineProblem };

/** A refusal found inside a transaction: thrown so its writes are undone, and caught with its reason. */
class Refused extends Error {
  constructor(readonly problem: PipelineProblem) {
    super("deals.refused");
  }
}

// ---------------------------------------------------------------------------
// Pipelines
// ---------------------------------------------------------------------------

const pipelineRow = z.object({
  id: col.uuid,
  name: col.text,
  stage_id: col.uuid.nullable(),
  stage_name: col.textOrNull,
  position: col.int.nullable(),
  probability: col.int.nullable(),
  quote_stage: col.bool.nullable(),
});

/** The store's pipelines in their order, each with its stages in theirs. */
export async function pipelinesOf(storeId: string, runner: Pick<Db, "execute"> = db()): Promise<Pipeline[]> {
  const rows = await typedRows(
    pipelineRow,
    sql`
      select p.id, p.name, s.id as stage_id, s.name as stage_name, s.position, s.probability, s.quote_stage
      from commerce.deal_pipelines p
      left join commerce.deal_stages s on s.store_id = p.store_id and s.pipeline_id = p.id
      where p.store_id = ${storeId}::uuid
      order by p.sort, p.created_at, p.id, s.position, s.created_at, s.id
    `,
    runner,
  );
  const out: Pipeline[] = [];
  for (const r of rows) {
    let p = out.at(-1);
    if (!p || p.id !== r.id) {
      p = { id: r.id, name: r.name, stages: [] };
      out.push(p);
    }
    if (r.stage_id) p.stages.push({ id: r.stage_id, name: r.stage_name ?? "", position: r.position ?? 0, probability: r.probability, quoteStage: r.quote_stage === true });
  }
  return out;
}

/**
 * The store's pipelines, its first made now when it has none (Homer's first visit): the name and stages in the viewer's words, the stage a
 * sent quote belongs in marked. Made once however many ask at the same time.
 */
export async function ensurePipeline(storeId: string, first: { name: string; stages: readonly { name: string; quoteStage?: boolean }[] }): Promise<Pipeline[]> {
  const now = await pipelinesOf(storeId);
  if (now.length > 0) return now;
  await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`deal_pipelines:${storeId}`}))`);
    const [exists] = await tx.execute<Row>(sql`select 1 from commerce.deal_pipelines where store_id = ${storeId}::uuid limit 1`);
    if (exists) return;
    const made = await typedRow(
      z.object({ id: col.uuid }),
      sql`insert into commerce.deal_pipelines (store_id, name) values (${storeId}::uuid, ${first.name.trim().slice(0, PIPELINE_NAME_MAX)}) returning id`,
      tx,
    );
    for (const [position, stage] of first.stages.slice(0, MAX_STAGES).entries()) {
      await tx.execute(sql`
        insert into commerce.deal_stages (store_id, pipeline_id, name, position, quote_stage)
        values (${storeId}::uuid, ${made!.id}::uuid, ${stage.name.trim().slice(0, STAGE_NAME_MAX)}, ${position}, ${stage.quoteStage === true})
      `);
    }
  });
  return pipelinesOf(storeId);
}

const cleanName = (raw: unknown, max: number): string | null => {
  const text = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  return text.length >= 1 && text.length <= max ? text : null;
};

/** What a stage list must be: one to twelve named stages, a probability of 0 to 100 or none, at most one where sent quotes go. */
export type StageInput = { id: string | null; name: string; probability: number | null; quoteStage: boolean };

function cleanStages(raw: readonly StageInput[]): StageInput[] | null {
  if (raw.length < 1 || raw.length > MAX_STAGES) return null;
  const out: StageInput[] = [];
  for (const s of raw) {
    const name = cleanName(s.name, STAGE_NAME_MAX);
    if (!name) return null;
    if (s.probability !== null && !(Number.isInteger(s.probability) && s.probability >= 0 && s.probability <= 100)) return null;
    out.push({ id: s.id, name, probability: s.probability, quoteStage: s.quoteStage === true });
  }
  if (out.filter((s) => s.quoteStage).length > 1) return null;
  const ids = out.flatMap((s) => (s.id ? [s.id] : []));
  return new Set(ids).size === ids.length ? out : null;
}

const uniqueViolation = (error: unknown) => (error as { code?: string; cause?: { code?: string } })?.code === "23505" || (error as { cause?: { code?: string } })?.cause?.code === "23505";

/** Lisa adds a pipeline with its stages (`customers:write`): at most twenty, each name once. */
export async function createPipeline(member: Membership, rawName: unknown, rawStages: readonly StageInput[]): Promise<PipelineResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const name = cleanName(rawName, PIPELINE_NAME_MAX);
  if (!name) return { ok: false, problem: "name" };
  const stages = cleanStages(rawStages.map((s) => ({ ...s, id: null })));
  if (!stages) return { ok: false, problem: "stages" };
  const storeId = member.store.id;
  try {
    const id = await db().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`deal_pipelines:${storeId}`}))`);
      const [count] = await tx.execute<Row>(sql`select count(*)::int as n, coalesce(max(sort), -1)::int as last from commerce.deal_pipelines where store_id = ${storeId}::uuid`);
      if (Number(count.n) >= MAX_PIPELINES) throw new Refused("too_many");
      const made = await typedRow(
        z.object({ id: col.uuid }),
        sql`insert into commerce.deal_pipelines (store_id, name, sort) values (${storeId}::uuid, ${name}, ${Number(count.last) + 1}) returning id`,
        tx,
      );
      await writeStages(tx, storeId, made!.id, stages, member.account.id);
      return made!.id;
    });
    await audit(member.account.id, storeId, "pipeline.created", { pipeline: id, stages: stages.length }, { area: "customers", target: { type: "pipeline", id } });
    return { ok: true, id };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, problem: error.problem };
    if (uniqueViolation(error)) return { ok: false, problem: "taken" };
    throw error;
  }
}

/** A pipeline renamed (`customers:write`). */
export async function renamePipeline(member: Membership, pipelineId: string, rawName: unknown): Promise<PipelineResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const name = cleanName(rawName, PIPELINE_NAME_MAX);
  if (!name) return { ok: false, problem: "name" };
  try {
    const [row] = await db().execute<Row>(sql`
      update commerce.deal_pipelines set name = ${name}, updated_at = now() where store_id = ${member.store.id}::uuid and id = ${pipelineId}::uuid returning id
    `);
    if (!row) return { ok: false, problem: "not_found" };
  } catch (error) {
    if (uniqueViolation(error)) return { ok: false, problem: "taken" };
    throw error;
  }
  await audit(member.account.id, member.store.id, "pipeline.renamed", { pipeline: pipelineId }, { area: "customers", target: { type: "pipeline", id: pipelineId } });
  return { ok: true, id: pipelineId };
}

/** A pipeline deleted with its stages (`customers:write`): only one no deal is in, and never the store's last. */
export async function deletePipeline(member: Membership, pipelineId: string): Promise<PipelineResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const storeId = member.store.id;
  try {
    await db().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`deal_pipelines:${storeId}`}))`);
      const [facts] = await tx.execute<Row>(sql`
        select exists (select 1 from commerce.deal_pipelines where store_id = ${storeId}::uuid and id = ${pipelineId}::uuid) as found,
          (select count(*)::int from commerce.deal_pipelines where store_id = ${storeId}::uuid) as pipelines,
          exists (select 1 from commerce.deals where store_id = ${storeId}::uuid and pipeline_id = ${pipelineId}::uuid) as has_deals
      `);
      if (!facts.found) throw new Refused("not_found");
      if (facts.has_deals) throw new Refused("has_deals");
      if (Number(facts.pipelines) <= 1) throw new Refused("too_many");
      await tx.execute(sql`delete from commerce.deal_pipelines where store_id = ${storeId}::uuid and id = ${pipelineId}::uuid`);
    });
  } catch (error) {
    if (error instanceof Refused) return { ok: false, problem: error.problem };
    throw error;
  }
  await audit(member.account.id, storeId, "pipeline.deleted", { pipeline: pipelineId }, { area: "customers", target: { type: "pipeline", id: pipelineId } });
  return { ok: true, id: pipelineId };
}

/**
 * A pipeline's stages as Lisa leaves them (`customers:write`): the list in its new order, each kept stage by its id and each new one with
 * none. A stage left out is deleted, its deals moved to the first stage of the list first (the history says so).
 */
export async function saveStages(member: Membership, pipelineId: string, raw: readonly StageInput[]): Promise<PipelineResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const stages = cleanStages(raw);
  if (!stages) return { ok: false, problem: "stages" };
  const storeId = member.store.id;
  try {
    await db().transaction(async (tx) => {
      const [pipeline] = await tx.execute<Row>(sql`
        select id from commerce.deal_pipelines where store_id = ${storeId}::uuid and id = ${pipelineId}::uuid for update
      `);
      if (!pipeline) throw new Refused("not_found");
      await writeStages(tx, storeId, pipelineId, stages, member.account.id);
    });
  } catch (error) {
    if (error instanceof Refused) return { ok: false, problem: error.problem };
    throw error;
  }
  await audit(member.account.id, storeId, "pipeline.stages_saved", { pipeline: pipelineId, stages: stages.length }, { area: "customers", target: { type: "pipeline", id: pipelineId } });
  return { ok: true, id: pipelineId };
}

async function writeStages(tx: Tx, storeId: string, pipelineId: string, stages: readonly StageInput[], accountId: string): Promise<void> {
  const existing = await typedRows(
    z.object({ id: col.uuid }),
    sql`select id from commerce.deal_stages where store_id = ${storeId}::uuid and pipeline_id = ${pipelineId}::uuid`,
    tx,
  );
  const known = new Set(existing.map((r) => r.id));
  if (stages.some((s) => s.id !== null && !known.has(s.id))) throw new Refused("stages");
  // At most one stage holds sent quotes: every mark comes off before the new one goes on.
  await tx.execute(sql`update commerce.deal_stages set quote_stage = false where store_id = ${storeId}::uuid and pipeline_id = ${pipelineId}::uuid and quote_stage`);
  const ids: string[] = [];
  for (const [position, stage] of stages.entries()) {
    if (stage.id) {
      await tx.execute(sql`
        update commerce.deal_stages set name = ${stage.name}, position = ${position}, probability = ${stage.probability}, quote_stage = ${stage.quoteStage}, updated_at = now()
        where store_id = ${storeId}::uuid and id = ${stage.id}::uuid
      `);
      ids.push(stage.id);
    } else {
      const made = await typedRow(
        z.object({ id: col.uuid }),
        sql`
          insert into commerce.deal_stages (store_id, pipeline_id, name, position, probability, quote_stage)
          values (${storeId}::uuid, ${pipelineId}::uuid, ${stage.name}, ${position}, ${stage.probability}, ${stage.quoteStage}) returning id
        `,
        tx,
      );
      ids.push(made!.id);
    }
  }
  const gone = [...known].filter((id) => !ids.includes(id));
  if (gone.length === 0) return;
  await tx.execute(sql`
    update commerce.deals set stage_id = ${ids[0]}::uuid, updated_by = ${accountId}::uuid, updated_at = now()
    where store_id = ${storeId}::uuid and pipeline_id = ${pipelineId}::uuid and stage_id = any(${uuidList(gone)})
  `);
  await tx.execute(sql`delete from commerce.deal_stages where store_id = ${storeId}::uuid and id = any(${uuidList(gone)})`);
}

// ---------------------------------------------------------------------------
// Reading deals
// ---------------------------------------------------------------------------

const dealRow = z.object({
  id: col.uuid,
  title: col.text,
  status: z.enum(["open", "won", "lost"]),
  pipeline_id: col.uuid,
  stage_id: col.uuid,
  customer_id: col.uuid.nullable(),
  customer_name: col.textOrNull,
  customer_email: col.textOrNull,
  company_id: col.uuid.nullable(),
  company_name: col.textOrNull,
  owner_id: col.uuid.nullable(),
  owner_name: col.textOrNull,
  estimate_minor: col.minorOrNull,
  currency: col.currency,
  expected_close_on: col.textOrNull,
  closed_at: col.timestampOrNull,
  closed_via: col.textOrNull,
  close_reason: col.textOrNull,
  stage_entered_at: col.timestamp,
  created_at: col.timestamp,
});

/** Which deals: of a pipeline (the board), a person, a company; closed ones only since a time. At most 500, the newest first. */
export type DealFilter = { pipelineId?: string; customerId?: string; companyId?: string; closedSince?: Date; id?: string };

const DEALS_MAX = 500;

/** The store's deals as the board and the customer pages show them, each with its value in the store's main currency. */
export async function listDeals(store: Store, filter: DealFilter = {}): Promise<Deal[]> {
  const rows = await typedRows(
    dealRow,
    sql`
      select d.id, d.title, d.status, d.pipeline_id, d.stage_id,
        d.customer_id, c.name as customer_name, c.email as customer_email,
        d.company_id, k.name as company_name,
        d.owner_id, coalesce(nullif(a.name, ''), a.email) as owner_name,
        d.estimate_minor, d.currency, to_char(d.expected_close_on, 'YYYY-MM-DD') as expected_close_on,
        d.closed_at, d.closed_via, d.close_reason, d.stage_entered_at, d.created_at
      from commerce.deals d
      left join commerce.customers c on c.store_id = d.store_id and c.id = d.customer_id
      left join commerce.customer_companies k on k.store_id = d.store_id and k.id = d.company_id
      left join commerce.accounts a on a.id = d.owner_id
      where d.store_id = ${store.id}::uuid
        and (${filter.id ?? null}::uuid is null or d.id = ${filter.id ?? null}::uuid)
        and (${filter.pipelineId ?? null}::uuid is null or d.pipeline_id = ${filter.pipelineId ?? null}::uuid)
        and (${filter.customerId ?? null}::uuid is null or d.customer_id = ${filter.customerId ?? null}::uuid)
        and (${filter.companyId ?? null}::uuid is null or d.company_id = ${filter.companyId ?? null}::uuid)
        and (d.status = 'open' or ${filter.closedSince?.toISOString() ?? null}::timestamptz is null or d.closed_at >= ${filter.closedSince?.toISOString() ?? null}::timestamptz)
      order by d.created_at desc, d.id
      limit ${DEALS_MAX}
    `,
  );
  const links = await linksOf(store.id, rows.map((r) => r.id));
  const main = mainCurrency(store);
  return rows.map((r) => {
    const counted: LinkValue[] = (links.get(r.id) ?? []).flatMap((l) => (l.value ? [{ kind: l.kind, minor: l.value.minor, currency: l.value.currency }] : []));
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      pipelineId: r.pipeline_id,
      stageId: r.stage_id,
      customer: r.customer_id ? { id: r.customer_id, name: r.customer_name ?? "", email: r.customer_email ?? "" } : null,
      company: r.company_id ? { id: r.company_id, name: r.company_name ?? "" } : null,
      owner: r.owner_id ? { id: r.owner_id, name: r.owner_name ?? "" } : null,
      estimateMinor: r.estimate_minor,
      currency: r.currency,
      expectedCloseOn: r.expected_close_on,
      closedAt: r.closed_at,
      closedVia: r.closed_via,
      closeReason: r.close_reason,
      stageEnteredAt: r.stage_entered_at,
      createdAt: r.created_at,
      value: dealValue({ minor: r.estimate_minor, currency: r.currency }, counted, main, store.localization.rates),
    };
  });
}

/** One deal with what it is linked to and its history, or null for none in this store. */
export async function getDeal(store: Store, dealId: string): Promise<DealDetail | null> {
  const [deal] = await listDeals(store, { id: dealId });
  if (!deal) return null;
  const [links, moves] = await Promise.all([
    linksOf(store.id, [deal.id]),
    typedRows(
      z.object({ stage_id: col.uuid.nullable(), stage_name: col.textOrNull, status: z.enum(["open", "won", "lost"]), via: col.textOrNull, at: col.timestamp, by_name: col.textOrNull }),
      sql`
        select m.stage_id, s.name as stage_name, m.status, m.via, m.at, coalesce(nullif(a.name, ''), a.email) as by_name
        from commerce.deal_moves m
        left join commerce.deal_stages s on s.store_id = m.store_id and s.id = m.stage_id
        left join commerce.accounts a on a.id = m.moved_by
        where m.store_id = ${store.id}::uuid and m.deal_id = ${deal.id}::uuid
        order by m.at, m.id
      `,
    ),
  ]);
  return {
    ...deal,
    links: links.get(deal.id) ?? [],
    moves: moves.map((m) => ({ stageId: m.stage_id, stageName: m.stage_name, status: m.status, via: m.via, at: m.at, by: m.by_name })),
  };
}

const linkRow = z.object({
  id: col.uuid,
  deal_id: col.uuid,
  kind: z.enum(["order", "draft", "work_assignment"]),
  thing_id: col.uuid,
  order_number: col.textOrNull,
  order_status: col.textOrNull,
  order_net: col.minorOrNull,
  order_currency: col.textOrNull,
  draft_number: col.textOrNull,
  draft_status: col.textOrNull,
  draft_order_id: col.uuid.nullable(),
  draft_order_status: col.textOrNull,
  draft_order_net: col.minorOrNull,
  draft_order_currency: col.textOrNull,
  assignment_name: col.textOrNull,
  billing_type: col.textOrNull,
  hourly_rate_minor: col.minorOrNull,
  fixed_amount_minor: col.minorOrNull,
  estimated_minutes: col.int.nullable(),
  assignment_currency: col.textOrNull,
});

const net = (minor: number | null, currency: string | null, status: string | null): { minor: number; currency: string } | null =>
  minor === null || !currency || status === "cancelled" ? null : { minor, currency: currency.trim() };

/**
 * What each deal is linked to and what each counts for, before VAT: an order its total less VAT (nothing once cancelled); a quote the
 * order made from it once there is one, else its price as the editor shows it while it is open; an assignment what was invoiced for it
 * (issued, not void), else its fixed fee, else its hours estimated at its rate. A quote whose order is linked to the same deal counts once.
 */
async function linksOf(storeId: string, dealIds: readonly string[]): Promise<Map<string, DealLink[]>> {
  const out = new Map<string, DealLink[]>();
  if (dealIds.length === 0) return out;
  const rows = await typedRows(
    linkRow,
    sql`
      select l.id, l.deal_id, l.kind, coalesce(l.order_id, l.draft_id, l.assignment_id) as thing_id,
        o.number as order_number, o.status::text as order_status, (o.total_minor - o.tax_minor) as order_net, o.currency as order_currency,
        dr.number as draft_number, dr.status as draft_status, dr.order_id as draft_order_id,
        dro.status::text as draft_order_status, (dro.total_minor - dro.tax_minor) as draft_order_net, dro.currency as draft_order_currency,
        w.name as assignment_name, w.billing_type, w.hourly_rate_minor, w.fixed_amount_minor, w.estimated_minutes, wc.currency as assignment_currency
      from commerce.deal_links l
      left join commerce.orders o on o.store_id = l.store_id and o.id = l.order_id
      left join commerce.draft_orders dr on dr.store_id = l.store_id and dr.id = l.draft_id
      left join commerce.orders dro on dro.store_id = l.store_id and dro.id = dr.order_id
      left join commerce.work_assignments w on w.store_id = l.store_id and w.id = l.assignment_id
      left join commerce.work_clients wc on wc.store_id = w.store_id and wc.id = w.client_id
      where l.store_id = ${storeId}::uuid and l.deal_id = any(${uuidList(dealIds)})
      order by l.created_at, l.id
    `,
  );
  const assignments = rows.filter((r) => r.kind === "work_assignment").map((r) => r.thing_id);
  const invoiced = new Map<string, { minor: number; currency: string }>();
  if (assignments.length > 0) {
    const sums = await typedRows(
      z.object({ assignment_id: col.uuid, currency: col.currency, minor: col.minor }),
      sql`
        select assignment_id, currency, coalesce(sum(subtotal_minor), 0) as minor
        from commerce.work_invoices
        where store_id = ${storeId}::uuid and assignment_id = any(${uuidList(assignments)}) and status in ('sent', 'paid')
        group by assignment_id, currency
        order by assignment_id, currency
      `,
    );
    // One currency an assignment: its client's. Should another appear, the larger sum stands for it rather than adding unlike amounts.
    for (const s of sums) if ((invoiced.get(s.assignment_id)?.minor ?? -1) < s.minor) invoiced.set(s.assignment_id, { minor: s.minor, currency: s.currency });
  }
  for (const r of rows) {
    let label = "";
    let status: string | null = null;
    let value: DealLink["value"] = null;
    if (r.kind === "order") {
      label = r.order_number ?? "";
      status = r.order_status;
      value = net(r.order_net, r.order_currency, r.order_status);
    } else if (r.kind === "draft") {
      label = r.draft_number ?? "";
      status = r.draft_status;
      const ownOrderLinked = r.draft_order_id !== null && rows.some((o) => o.deal_id === r.deal_id && o.kind === "order" && o.thing_id === r.draft_order_id);
      if (r.draft_order_id && !ownOrderLinked) value = net(r.draft_order_net, r.draft_order_currency, r.draft_order_status);
      else if (!r.draft_order_id && r.draft_status === "open") {
        const priced = await computeDraft(db(), storeId, r.thing_id);
        const summary = priced?.summary;
        if (summary && summary.lines.length > 0) value = { minor: summary.totalMinor - summary.taxMinor, currency: summary.currency };
      }
    } else {
      label = r.assignment_name ?? "";
      const currency = r.assignment_currency?.trim() ?? null;
      value =
        invoiced.get(r.thing_id) ??
        (currency && r.billing_type === "fixed_fee" && r.fixed_amount_minor !== null
          ? { minor: r.fixed_amount_minor, currency }
          : currency && r.hourly_rate_minor !== null && r.estimated_minutes !== null
            ? { minor: Math.round((r.hourly_rate_minor * r.estimated_minutes) / 60), currency }
            : null);
    }
    const list = out.get(r.deal_id) ?? [];
    list.push({ id: r.id, kind: r.kind, thingId: r.thing_id, label, status, value });
    out.set(r.deal_id, list);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Writing deals
// ---------------------------------------------------------------------------

/** Whether a person, company, owner and stage named on a deal are this store's: the problems for those that are not. */
async function namedProblems(storeId: string, deal: { customerId: string | null; companyId: string | null; ownerId: string | null; pipelineId: string; stageId: string }): Promise<DealProblem[]> {
  const facts = await typedRow(
    z.object({ who: col.bool, owner: col.bool, stage: col.bool }),
    sql`
      select
        (${deal.customerId}::uuid is null or exists (select 1 from commerce.customers where store_id = ${storeId}::uuid and id = ${deal.customerId}::uuid))
          and (${deal.companyId}::uuid is null or exists (select 1 from commerce.customer_companies where store_id = ${storeId}::uuid and id = ${deal.companyId}::uuid)) as who,
        (${deal.ownerId}::uuid is null or exists (select 1 from commerce.store_members where store_id = ${storeId}::uuid and account_id = ${deal.ownerId}::uuid
          and (expires_at is null or expires_at > now()))) as owner,
        exists (select 1 from commerce.deal_stages where store_id = ${storeId}::uuid and pipeline_id = ${deal.pipelineId}::uuid and id = ${deal.stageId}::uuid) as stage
    `,
  );
  const problems: DealProblem[] = [];
  if (!facts?.who) problems.push("who");
  if (!facts?.owner) problems.push("owner");
  if (!facts?.stage) problems.push("stage");
  return problems;
}

/** A new deal (`customers:write`), in the store's main currency, owned by the one who made it unless they chose another member. */
export async function createDeal(member: Membership, raw: Record<string, unknown>): Promise<DealResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problems: ["forbidden"] };
  const currency = mainCurrency(member.store);
  const cleaned = cleanDealInput(raw, currency);
  if (!cleaned.ok) return cleaned;
  const deal = { ...cleaned.deal, ownerId: cleaned.deal.ownerId ?? member.account.id };
  const problems = await namedProblems(member.store.id, deal);
  if (problems.length > 0) return { ok: false, problems };
  const made = await typedRow(
    z.object({ id: col.uuid }),
    sql`
      insert into commerce.deals (store_id, title, customer_id, company_id, owner_id, pipeline_id, stage_id, estimate_minor, currency, expected_close_on, created_by, updated_by)
      values (${member.store.id}::uuid, ${deal.title}, ${deal.customerId}::uuid, ${deal.companyId}::uuid, ${deal.ownerId}::uuid, ${deal.pipelineId}::uuid,
        ${deal.stageId}::uuid, ${deal.estimateMinor}, ${currency}, ${deal.expectedCloseOn}::date, ${member.account.id}::uuid, ${member.account.id}::uuid)
      returning id
    `,
  );
  await audit(member.account.id, member.store.id, "deal.created", { deal: made!.id }, { area: "customers", target: { type: "deal", id: made!.id } });
  return { ok: true, id: made!.id };
}

const currentRow = z.object({ pipeline_id: col.uuid, stage_id: col.uuid, status: z.enum(["open", "won", "lost"]), currency: col.currency });
const current = (storeId: string, dealId: string) =>
  typedRow(currentRow, sql`select pipeline_id, stage_id, status, currency from commerce.deals where store_id = ${storeId}::uuid and id = ${dealId}::uuid`);

/** A deal's title, person, company, owner, estimate and expected close changed (`customers:write`); its stage moves with `moveDeal()`. */
export async function updateDeal(member: Membership, dealId: string, raw: Record<string, unknown>): Promise<DealResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problems: ["forbidden"] };
  const now = await current(member.store.id, dealId);
  if (!now) return { ok: false, problems: ["not_found"] };
  const cleaned = cleanDealInput({ ...raw, pipelineId: now.pipeline_id, stageId: now.stage_id }, now.currency);
  if (!cleaned.ok) return cleaned;
  const deal = cleaned.deal;
  const problems = await namedProblems(member.store.id, deal);
  if (problems.length > 0) return { ok: false, problems };
  await db().execute(sql`
    update commerce.deals set title = ${deal.title}, customer_id = ${deal.customerId}::uuid, company_id = ${deal.companyId}::uuid, owner_id = ${deal.ownerId}::uuid,
      estimate_minor = ${deal.estimateMinor}, expected_close_on = ${deal.expectedCloseOn}::date, updated_by = ${member.account.id}::uuid, updated_at = now()
    where store_id = ${member.store.id}::uuid and id = ${dealId}::uuid
  `);
  await audit(member.account.id, member.store.id, "deal.updated", { deal: dealId }, { area: "customers", target: { type: "deal", id: dealId } });
  return { ok: true, id: dealId };
}

/** An open deal moved to a stage of any of the store's pipelines (`customers:write`): the board's drag, or its "Move to". */
export async function moveDeal(member: Membership, dealId: string, stageId: string): Promise<DealResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problems: ["forbidden"] };
  const now = await current(member.store.id, dealId);
  if (!now) return { ok: false, problems: ["not_found"] };
  if (now.status !== "open") return { ok: false, problems: ["closed"] };
  if (now.stage_id === stageId) return { ok: true, id: dealId };
  const [moved] = await db().execute<Row>(sql`
    update commerce.deals d set pipeline_id = s.pipeline_id, stage_id = s.id, updated_by = ${member.account.id}::uuid, updated_at = now()
    from commerce.deal_stages s
    where d.store_id = ${member.store.id}::uuid and d.id = ${dealId}::uuid and d.status = 'open'
      and s.store_id = d.store_id and s.id = ${stageId}::uuid
    returning d.id
  `);
  if (!moved) return { ok: false, problems: ["stage"] };
  await audit(member.account.id, member.store.id, "deal.moved", { deal: dealId, stage: stageId }, { area: "customers", target: { type: "deal", id: dealId } });
  return { ok: true, id: dealId };
}

/** An open deal won or lost by a person (`customers:write`); a lost one may say why, in at most 200 characters. */
export async function closeDeal(member: Membership, dealId: string, outcome: "won" | "lost", rawReason: unknown = null): Promise<DealResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problems: ["forbidden"] };
  const reason = outcome === "lost" ? cleanReason(rawReason) : null;
  const [closed] = await db().execute<Row>(sql`
    update commerce.deals set status = ${outcome}, closed_at = now(), closed_via = 'person', close_reason = ${reason},
      updated_by = ${member.account.id}::uuid, updated_at = now()
    where store_id = ${member.store.id}::uuid and id = ${dealId}::uuid and status = 'open'
    returning id
  `);
  if (!closed) return { ok: false, problems: [(await current(member.store.id, dealId)) ? "closed" : "not_found"] };
  await audit(member.account.id, member.store.id, outcome === "won" ? "deal.won" : "deal.lost", { deal: dealId, reason: reason !== null }, { area: "customers", target: { type: "deal", id: dealId } });
  return { ok: true, id: dealId };
}

/** A won or lost deal opened again in its stage (`customers:write`): its close and reason are forgotten, its history keeps them. */
export async function reopenDeal(member: Membership, dealId: string): Promise<DealResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problems: ["forbidden"] };
  const [opened] = await db().execute<Row>(sql`
    update commerce.deals set status = 'open', closed_at = null, closed_via = null, close_reason = null, updated_by = ${member.account.id}::uuid, updated_at = now()
    where store_id = ${member.store.id}::uuid and id = ${dealId}::uuid and status <> 'open'
    returning id
  `);
  if (!opened) return { ok: false, problems: [(await current(member.store.id, dealId)) ? "closed" : "not_found"] };
  await audit(member.account.id, member.store.id, "deal.reopened", { deal: dealId }, { area: "customers", target: { type: "deal", id: dealId } });
  return { ok: true, id: dealId };
}

/** A deal deleted with its links, history and fields (`customers:write`); what it was linked to is untouched. */
export async function deleteDeal(member: Membership, dealId: string): Promise<DealResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problems: ["forbidden"] };
  const [gone] = await db().execute<Row>(sql`delete from commerce.deals where store_id = ${member.store.id}::uuid and id = ${dealId}::uuid returning id`);
  if (!gone) return { ok: false, problems: ["not_found"] };
  await audit(member.account.id, member.store.id, "deal.deleted", { deal: dealId }, { area: "customers", target: { type: "deal", id: dealId } });
  return { ok: true, id: dealId };
}

/** Whether this member may link a thing of this kind: an order or a quote with `orders:read`, a Work assignment where Work is on. */
export function mayLink(member: Membership, kind: DealLinkKind): boolean {
  if (!memberCan(member, WRITE)) return false;
  if (kind === "work_assignment") return member.store.workOn && memberCan(member, "settings:read");
  return memberCan(member, "orders:read");
}

/** Whether a thing of this kind is the store's. */
const thingExists = (storeId: string, kind: DealLinkKind, thingId: string) =>
  kind === "order"
    ? sql`exists (select 1 from commerce.orders where store_id = ${storeId}::uuid and id = ${thingId}::uuid)`
    : kind === "draft"
      ? sql`exists (select 1 from commerce.draft_orders where store_id = ${storeId}::uuid and id = ${thingId}::uuid)`
      : sql`exists (select 1 from commerce.work_assignments where store_id = ${storeId}::uuid and id = ${thingId}::uuid)`;

/**
 * A deal linked to an order, a quote or a Work assignment of the store; each belongs to one deal (`taken` when another has it). A link to
 * something already paid or invoiced wins the deal at once (the database's rule).
 */
export async function linkThing(member: Membership, dealId: string, kind: DealLinkKind, thingId: string): Promise<DealResult> {
  if (!mayLink(member, kind)) return { ok: false, problems: ["forbidden"] };
  if (!z.uuid().safeParse(thingId).success) return { ok: false, problems: ["not_found"] };
  const storeId = member.store.id;
  const facts = await typedRow(
    z.object({ deal: col.bool, thing: col.bool }),
    sql`
      select exists (select 1 from commerce.deals where store_id = ${storeId}::uuid and id = ${dealId}::uuid) as deal,
        ${thingExists(storeId, kind, thingId)} as thing
    `,
  );
  if (!facts?.deal || !facts.thing) return { ok: false, problems: ["not_found"] };
  const [made] = await db().execute<Row>(sql`
    insert into commerce.deal_links (store_id, deal_id, kind, order_id, draft_id, assignment_id, created_by)
    values (${storeId}::uuid, ${dealId}::uuid, ${kind}, ${kind === "order" ? thingId : null}::uuid, ${kind === "draft" ? thingId : null}::uuid,
      ${kind === "work_assignment" ? thingId : null}::uuid, ${member.account.id}::uuid)
    on conflict do nothing
    returning id
  `);
  if (!made) return { ok: false, problems: ["taken"] };
  await audit(member.account.id, storeId, "deal.linked", { deal: dealId, kind, thing: thingId }, { area: "customers", target: { type: "deal", id: dealId } });
  return { ok: true, id: String(made.id) };
}

/** A link taken off a deal (`customers:write`); the deal keeps its status. */
export async function unlinkThing(member: Membership, dealId: string, linkId: string): Promise<DealResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problems: ["forbidden"] };
  const [gone] = await db().execute<Row>(sql`
    delete from commerce.deal_links where store_id = ${member.store.id}::uuid and deal_id = ${dealId}::uuid and id = ${linkId}::uuid returning id
  `);
  if (!gone) return { ok: false, problems: ["not_found"] };
  await audit(member.account.id, member.store.id, "deal.unlinked", { deal: dealId, link: linkId }, { area: "customers", target: { type: "deal", id: dealId } });
  return { ok: true, id: dealId };
}

/** The deal a thing is linked to, if any: an order's, a quote's or an assignment's own page shows it. */
export async function dealOfThing(storeId: string, kind: DealLinkKind, thingId: string): Promise<{ id: string; title: string; status: DealStatus } | null> {
  return typedRow(
    z.object({ id: col.uuid, title: col.text, status: z.enum(["open", "won", "lost"]) }),
    sql`
      select d.id, d.title, d.status from commerce.deal_links l join commerce.deals d on d.store_id = l.store_id and d.id = l.deal_id
      where l.store_id = ${storeId}::uuid and l.kind = ${kind}
        and (l.order_id = ${thingId}::uuid or l.draft_id = ${thingId}::uuid or l.assignment_id = ${thingId}::uuid)
    `,
  );
}

/** Open deals naming a company: a company with any is not deleted (its deals would be left with no one). */
export async function openDealsOfCompany(storeId: string, companyId: string): Promise<number> {
  const row = await typedRow(
    z.object({ n: col.int }),
    sql`select count(*)::int as n from commerce.deals where store_id = ${storeId}::uuid and company_id = ${companyId}::uuid and status = 'open'`,
  );
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Choosing who and what
// ---------------------------------------------------------------------------

export type { WhoChoice };

const likeOf = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** The store's people (by name, email or company name) and companies (by name) a new deal may be with: at most eight of each. */
export async function searchWho(storeId: string, raw: string): Promise<WhoChoice[]> {
  const text = raw.trim().slice(0, 80);
  if (text.length < 2) return [];
  const like = likeOf(text);
  const [people, companies] = await Promise.all([
    typedRows(
      z.object({ id: col.uuid, name: col.text, email: col.text, company_name: col.textOrNull }),
      sql`
        select id, name, email, company_name from commerce.customers
        where store_id = ${storeId}::uuid and (name ilike ${like} or email ilike ${like} or company_name ilike ${like})
        order by lower(coalesce(nullif(name, ''), email)) limit 8
      `,
    ),
    typedRows(
      z.object({ id: col.uuid, name: col.text, organisation_number: col.textOrNull }),
      sql`
        select id, name, organisation_number from commerce.customer_companies
        where store_id = ${storeId}::uuid and name ilike ${like} order by lower(name) limit 8
      `,
    ),
  ]);
  return [
    ...people.map((p): WhoChoice => ({ kind: "customer", id: p.id, label: p.name || p.email, detail: p.name ? p.email : p.company_name })),
    ...companies.map((c): WhoChoice => ({ kind: "company", id: c.id, label: c.name, detail: c.organisation_number || null })),
  ];
}

/** A person or a company as a deal names them, for a form that starts with one chosen (a customer's page's "New deal"). */
export async function whoOf(storeId: string, kind: "customer" | "company", id: string): Promise<WhoChoice | null> {
  if (!z.uuid().safeParse(id).success) return null;
  if (kind === "customer") {
    const row = await typedRow(
      z.object({ name: col.text, email: col.text }),
      sql`select name, email from commerce.customers where store_id = ${storeId}::uuid and id = ${id}::uuid`,
    );
    return row ? { kind, id, label: row.name || row.email, detail: row.name ? row.email : null } : null;
  }
  const row = await typedRow(
    z.object({ name: col.text, organisation_number: col.textOrNull }),
    sql`select name, organisation_number from commerce.customer_companies where store_id = ${storeId}::uuid and id = ${id}::uuid`,
  );
  return row ? { kind, id, label: row.name, detail: row.organisation_number || null } : null;
}

export type LinkCandidate = { kind: DealLinkKind; id: string; label: string; minor: number | null; currency: string | null; at: string };

/**
 * What a deal may be linked to: the orders and open or sent quotes of its person, or of its company's people, and the store's Work
 * assignments not yet done, each not linked to any deal yet; the newest first, twenty of each. Only the kinds this member may link.
 */
export async function linkCandidates(member: Membership, deal: Pick<Deal, "customer" | "company">): Promise<LinkCandidate[]> {
  const storeId = member.store.id;
  const customerId = deal.customer?.id ?? null;
  const companyId = deal.company?.id ?? null;
  const out: LinkCandidate[] = [];
  const whose = (alias: string) => sql`(${sql.identifier(alias)}.customer_id = ${customerId}::uuid or ${sql.identifier(alias)}.customer_id in
    (select c.id from commerce.customers c where c.store_id = ${storeId}::uuid and c.company_id = ${companyId}::uuid))`;
  if ((customerId || companyId) && mayLink(member, "order")) {
    const [orders, drafts] = await Promise.all([
      typedRows(
        z.object({ id: col.uuid, number: col.text, minor: col.minor, currency: col.currency, at: col.timestamp }),
        sql`
          select o.id, o.number, (o.total_minor - o.tax_minor) as minor, o.currency, o.created_at as at from commerce.orders o
          where o.store_id = ${storeId}::uuid and ${whose("o")} and o.copied_from is null and o.status <> 'cancelled'
            and not exists (select 1 from commerce.deal_links l where l.store_id = o.store_id and l.order_id = o.id)
          order by o.created_at desc limit 20
        `,
      ),
      typedRows(
        z.object({ id: col.uuid, number: col.text, currency: col.currency, at: col.timestamp }),
        sql`
          select d.id, d.number, d.currency, d.updated_at as at from commerce.draft_orders d
          where d.store_id = ${storeId}::uuid and ${whose("d")} and d.status in ('open', 'sent')
            and not exists (select 1 from commerce.deal_links l where l.store_id = d.store_id and l.draft_id = d.id)
          order by d.updated_at desc limit 20
        `,
      ),
    ]);
    out.push(...drafts.map((d): LinkCandidate => ({ kind: "draft", id: d.id, label: d.number, minor: null, currency: d.currency, at: d.at })));
    out.push(...orders.map((o): LinkCandidate => ({ kind: "order", id: o.id, label: o.number, minor: o.minor, currency: o.currency, at: o.at })));
  }
  if (mayLink(member, "work_assignment")) {
    const assignments = await typedRows(
      z.object({ id: col.uuid, name: col.text, client: col.text, at: col.timestamp }),
      sql`
        select w.id, w.name, c.name as client, w.created_at as at from commerce.work_assignments w
        join commerce.work_clients c on c.store_id = w.store_id and c.id = w.client_id
        where w.store_id = ${storeId}::uuid and w.status <> 'done'
          and not exists (select 1 from commerce.deal_links l where l.store_id = w.store_id and l.assignment_id = w.id)
        order by w.created_at desc limit 20
      `,
    );
    out.push(...assignments.map((a): LinkCandidate => ({ kind: "work_assignment", id: a.id, label: `${a.name} · ${a.client}`, minor: null, currency: null, at: a.at })));
  }
  return out;
}
