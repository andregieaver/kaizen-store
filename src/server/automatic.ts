import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import type { AutomaticOverview } from "@/lib/automatic";
import { AUTOMATION_KINDS, type AutomationKind } from "@/lib/automation-kinds";
import { featureOn, type FeatureSource } from "@/lib/store-features";
import { STAFF_ALERT_EVENTS, type StaffAlertEvent } from "@/lib/staff-alerts";

import { listRules } from "./order-rules";
import { textList } from "./sql-arrays";
import { ALERT_EMAIL_KINDS, staffAlertsView } from "./staff-alerts";
import { col, typedRow, typedRows } from "./typed-rows";
import { listEndpoints } from "./webhook-endpoints";
import { listWorkflows } from "./workflows";

/**
 * Everything in a store that runs by itself, read for Settings → Automatic (ecosystem plan E3.3, D718; the page and its pure parts are
 * `src/lib/automatic.ts`): workflows, the order rules not moved yet, email automations, cart reminders, review requests, staff emails and
 * devices, the owner's endpoints and services, and the autopilot's reacting, each with when it last did something. Reads only, each by its
 * store; the last emails are looked for in the last 30 days (`email_messages` by the store and its time), so a busy store's page stays quick.
 */

const CONFIRMATION = "order.confirmation";
const RECENT = sql`now() - interval '30 days'`;

const lastAt = col.timestampOrNull;

export async function automaticOverview(store: { id: string } & FeatureSource): Promise<AutomaticOverview> {
  const shop = featureOn(store, "shop");
  const reviews = featureOn(store, "reviews");
  const mailKinds = [CONFIRMATION, ...Object.values(ALERT_EMAIL_KINDS)];
  const [workflows, rules, automations, carts, review, alerts, emails, push, endpoints, integrations, autopilot] = await Promise.all([
    listWorkflows(store.id),
    shop ? listRules(store.id) : Promise.resolve([] as Awaited<ReturnType<typeof listRules>>),
    typedRows(
      z.object({ kind: z.enum(AUTOMATION_KINDS), enabled: col.bool, last_at: lastAt }),
      sql`
        select a.kind, a.enabled,
          case when a.kind = 'back_in_stock'
            then (select max(q.notified_at) from commerce.stock_requests q where q.store_id = a.store_id)
            else (select max(s.created_at) from commerce.automation_sends s where s.store_id = a.store_id and s.kind = a.kind and s.outcome in ('sent', 'logged'))
          end as last_at
        from commerce.automations a where a.store_id = ${store.id}::uuid
      `,
    ),
    typedRow(
      z.object({ enabled: col.bool, steps: col.int, last_at: lastAt }),
      sql`
        select s.cart_reminders as enabled,
          (select count(*)::int from commerce.cart_reminder_steps r where r.store_id = s.id and r.active) as steps,
          (select max(c.last_reminder_at) from commerce.abandoned_checkouts c where c.store_id = s.id) as last_at
        from commerce.stores s where s.id = ${store.id}::uuid
      `,
    ),
    reviews
      ? typedRow(
          z.object({ enabled: col.bool, days: col.int.nullable(), last_at: lastAt }),
          sql`
            select coalesce(rs.requests_on, false) as enabled, rs.request_days as days,
              (select max(q.created_at) from commerce.review_requests q where q.store_id = s.id) as last_at
            from commerce.stores s left join commerce.review_settings rs on rs.store_id = s.id where s.id = ${store.id}::uuid
          `,
        )
      : Promise.resolve(null),
    staffAlertsView(store.id),
    typedRows(
      z.object({ kind: col.text, last_at: col.timestamp }),
      sql`
        select kind, max(created_at) as last_at from commerce.email_messages
        where store_id = ${store.id}::uuid and created_at > ${RECENT} and kind = any(${textList(mailKinds)})
        group by kind
      `,
    ),
    typedRow(
      z.object({ devices: col.int, last_at: lastAt }),
      sql`select count(*)::int as devices, max(last_sent_at) as last_at from commerce.push_subscriptions where store_id = ${store.id}::uuid`,
    ),
    listEndpoints(store.id),
    typedRows(
      z.object({ provider: z.enum(["zapier", "make", "slack"]), enabled: col.bool, events: z.array(z.string()), last_at: lastAt }),
      sql`
        select i.provider, i.enabled, i.events,
          (select d.delivered_at from commerce.integration_deliveries d
            where d.store_id = i.store_id and d.provider = i.provider and d.status = 'delivered' order by d.created_at desc limit 1) as last_at
        from commerce.store_integrations i where i.store_id = ${store.id}::uuid order by i.provider
      `,
    ),
    typedRow(
      z.object({ reacts: col.bool, paused: col.bool, last_at: lastAt }),
      sql`
        select coalesce((a.planning ->> 'reacts')::boolean, false) as reacts, a.paused,
          (select max(e.created_at) from commerce.autopilot_events e where e.store_id = a.store_id) as last_at
        from commerce.autopilot_settings a where a.store_id = ${store.id}::uuid
      `,
    ),
  ]);
  const sentAt = new Map(emails.map((e) => [e.kind, e.last_at]));
  const recipients = (event: StaffAlertEvent) =>
    alerts.members.filter((m) => m.events.includes(event)).length + (alerts.contact?.events.includes(event) ? 1 : 0);
  const saved = new Map(automations.map((a) => [a.kind, a]));
  return {
    shop,
    workflows: workflows.map((w) => ({
      id: w.id,
      name: w.name,
      trigger: w.trigger,
      enabled: w.enabled,
      schedule: w.schedule ? { every: w.schedule.every, at: w.schedule.at } : null,
      conditions: w.conditions.length,
      actions: w.actions.map((a) => a.kind),
      lastRunAt: w.lastRun?.at ?? null,
      runsLastDay: w.runsLastDay,
    })),
    rules: rules.map((r) => ({ id: r.id, name: r.name, enabled: r.enabled, lastRunAt: r.lastRun?.at ?? null, conditions: r.conditions.length, actions: r.actions.map((a) => a.kind) })),
    emailAutomations: AUTOMATION_KINDS.filter((kind) => kind !== "back_in_stock" || shop).map((kind: AutomationKind) => ({
      kind,
      enabled: saved.get(kind)?.enabled ?? false,
      lastSentAt: saved.get(kind)?.last_at ?? null,
    })),
    cartReminders: { enabled: carts?.enabled ?? false, activeSteps: carts?.steps ?? 0, lastSentAt: carts?.last_at ?? null },
    reviewRequests: review ? { enabled: review.enabled, days: review.days ?? 14, lastSentAt: review.last_at } : null,
    staffAlerts: STAFF_ALERT_EVENTS.filter((event) => shop || !ORDER_ALERTS.has(event)).map((event) => ({
      event,
      recipients: recipients(event),
      lastSentAt: sentAt.get(ALERT_EMAIL_KINDS[event]) ?? null,
    })),
    summary: alerts.summary,
    push: { devices: shop ? (push?.devices ?? 0) : 0, lastSentAt: push?.last_at ?? null },
    endpoints: endpoints.map((e) => ({
      id: e.id,
      name: e.name,
      enabled: e.enabled,
      topics: e.topics,
      lastAt: e.lastDelivery?.status === "delivered" ? e.lastDelivery.at : null,
      failing: e.failingSince !== null,
    })),
    integrations: integrations.map((i) => ({ provider: i.provider, enabled: i.enabled, events: i.events, lastAt: i.last_at })),
    autopilot: autopilot ? { reacts: autopilot.reacts, paused: autopilot.paused, lastAt: autopilot.last_at } : null,
    confirmationLastAt: sentAt.get(CONFIRMATION) ?? null,
  };
}

/** The staff emails about orders, returns and stock: the online shop's (a website without it sends none of them). */
const ORDER_ALERTS: ReadonlySet<StaffAlertEvent> = new Set(["new_order", "return_requested", "refund_overdue", "low_stock", "automation", "dispute", "payment_overdue"]);

