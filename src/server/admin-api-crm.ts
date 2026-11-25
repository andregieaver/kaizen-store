import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { CRM_API } from "@/lib/admin-api-crm";
import type { AdminAnswer, ApiRoute } from "@/lib/admin-api-routes";
import { readExtensionFacts, standingOf } from "@/lib/extensions";
import { mainCurrency } from "@/lib/markets";
import { minorUnitDigits } from "@/lib/money";
import { siteUrl } from "@/lib/site";

import { cursorAt, fail, ok, pageOf, paging, sinceWhere, type ApiAnswer } from "./admin-api-kit";
import type { ApiCaller } from "./api-tokens";
import { listDeals, pipelinesOf, type Deal, type Pipeline } from "./deals";
import { leadsOf } from "./leads";
import { owned } from "./owned";
import { col, typedRows } from "./typed-rows";

/**
 * The Admin API's CRM, read (D902, D901 P29): pipelines, deals, activities and leads behind Deals and its extension, and the store's companies.
 * Deals are paged here and then read through the board's own `listDeals()`, so a deal's worth is the one the board shows; activities and
 * companies straight from their tables with the store named in every condition; leads through the inbox's own `leadsOf()`. Never a lost
 * deal's reason, an activity's note or a lead's words.
 */

export const CRM_NAMES = CRM_API.map((o) => o.name);
type CrmName = (typeof CRM_API)[number]["name"];
export type CrmRoute = Extract<ApiRoute, { name: CrmName }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A query parameter that must be an id when given. */
function idParam(params: URLSearchParams, name: string): string | null {
  const value = params.get(name);
  if (value === null || value === "") return null;
  if (!UUID.test(value)) fail("invalid", `${name} is an id.`);
  return value;
}

const and = (condition: SQL | null) => (condition ? sql`and ${condition}` : sql``);

// Deals ---------------------------------------------------------------------

const dealOut =
  (slug: string, currency: string, pipelines: Pipeline[], updated: Map<string, string>) =>
  (deal: Deal): AdminAnswer<"deals.get">["data"] => {
    const pipeline = pipelines.find((p) => p.id === deal.pipelineId);
    const stage = pipeline?.stages.find((s) => s.id === deal.stageId);
    return {
      id: deal.id,
      title: deal.title,
      status: deal.status,
      pipeline: { id: deal.pipelineId, name: pipeline?.name ?? "" },
      stage: { id: deal.stageId, name: stage?.name ?? "", position: stage?.position ?? 0 },
      value: deal.value.minor === null ? null : deal.value.minor / 10 ** minorUnitDigits(currency),
      currency,
      customer: deal.customer ? { id: deal.customer.id, name: deal.customer.name } : null,
      company: deal.company,
      owner: deal.owner,
      expected_close_on: deal.expectedCloseOn,
      closed_at: deal.closedAt,
      closed_via: (deal.closedVia as AdminAnswer<"deals.get">["data"]["closed_via"]) ?? null,
      stage_entered_at: deal.stageEnteredAt,
      created_at: deal.createdAt,
      updated_at: updated.get(deal.id) ?? deal.createdAt,
      admin_url: `${siteUrl()}/admin/${slug}/deals/${deal.id}`,
    };
  };

const dealPage = z.object({ id: col.uuid, created_at: col.timestamp, updated_at: col.timestamp, cursor_at: col.text });

async function deals(caller: ApiCaller, params: URLSearchParams, one: string | null) {
  const store = caller.member.store;
  const page = paging(params, sql`d.created_at`, sql`d.id`);
  const status = params.get("status");
  if (status && !["open", "won", "lost"].includes(status)) fail("invalid", "status is open, won or lost.");
  const filters = one
    ? sql`and d.id = ${one}::uuid`
    : sql`and ${page.where} and ${sinceWhere(params, sql`d.updated_at`)}
        ${and(status ? sql`d.status = ${status}` : null)}
        ${and(((v) => (v ? sql`d.pipeline_id = ${v}::uuid` : null))(idParam(params, "pipeline_id")))}
        ${and(((v) => (v ? sql`d.stage_id = ${v}::uuid` : null))(idParam(params, "stage_id")))}
        ${and(((v) => (v ? sql`d.owner_id = ${v}::uuid` : null))(idParam(params, "owner_id")))}
        ${and(((v) => (v ? sql`d.customer_id = ${v}::uuid` : null))(idParam(params, "customer_id")))}
        ${and(((v) => (v ? sql`d.company_id = ${v}::uuid` : null))(idParam(params, "company_id")))}`;
  const rows = await typedRows(
    dealPage,
    sql`
      select d.id, d.created_at, d.updated_at, ${cursorAt(sql`d.created_at`)} as cursor_at
      from commerce.deals d
      where ${owned(store.id, sql`d.store_id`)} ${filters}
      order by d.created_at desc, d.id desc
      limit ${one ? 1 : page.limit + 1}
    `,
  );
  const shown = rows.slice(0, one ? 1 : page.limit);
  const [found, pipelines] = await Promise.all([shown.length ? listDeals(store, { ids: shown.map((r) => r.id) }) : Promise.resolve([]), pipelinesOf(store.id)]);
  const byId = new Map(found.map((d) => [d.id, d]));
  const out = dealOut(store.slug, mainCurrency(store), pipelines, new Map(rows.map((r) => [r.id, r.updated_at])));
  // A deal deleted between the page and its reading is left out; the cursor still moves past it.
  return { rows, page, data: shown.flatMap((r) => (byId.has(r.id) ? [out(byId.get(r.id)!)] : [])) };
}

// Activities ----------------------------------------------------------------

const activityRow = z.object({
  id: col.uuid,
  kind: z.enum(["call", "meeting", "task"]),
  title: col.text,
  due_at: col.timestamp,
  timed: col.bool,
  duration_minutes: col.int.nullable(),
  done_at: col.timestampOrNull,
  assignee_id: col.uuid.nullable(),
  assignee_name: col.textOrNull,
  customer_id: col.uuid.nullable(),
  company_id: col.uuid.nullable(),
  deal_id: col.uuid.nullable(),
  created_at: col.timestamp,
  updated_at: col.timestamp,
  cursor_at: col.text,
});

const activityOut =
  (slug: string) =>
  (r: z.output<typeof activityRow>): AdminAnswer<"activities.get">["data"] => {
    const base = `${siteUrl()}/admin/${slug}`;
    return {
      id: r.id,
      kind: r.kind,
      title: r.title,
      due_at: r.due_at,
      timed: r.timed,
      duration_minutes: r.duration_minutes,
      done_at: r.done_at,
      assignee: r.assignee_id ? { id: r.assignee_id, name: r.assignee_name ?? "" } : null,
      customer_id: r.customer_id,
      company_id: r.company_id,
      deal_id: r.deal_id,
      created_at: r.created_at,
      updated_at: r.updated_at,
      admin_url: r.deal_id
        ? `${base}/deals/${r.deal_id}`
        : r.customer_id
          ? `${base}/customers/${r.customer_id}`
          : r.company_id
            ? `${base}/companies/${r.company_id}`
            : base,
    };
  };

const readActivities = (storeId: string, where: SQL, limit: number) =>
  typedRows(
    activityRow,
    sql`
      select a.id, a.kind, a.title, a.due_at, a.timed, a.duration_minutes, a.done_at, a.assignee_id,
        coalesce(nullif(m.name, ''), m.email) as assignee_name, a.customer_id, a.company_id, a.deal_id, a.created_at, a.updated_at,
        ${cursorAt(sql`a.created_at`)} as cursor_at
      from commerce.activities a
      left join commerce.accounts m on m.id = a.assignee_id
      where ${owned(storeId, sql`a.store_id`)} and ${where}
      order by a.created_at desc, a.id desc
      limit ${limit}
    `,
  );

// Companies -----------------------------------------------------------------

const companyRow = z.object({
  id: col.uuid,
  name: col.text,
  organisation_number: col.text,
  active: col.bool,
  people: col.int,
  created_at: col.timestamp,
  updated_at: col.timestamp,
  cursor_at: col.text,
});

const companyOut =
  (slug: string) =>
  (r: z.output<typeof companyRow>): AdminAnswer<"companies.get">["data"] => ({
    id: r.id,
    name: r.name,
    organisation_number: r.organisation_number.trim() || null,
    active: r.active,
    people: r.people,
    created_at: r.created_at,
    updated_at: r.updated_at,
    admin_url: `${siteUrl()}/admin/${slug}/companies/${r.id}`,
  });

const readCompanies = (storeId: string, where: SQL, limit: number) =>
  typedRows(
    companyRow,
    sql`
      select k.id, k.name, k.organisation_number, k.active, k.created_at, k.updated_at, ${cursorAt(sql`k.created_at`)} as cursor_at,
        (select count(*)::int from commerce.customers c where c.store_id = k.store_id and c.company_id = k.id and c.copied_from is null) as people
      from commerce.customer_companies k
      where ${owned(storeId, sql`k.store_id`)} and ${where}
      order by k.created_at desc, k.id desc
      limit ${limit}
    `,
  );

// ---------------------------------------------------------------------------

export async function answerCrm(caller: ApiCaller, route: CrmRoute, request: Request): Promise<ApiAnswer> {
  const store = caller.member.store;
  const params = new URL(request.url).searchParams;
  if (route.name !== "companies.list" && route.name !== "companies.get" && standingOf(readExtensionFacts(store.extensionFacts), "deals", new Date()).state === "absent") {
    return fail("feature_off", "Deals and contracts is an extension this account does not have.");
  }
  switch (route.name) {
    case "pipelines.list": {
      const pipelines = await pipelinesOf(store.id);
      return ok(route.name, {
        data: pipelines.map((p) => ({
          id: p.id,
          name: p.name,
          stages: p.stages.map((s) => ({ id: s.id, name: s.name, position: s.position, probability: s.probability, quote_stage: s.quoteStage, contract_stage: s.contractStage })),
        })),
      });
    }
    case "deals.list": {
      const { rows, page, data } = await deals(caller, params, null);
      return ok(route.name, { data, next: page.next(rows) });
    }
    case "deals.get": {
      const { data } = await deals(caller, params, route.id);
      return ok(route.name, { data: data[0] ?? fail("not_found", "No such deal in this store.") });
    }
    case "activities.list": {
      const page = paging(params, sql`a.created_at`, sql`a.id`);
      const done = params.get("done");
      if (done && done !== "true" && done !== "false") fail("invalid", "done is true or false.");
      const where = sql`${page.where} and ${sinceWhere(params, sql`a.updated_at`)}
        ${and(done === "true" ? sql`a.done_at is not null` : done === "false" ? sql`a.done_at is null` : null)}
        ${and(((v) => (v ? sql`a.deal_id = ${v}::uuid` : null))(idParam(params, "deal_id")))}
        ${and(((v) => (v ? sql`a.customer_id = ${v}::uuid` : null))(idParam(params, "customer_id")))}
        ${and(((v) => (v ? sql`a.company_id = ${v}::uuid` : null))(idParam(params, "company_id")))}
        ${and(((v) => (v ? sql`a.assignee_id = ${v}::uuid` : null))(idParam(params, "assignee_id")))}`;
      const rows = await readActivities(store.id, where, page.limit + 1);
      return ok(route.name, pageOf(page, rows, activityOut(store.slug)));
    }
    case "activities.get": {
      const [found] = await readActivities(store.id, sql`a.id = ${route.id}::uuid`, 1);
      return ok(route.name, { data: found ? activityOut(store.slug)(found) : fail("not_found", "No such activity in this store.") });
    }
    case "leads.list": {
      const leads = await leadsOf(store.id);
      return ok(route.name, {
        data: leads.map((l) => ({ email: l.email, name: l.name, latest: l.latest, requests: l.items.map((i) => ({ kind: i.kind, source: i.source, id: i.id, at: i.at })) })),
      });
    }
    case "companies.list": {
      const page = paging(params, sql`k.created_at`, sql`k.id`);
      const rows = await readCompanies(store.id, sql`${page.where} and ${sinceWhere(params, sql`k.updated_at`)}`, page.limit + 1);
      return ok(route.name, pageOf(page, rows, companyOut(store.slug)));
    }
    case "companies.get": {
      const [found] = await readCompanies(store.id, sql`k.id = ${route.id}::uuid`, 1);
      return ok(route.name, { data: found ? companyOut(store.slug)(found) : fail("not_found", "No such company in this store.") });
    }
  }
}
