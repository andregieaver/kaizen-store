import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { mainCurrency } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { NOTIFICATION_IDS } from "@/lib/notifications";
import { deliveredByWords, outcomeWords, RULE_RUNS_MAX, shapeNotification, shapeParcel, shapeRule } from "@/lib/notification-tools";
import { describeRule, type DescribeContext } from "@/lib/order-rules";
import type { OwnerToolInput } from "@/lib/owner-tools";

import { listProductChoices } from "./discounts";
import { listNotifications } from "./notifications";
import { OwnerToolError } from "./owner-tool-error";
import { listRules, ruleLog } from "./order-rules";
import { parcelTrackingFor } from "./shipment-tracking";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * The AI manager's notification tools (wave 3, D238, `docs/wave-3-notifications.md` 5.5), read-only and ungated. Each answers from the readers the
 * admin pages use: `listNotifications()` (the Notifications page; the switches and which slots a language has, never the words), `listRules()` and
 * `ruleLog()` (the Automation pages; the sentence by `describeRule()` with amounts by `formatMoney()` in the store's main currency) and
 * `parcelTrackingFor()` (the stored tracking of an order's parcels; no carrier call). Nothing here switches, edits, holds or asks a carrier. Every query
 * names the store.
 */

type Ctx = { store: Store };

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const UUID = /^[0-9a-f-]{36}$/i;

/** `notification_settings`: the Notifications page in words. */
export async function notificationSettingsTool({ store }: Ctx, { notification }: OwnerToolInput<"notification_settings">) {
  if (notification && !NOTIFICATION_IDS.includes(notification)) {
    return fail(`There is no customer email ${notification}. The emails are: ${NOTIFICATION_IDS.join(", ")}.`);
  }
  const list = await listNotifications(store.id);
  const rows = list.filter((n) => !notification || n.def.id === notification);
  return {
    emails: rows.map(shapeNotification),
    ...(notification ? {} : { off: rows.filter((n) => n.status === "off").map((n) => n.def.label) }),
    how: "Switching an email off stops it being sent on its own and unticks Notify the customer where staff send, refund or cancel; a person can still send it from the order. The words are edited per language on each email's page, with a preview and a test email; an empty field means the standard text.",
    page: `/admin/${store.slug}/settings/notifications`,
  };
}

/** The words of a rule's sentence, as the Automation pages write them: the main currency, English country names, the store's product titles. */
async function describeContext(store: Store): Promise<DescribeContext> {
  const currency = mainCurrency(store);
  const products = await listProductChoices(store.id, store.markets[0]?.ownLocale ?? "en-GB");
  const names = new Map(products.map((p) => [p.id, p.title]));
  const countryName = (code: string) => {
    try {
      return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
    } catch {
      return code;
    }
  };
  return { money: (minor) => formatMoney(minor, currency, "en-GB"), countryName, productName: (id) => names.get(id) ?? "a product no longer sold" };
}

/** `order_rules`: the Automation page and its log in words. */
export async function orderRulesTool({ store }: Ctx, { rule, runs, matched }: OwnerToolInput<"order_rules">) {
  const [rules, describe] = await Promise.all([listRules(store.id), describeContext(store)]);
  let chosen = rules;
  if (rule) {
    const wanted = rule.toLowerCase();
    chosen = rules.filter((r) => (UUID.test(rule) ? r.id === rule : r.name.toLowerCase() === wanted));
    if (chosen.length === 0) return fail(`No rule "${rule}" in this store. Its rules are: ${rules.map((r) => r.name).join(", ") || "none yet"}.`);
  }
  const log = runs > 0 ? await ruleLog(store.id, { ruleId: chosen.length === 1 && rule ? chosen[0].id : null, matched: matched ?? null, limit: Math.min(runs, RULE_RUNS_MAX) }) : [];
  return {
    rules: chosen.map((r) => shapeRule(r, describeRule(r, describe))),
    ...(rules.length === 0 ? { note: "The store has no automation rules." } : {}),
    latest_runs: log.map((run) => ({
      at: run.at,
      rule: run.ruleName,
      rule_version: run.ruleVersion,
      order: run.orderNumber ?? "an order that is gone",
      matched: run.matched,
      ...outcomeWords(run.outcome, run.matched),
    })),
    how: "Rules run once when an order is paid, in their order, each on the order as it was when paid (a tag one rule adds does not make another match). A rule switched off is skipped. An order on hold cannot be sent or handed over until it is released on its page.",
    page: `/admin/${store.slug}/settings/automation`,
  };
}

/** `parcel_tracking`: an order's parcels from the stored tracking. */
export async function parcelTrackingTool({ store }: Ctx, { order }: OwnerToolInput<"parcel_tracking">) {
  const byId = UUID.test(order);
  const [row] = await db().execute<Row>(sql`
    select id, number, copied_from is not null as copied, delivered_at, delivered_source
    from commerce.orders
    where store_id = ${store.id}::uuid and ${byId ? sql`id = ${order}::uuid` : sql`number = ${order.replace(/^#/, "")}`}
  `);
  if (!row) return fail(`No order ${order} in this store.`);
  if (row.copied) return { order: String(row.number), note: "This order is history copied from another store: its parcels are not followed." };
  const orderId = String(row.id);
  const [tracking, shipments] = await Promise.all([
    parcelTrackingFor(store.id, orderId),
    db().execute<Row>(sql`
      select id, carrier, tracking_number, created_at from commerce.shipments
      where store_id = ${store.id}::uuid and order_id = ${orderId}::uuid and method = 'parcel' and undone_at is null
    `),
  ]);
  const byShipment = new Map(shipments.map((s) => [String(s.id), s]));
  const deliveredAt = row.delivered_at ? new Date(String(row.delivered_at)).toISOString() : null;
  return {
    order: String(row.number),
    delivery: deliveredByWords(row.delivered_source ? String(row.delivered_source) : null, deliveredAt),
    ...(deliveredAt ? { delivered_at: deliveredAt } : {}),
    parcels: tracking.map((p) => {
      const s = byShipment.get(p.shipmentId);
      return shapeParcel({
        carrier: s && String(s.carrier) ? String(s.carrier) : null,
        trackingNumber: s && String(s.tracking_number) ? String(s.tracking_number) : null,
        sentAt: s ? new Date(String(s.created_at)).toISOString() : "",
        followed: p.followed,
        phase: p.phase,
        phaseVerified: p.phaseVerified,
        events: p.events,
        checkedAt: p.checkedAt,
        lastCheckFailed: p.lastCheckFailed,
        stopped: p.stopped,
        outAt: p.outAt,
        deliveredAt: p.deliveredAt,
      });
    }),
    ...(tracking.length === 0 ? { note: "The order has no parcel sent with a carrier (nothing sent yet, or it is collected or delivered by the store)." } : {}),
    page: `/admin/${store.slug}/orders/${orderId}`,
  };
}
