import "server-only";

import { sql } from "drizzle-orm";
import webpush from "web-push";

import { db } from "@/db/client";
import { adminLangOf, ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { vapidEnv } from "@/lib/env";
import { formatMoney } from "@/lib/money";
import { newOrderPush, PUSH_DEVICES_MAX, pushSubscriptionInput } from "@/lib/push";
import { siteUrl } from "@/lib/site";

import { passMembership, type Membership } from "./auth";
import { log } from "./log";
import { memberCan } from "./permissions";

type Row = Record<string, unknown>;

/**
 * Web Push to staff devices (wave 9 unit H, D361, `docs/wave-9-platform.md` section 3, H): the only writer of
 * `commerce.push_subscriptions`. A person turns notifications on per device and store on Your account (only for a store whose orders their
 * role may read); a paid order (the staff alert event `order.paid`, after its emails) is sent to each device of the store by
 * `sendOrderPush()`, its number and total only, through the browsers' own push services with the VAPID keys of `vapidEnv()`. A device the
 * push service says is gone (404, 410) is removed, as is one whose person no longer reads the store's orders. Never throws to its callers.
 */

/** Sends at most this many seconds after an order is paid are still worth a ring. */
const TTL_SECONDS = 6 * 3600;
/** A device that failed this many sends in a row (other than gone) is removed. */
const FAILURES_MAX = 5;

/** The public key the browser subscribes with, or null when notifications are not set up. */
export function pushPublicKey(): string | null {
  try {
    return vapidEnv()?.publicKey ?? null;
  } catch (error) {
    log("error", "push.keys_invalid", {}, error);
    return null;
  }
}

/** Keeps this device's subscription for the store (a person with `orders:read` only), replacing what the endpoint had for it. */
export async function savePushSubscription(member: Membership, input: unknown): Promise<{ ok: true } | { ok: false; problem: "invalid" | "access" | "full" | "off" }> {
  if (!pushPublicKey()) return { ok: false, problem: "off" };
  if (!memberCan(member, "orders:read")) return { ok: false, problem: "access" };
  const parsed = pushSubscriptionInput.safeParse(input);
  if (!parsed.success) return { ok: false, problem: "invalid" };
  const [count] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.push_subscriptions
    where account_id = ${member.account.id}::uuid and store_id = ${member.store.id}::uuid and endpoint <> ${parsed.data.endpoint}
  `);
  if (Number(count?.n ?? 0) >= PUSH_DEVICES_MAX) return { ok: false, problem: "full" };
  await db().execute(sql`
    insert into commerce.push_subscriptions (account_id, store_id, endpoint, p256dh, auth, device)
    values (${member.account.id}::uuid, ${member.store.id}::uuid, ${parsed.data.endpoint}, ${parsed.data.keys.p256dh}, ${parsed.data.keys.auth}, ${parsed.data.device})
    on conflict (endpoint, store_id) do update
      set account_id = excluded.account_id, p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device, failures = 0
  `);
  log("info", "push.subscribed", { storeId: member.store.id });
  return { ok: true };
}

/** Removes a device of the person's: by its endpoint for one store, or for every store. */
export async function removePushSubscription(accountId: string, endpoint: string, storeId: string | null = null): Promise<number> {
  const gone = await db().execute<Row>(sql`
    delete from commerce.push_subscriptions
    where account_id = ${accountId}::uuid and endpoint = ${endpoint} and (${storeId}::uuid is null or store_id = ${storeId}::uuid)
    returning id
  `);
  return gone.length;
}

/** Removes one of the person's devices by its id (the list on Your account). */
export async function removePushDevice(accountId: string, id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const gone = await db().execute<Row>(sql`delete from commerce.push_subscriptions where id = ${id}::uuid and account_id = ${accountId}::uuid returning id`);
  return gone.length > 0;
}

export type PushDevice = { id: string; storeId: string; storeName: string; device: string; endpoint: string; createdAt: string };

/** The person's devices, per store, for Your account (the endpoint only to tell which is this device, in the person's own browser). */
export async function pushDevicesOf(accountId: string): Promise<PushDevice[]> {
  const rows = await db().execute<Row>(sql`
    select p.id, p.store_id, s.name as store_name, p.device, p.endpoint, p.created_at
    from commerce.push_subscriptions p join commerce.stores s on s.id = p.store_id
    where p.account_id = ${accountId}::uuid order by s.name, p.created_at
  `);
  return rows.map((r) => ({
    id: String(r.id),
    storeId: String(r.store_id),
    storeName: String(r.store_name),
    device: String(r.device),
    endpoint: String(r.endpoint),
    createdAt: new Date(String(r.created_at)).toISOString(),
  }));
}

type Sender = (subscription: webpush.PushSubscription, payload: string, options: webpush.RequestOptions) => Promise<{ statusCode: number }>;
const realSender: Sender = (subscription, payload, options) => webpush.sendNotification(subscription, payload, options);

/**
 * A paid order's notification to every device of the store whose person still reads its orders, in each person's language. Returns how
 * many were sent; a device gone is removed, one whose person no longer may is removed. Never throws.
 */
export async function sendOrderPush(storeId: string, orderId: string, send: Sender = realSender): Promise<number> {
  const keys = (() => {
    try {
      return vapidEnv();
    } catch {
      return null;
    }
  })();
  if (!keys) return 0;
  let sent = 0;
  try {
    const subscriptions = await db().execute<Row>(sql`
      select p.id, p.account_id, p.endpoint, p.p256dh, p.auth, p.failures, s.slug, s.name, a.admin_locale
      from commerce.push_subscriptions p
      join commerce.stores s on s.id = p.store_id
      join commerce.accounts a on a.id = p.account_id
      where p.store_id = ${storeId}::uuid
    `);
    if (subscriptions.length === 0) return 0;
    const [order] = await db().execute<Row>(sql`
      select number, total_minor, currency from commerce.orders
      where store_id = ${storeId}::uuid and id = ${orderId}::uuid and copied_from is null and status in ('paid', 'fulfilled')
    `);
    if (!order) return 0;
    const allowed = new Map<string, boolean>();
    for (const sub of subscriptions) {
      const accountId = String(sub.account_id);
      if (!allowed.has(accountId)) {
        const member = await passMembership(String(sub.slug), accountId);
        allowed.set(accountId, Boolean(member && memberCan(member, "orders:read")));
      }
      if (!allowed.get(accountId)) {
        await db().execute(sql`delete from commerce.push_subscriptions where id = ${sub.id}::uuid`);
        continue;
      }
      const lang = adminLangOf(sub.admin_locale as string | null);
      const words = adminText(lang, "staffEmails").push;
      const payload = newOrderPush(
        {
          number: String(order.number),
          total: formatMoney(Number(order.total_minor), String(order.currency), ADMIN_LANG_FACTS[lang].locale),
          store: String(sub.name),
          url: `${siteUrl()}/admin/${String(sub.slug)}/orders/${orderId}`,
        },
        { title: words.newOrderTitle, body: words.newOrderBody },
      );
      try {
        await send(
          { endpoint: String(sub.endpoint), keys: { p256dh: String(sub.p256dh), auth: String(sub.auth) } },
          JSON.stringify(payload),
          { vapidDetails: keys, TTL: TTL_SECONDS, timeout: 5000, urgency: "normal", topic: `o${orderId.replaceAll("-", "").slice(0, 30)}` },
        );
        await db().execute(sql`update commerce.push_subscriptions set failures = 0, last_sent_at = now() where id = ${sub.id}::uuid`);
        sent++;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410 || Number(sub.failures) + 1 >= FAILURES_MAX) {
          await db().execute(sql`delete from commerce.push_subscriptions where id = ${sub.id}::uuid`);
          log("info", "push.removed", { storeId, status: status ?? 0 });
        } else {
          await db().execute(sql`update commerce.push_subscriptions set failures = failures + 1 where id = ${sub.id}::uuid`);
          log("warn", "push.failed", { storeId, status: status ?? 0 });
        }
      }
    }
  } catch (error) {
    log("error", "push.send_failed", { storeId }, error);
  }
  return sent;
}
