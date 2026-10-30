import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { DRILL_EMAIL_DOMAIN, DRILL_WORDS, drillPlan, PILOT_TASKS, pilotProblems, publishOutcome, type DrillKind, type DrillResult, type PilotProduct, type PilotTurn } from "@/lib/live-drills";
import { siteUrl } from "@/lib/site";

import { runAgentEval } from "./agent-eval";
import { ownConnection } from "./ai";
import { passMembership } from "./auth";
import { log } from "./log";
import { markSent, refundOrder, getOrderAdmin } from "./order-admin";
import { decideApproval, runTurn, type Principal } from "./owner-assistant";
import { memberCan } from "./permissions";
import { readMissingPaymentFacts } from "./payment-facts";
import { testPayment } from "./payment-mode-sql";
import { setArchived } from "./products";
import { refreshTag } from "./refresh";
import { connectWebhookUrl, type WebhookKind } from "./stripe";
import { col, typedRows } from "./typed-rows";
import type { PaymentModeName } from "@/lib/stripe-account";

/**
 * Live drills (consolidation, D406): Kaizena Flow runs a store's money paths for real in Stripe's test mode and keeps what each found, so a person or an AI
 * can see that refunds, marking sent, payment facts and the webhooks work in production, not only in tests. Requested by a platform admin (`requestDrills()`)
 * and run only by `runLiveDrills()` in the five-minute dispatcher, a request at a time. A store whose checkout is not in test mode is refused before
 * anything runs, and a drill touches only an order whose every payment was made on a test account and whose email is at Resend's test domain
 * (`DRILL_EMAIL_DOMAIN`): never real money, never a shopper. Each drill goes through the screens' own functions (`markSent()`, `refundOrder()`).
 */

const NOTE = "Live drill (D406)";

/** A platform admin's request for a store's drills. Returns the request's id, or why not. */
export async function requestDrills(storeId: string, kinds: readonly string[], accountId: string | null): Promise<{ ok: true; id: string } | { ok: false; problem: string }> {
  const plan = drillPlan(kinds);
  if (plan.length === 0) return { ok: false, problem: "Choose at least one drill." };
  if (!(await inTestMode(storeId))) return { ok: false, problem: "Drills run only on a store whose checkout is in Stripe's test mode." };
  const [row] = await db().execute<{ id: string }>(sql`
    insert into commerce.live_drills (store_id, requested_by, kinds) values (${storeId}::uuid, ${accountId}::uuid, ${`{${plan.join(",")}}`}::text[]) returning id
  `);
  return { ok: true, id: String(row.id) };
}

async function inTestMode(storeId: string): Promise<boolean> {
  const rows = await db().execute(sql`
    select 1 from commerce.payment_providers where store_id = ${storeId}::uuid and provider = 'stripe' and enabled and active_mode = 'test'
  `);
  return rows.length > 0;
}

/** Orders a drill may touch: the store's, paid to Resend's test domain, every payment on a test account, and at least one payment captured. */
const DRILL_ORDER = (o: string) => sql.raw(`${o}`);
function drillOrders(storeId: string) {
  const o = DRILL_ORDER("o");
  return sql`
    ${o}.store_id = ${storeId}::uuid and ${o}.copied_from is null and lower(${o}.email) like ${`%${DRILL_EMAIL_DOMAIN}`}
    and exists (select 1 from commerce.payments p where p.store_id = ${o}.store_id and p.order_id = ${o}.id and p.provider = 'stripe' and p.status = 'captured')
    and not exists (select 1 from commerce.payments p where p.store_id = ${o}.store_id and p.order_id = ${o}.id and not ${testPayment("p")})
  `;
}

const ORDER_ROW = z.object({ id: col.uuid, number: col.text });

async function pickOrder(storeId: string, extra: ReturnType<typeof sql>): Promise<{ id: string; number: string } | null> {
  const rows = await typedRows(ORDER_ROW, sql`select o.id, o.number from commerce.orders o where ${drillOrders(storeId)} and ${extra} order by o.placed_at limit 1`);
  return rows[0] ?? null;
}

/**
 * The database's own door (docs/security.md 2.1, PSI SEC-03), read from the production database itself: the roles Supabase's Data API signs in as
 * have no use of `commerce`, no grant on a table in it and no default grant that a new table would inherit. Not the store's: the platform's.
 */
async function doorDrill(): Promise<DrillResult> {
  const rows = await typedRows(
    z.object({ role: col.text, usage: col.bool, tables: col.int, defaults: col.int }),
    sql`
      select r.rolname as role, has_schema_privilege(r.rolname, 'commerce', 'USAGE') as usage,
        (select count(*)::int from information_schema.role_table_grants g where g.table_schema = 'commerce' and g.grantee = r.rolname) as tables,
        (select count(*)::int from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace, aclexplode(d.defaclacl) a
          where n.nspname = 'commerce' and a.grantee = r.oid) as defaults
      from pg_roles r where r.rolname in ('anon', 'authenticated')
    `,
  );
  if (rows.length === 0) return { kind: "database_door", outcome: "skipped", detail: "This database has no Data API roles." };
  const open = rows.filter((r) => r.usage || r.tables > 0 || r.defaults > 0);
  return open.length === 0
    ? { kind: "database_door", outcome: "passed", detail: `${rows.map((r) => r.role).join(" and ")}: no use of commerce, no table grant, no default grant.` }
    : {
        kind: "database_door",
        outcome: "failed",
        detail: open.map((r) => `${r.role}: ${[r.usage && "uses the schema", r.tables > 0 && `${r.tables} table grants`, r.defaults > 0 && `${r.defaults} default grants`].filter(Boolean).join(", ")}`).join("; "),
      };
}

async function webhooksDrill(): Promise<DrillResult> {
  const origin = siteUrl();
  const rows = await typedRows(
    z.object({ mode: col.text, kind: col.text, url: col.text }),
    sql`select mode, kind, url from commerce.platform_webhooks where provider = 'stripe'`,
  );
  const off = rows.filter((r) => r.url !== connectWebhookUrl(origin, r.mode as PaymentModeName, r.kind as WebhookKind));
  const [events] = await typedRows(
    z.object({ received: col.int, failed: col.int }),
    sql`select count(*)::int as received, count(*) filter (where last_error is not null)::int as failed
        from commerce.webhook_events where provider = 'stripe' and received_at > now() - interval '1 day'`,
  );
  if (rows.length === 0) return { kind: "webhooks", outcome: "failed", detail: "No Stripe endpoint is connected." };
  if (off.length > 0) return { kind: "webhooks", outcome: "failed", detail: `${off.length} of ${rows.length} endpoints are not at ${origin}.` };
  if (events.failed > 0) return { kind: "webhooks", outcome: "failed", detail: `${events.failed} of ${events.received} events in the last day failed.` };
  return { kind: "webhooks", outcome: "passed", detail: `${rows.length} endpoints at ${origin}; ${events.received} events in the last day, none failed.` };
}

async function factsDrill(storeId: string): Promise<DrillResult> {
  await readMissingPaymentFacts(20, { storeIds: [storeId] });
  const [row] = await typedRows(
    z.object({ paid: col.int, unread: col.int }),
    sql`select count(*)::int as paid, count(*) filter (where p.facts_read_at is null)::int as unread
        from commerce.payments p join commerce.orders o on o.id = p.order_id and o.store_id = p.store_id
        where ${drillOrders(storeId)} and p.provider = 'stripe' and p.status = 'captured' and p.created_at > now() - interval '1 day'`,
  );
  if (row.paid === 0) return { kind: "payment_facts", outcome: "skipped", detail: "No drill order was paid in the last day." };
  return row.unread === 0
    ? { kind: "payment_facts", outcome: "passed", detail: `${row.paid} payments, each read.` }
    : { kind: "payment_facts", outcome: "failed", detail: `${row.unread} of ${row.paid} payments were not read from Stripe.` };
}

async function sentDrill(storeId: string): Promise<DrillResult> {
  const order = await pickOrder(
    storeId,
    sql`o.status = 'paid' and exists (select 1 from commerce.order_lines l where l.store_id = o.store_id and l.order_id = o.id and l.delivery = 'physical'
        and commerce.line_to_send(l.id) > 0)`,
  );
  if (!order) return { kind: "mark_sent", outcome: "skipped", detail: "No paid drill order has goods to send." };
  const sent = await markSent(storeId, order.id, { carrier: "other", trackingNumber: `DRILL-${order.number}`, trackingUrl: null }, null);
  if (!sent.ok) return { kind: "mark_sent", outcome: "failed", detail: `Refused: ${sent.reason}.`, order: order.number };
  return { kind: "mark_sent", outcome: "passed", detail: `Marked sent; ${sent.left} units left to send.`, order: order.number };
}

async function refundDrill(storeId: string, kind: "partial_refund" | "full_refund"): Promise<DrillResult> {
  const order = await pickOrder(storeId, sql`o.status in ('paid', 'fulfilled')`);
  if (!order) return { kind, outcome: "skipped", detail: "No paid drill order is left to refund." };
  const before = await getOrderAdmin(storeId, order.id);
  if (!before || before.refundableMinor <= 0) return { kind, outcome: "skipped", detail: "Nothing is left to refund.", order: order.number };
  const amount = kind === "partial_refund" ? Math.min(100, before.refundableMinor) : before.refundableMinor;
  const outcome = await refundOrder(storeId, order.id, { amountMinor: amount, reason: NOTE, restock: [] }, null);
  if (!outcome.ok) return { kind, outcome: "failed", detail: `Refused: ${outcome.problem}`, order: order.number };
  const [refund] = await typedRows(
    z.object({ status: col.text, provider: col.bool }),
    sql`select r.status, r.provider_reference is not null as provider from commerce.refunds r where r.store_id = ${storeId}::uuid and r.id = ${outcome.refundId}::uuid`,
  );
  const after = await getOrderAdmin(storeId, order.id);
  const left = after?.refundableMinor ?? -1;
  const okay = refund && (refund.status === "succeeded" || refund.status === "pending") && refund.provider && left === before.refundableMinor - amount;
  return {
    kind,
    outcome: okay ? "passed" : "failed",
    detail: `${amount} minor units refunded (${refund?.status ?? "no refund row"}${refund?.provider ? ", at Stripe" : ""}); ${left} left to refund.`,
    order: order.number,
  };
}

/** The agents' safety eval (D391) on Kaizena Flow's own text model, kept with its recording as a run from Platform → AI is. */
async function evalDrill(requestedBy: string | null): Promise<DrillResult> {
  const connection = await ownConnection(null);
  if (!connection?.textModel) return { kind: "agent_eval", outcome: "skipped", detail: "Kaizena Flow's AI has no text model." };
  const result = await runAgentEval({ ...connection, usage: { storeId: null, feature: "ai_test", accountId: requestedBy } }, { id: requestedBy as string });
  return {
    kind: "agent_eval",
    outcome: result.ok ? "passed" : "failed",
    detail: `${result.passed} of ${result.total} cases passed on ${result.model}${result.failures.length ? `; failed: ${result.failures.map((f) => f.id).join(", ")}` : ""}.`,
  };
}

const PILOT_TURN_MS = 60_000;

/** The run's product as the database has it: its status and its current prices in minor units (the admin's own read, every price). */
async function pilotProduct(storeId: string, name: string): Promise<(PilotProduct & { id: string }) | null> {
  const rows = await typedRows(
    z.object({ id: col.uuid, status: col.text, prices: z.array(z.coerce.number()) }),
    sql`
      select p.id, p.status,
        coalesce((select array_agg(k.amount_minor::int) from commerce.kept_prices k join commerce.product_variants v on v.id = k.variant_id
          where k.store_id = p.store_id and v.product_id = p.id), '{}') as prices
      from commerce.products p
      where p.store_id = ${storeId}::uuid and exists (select 1 from commerce.product_translations t where t.product_id = p.id and t.title = ${name})
      order by p.created_at desc limit 1
    `,
  );
  return rows[0] ?? null;
}

/**
 * The AI manager's pilot (consolidation 5): the requesting owner's tasks of `PILOT_TASKS`, each a real turn of the AI manager in one conversation of
 * theirs (in their name, with their role read again as a follow-up's is), each checked by code from the turn and the database (`pilotProblems()`).
 * Publishing is kept for a yes and declined here; the run's product is archived at the end, so the store keeps nothing on its site.
 */
async function pilotDrill(storeId: string, requestedBy: string | null): Promise<DrillResult> {
  if (!requestedBy) return { kind: "manager_pilot", outcome: "skipped", detail: "The pilot runs in an owner's name, and none asked for it." };
  const [store] = await typedRows(z.object({ slug: col.text }), sql`select slug from commerce.stores where id = ${storeId}::uuid`);
  const member = store ? await passMembership(store.slug, requestedBy) : null;
  if (!member || !memberCan(member, "owner")) return { kind: "manager_pilot", outcome: "skipped", detail: "The one who asked is not an owner of this store." };
  const principal: Principal = { account: member.account, store: member.store, role: member.role, kind: member.kind, permissions: member.permissions };
  const name = `Pilot drill mug ${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
  let conversationId: string | null = null;
  const failed: string[] = [];
  let productId: string | null = null;
  let ended = "";
  for (const task of PILOT_TASKS) {
    const turn: PilotTurn = { answer: "", error: null, tools: [], kept: [], refused: [] };
    const approvals: string[] = [];
    await runTurn({
      member: principal,
      conversationId,
      message: task.says.replace("{name}", name),
      emit: (event) => {
        if (event.type === "conversation") conversationId = event.id;
        if (event.type === "round") turn.tools.push(...event.tools);
        if (event.type === "approval") {
          turn.kept.push(event.approval.tool);
          approvals.push(event.approval.id);
        }
        if (event.type === "error") turn.error = event.message;
        if (event.type === "done") {
          turn.answer = event.message.content;
          turn.refused.push(...event.message.tools.filter((tool) => !tool.ok).map((tool) => tool.name));
        }
      },
      invalidate: refreshTag,
      signal: AbortSignal.timeout(PILOT_TURN_MS),
    });
    const product = await pilotProduct(storeId, name);
    productId = product?.id ?? productId;
    const problems = pilotProblems(task.key, turn, product);
    if (task.key === "publish") ended = publishOutcome(turn);
    if (problems.length > 0) failed.push(`${task.key}: ${problems.join("; ")}`);
    // Nothing the pilot kept is ever made: each waiting change is declined, as the owner's No would.
    for (const id of approvals) await decideApproval(principal, id, false, refreshTag);
  }
  if (productId) await setArchived(member.store, productId, true, member.account);
  return failed.length === 0
    ? { kind: "manager_pilot", outcome: "passed", detail: `${PILOT_TASKS.length} of ${PILOT_TASKS.length} tasks done as asked (${ended}); the product was archived after.` }
    : { kind: "manager_pilot", outcome: "failed", detail: `${PILOT_TASKS.length - failed.length} of ${PILOT_TASKS.length} tasks passed. ${failed.join(" | ")}`.slice(0, 1500) };
}

async function runOne(storeId: string, kind: DrillKind, requestedBy: string | null): Promise<DrillResult> {
  try {
    if (kind === "agent_eval") return await evalDrill(requestedBy);
    if (kind === "manager_pilot") return await pilotDrill(storeId, requestedBy);
    if (kind === "database_door") return await doorDrill();
    if (kind === "webhooks") return await webhooksDrill();
    if (kind === "payment_facts") return await factsDrill(storeId);
    if (kind === "mark_sent") return await sentDrill(storeId);
    return await refundDrill(storeId, kind);
  } catch (error) {
    log("error", "live_drill.failed", { kind }, error);
    return { kind, outcome: "failed", detail: `${DRILL_WORDS[kind]}: the drill stopped with an error.` };
  }
}

/** The five-minute dispatcher's part: one requested run, claimed under a lock, each drill in order, the results kept. Returns how many drills ran. */
export async function runLiveDrills(): Promise<number> {
  const [claimed] = await typedRows(
    z.object({ id: col.uuid, store_id: col.uuid, requested_by: col.uuid.nullable(), kinds: z.array(z.string()) }),
    sql`
      update commerce.live_drills set status = 'running', started_at = now()
      where id = (select id from commerce.live_drills where status = 'requested' order by requested_at limit 1 for update skip locked)
      returning id, store_id, requested_by, kinds
    `,
  );
  if (!claimed) return 0;
  const results: DrillResult[] = [];
  if (!(await inTestMode(claimed.store_id))) {
    results.push(...drillPlan(claimed.kinds).map((kind) => ({ kind, outcome: "skipped" as const, detail: "The store's checkout is not in test mode." })));
  } else {
    for (const kind of drillPlan(claimed.kinds)) results.push(await runOne(claimed.store_id, kind, claimed.requested_by));
  }
  await db().execute(sql`
    update commerce.live_drills set status = 'done', finished_at = now(), results = ${JSON.stringify(results)}::jsonb where id = ${claimed.id}::uuid
  `);
  log("info", "live_drill.done", { drills: results.length, failed: results.filter((r) => r.outcome === "failed").length });
  return results.length;
}
