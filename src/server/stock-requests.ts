import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  STOCK_CONFIRM_DAYS,
  STOCK_ENDED_DAYS,
  STOCK_PENDING_MAX,
  STOCK_VISITOR_DAY,
  STOCK_WAITING_DAYS,
} from "@/lib/automations";
import { renderEmail } from "@/lib/email-layout";
import { emailText } from "@/lib/email-text";
import { optionLabel, t } from "@/lib/i18n";
import { TOKEN_PATTERN } from "@/lib/marketing-consent";
import { marketUrl } from "@/lib/paths";
import { isRequestAddress } from "@/lib/stock-request-check";

import { emailMarket, priceLines } from "./broadcast-facts";
import { getProduct } from "./catalog";
import { sendEmail, type SendOutcome } from "./email";
import { log } from "./log";
import { marketSlugFor } from "./marketing-email";
import { OFFERED } from "./product-conditions";
import { emailFooter, storeById, type EmailStore } from "./shopper-emails";
import { normaliseEmail } from "@/lib/email-address";

type Row = Record<string, unknown>;

/**
 * Back in stock (wave 5 unit D, D298, `docs/wave-5-marketing.md` 6.4 and 6.5): the only writer of `commerce.stock_requests`. A shopper asks to hear
 * once when a sold-out variant is back; a typed address confirms it from its link first, a signed-in customer with a verified email waits at once.
 * When the variant is in stock again, every waiting address gets one email. A request never subscribes anyone to marketing.
 */

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

/** A key for a visitor that changes every day, never their address (as forms', D93). */
export function stockVisitor(address: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return createHash("sha256").update(`${address}|${day}|kaizen-stock`).digest("hex").slice(0, 32);
}

export type StockAsk = {
  storeId: string;
  marketCode: string;
  locale: string;
  variantId: string;
  email: string;
  visitor: string;
  /** The signed-in customer, if any; only their own verified address waits at once. */
  customerId: string | null;
};

/** `waiting`: it is kept and will be told; `check`: an email went (or would have) to confirm; the rest refuse without saying why the address matters. */
export type StockAnswer = "waiting" | "check" | "busy" | "invalid" | "unavailable";

/** The variant may be asked for: the store has back in stock on and is a real open store, the product is offered and the variant sold out. */
async function askable(storeId: string, variantId: string): Promise<{ productId: string } | null> {
  const [row] = await db().execute<Row>(sql`
    select v.product_id
    from commerce.product_variants v
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
    join commerce.stores s on s.id = v.store_id
    join commerce.variant_availability va on va.store_id = v.store_id and va.variant_id = v.id
    join commerce.automations a on a.store_id = v.store_id and a.kind = 'back_in_stock' and a.enabled
    where v.store_id = ${storeId}::uuid and v.id = ${variantId}::uuid and v.active and v.delivery = 'physical' and v.stock_policy = 'deny'
      and p.status = 'active' and ${OFFERED} and va.in_stock = 0
      and commerce.store_is_active(v.store_id) and not (s.is_template or s.starter)
  `);
  return row ? { productId: String(row.product_id) } : null;
}

/** Whether a store offers the request at all (the product page asks before drawing the form): on, and a real open store, as `askable()` asks. */
export async function backInStockOn(storeId: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select 1 from commerce.automations a join commerce.stores s on s.id = a.store_id
    where a.store_id = ${storeId}::uuid and a.kind = 'back_in_stock' and a.enabled
      and commerce.store_is_active(a.store_id) and not (s.is_template or s.starter)
  `);
  return Boolean(row);
}

/** A shopper's request (6.4). Never says whether the address was known. */
export async function requestStock(ask: StockAsk): Promise<StockAnswer> {
  const email = normaliseEmail(ask.email);
  if (!isRequestAddress(email)) return "invalid";
  const variant = await askable(ask.storeId, ask.variantId);
  if (!variant) return "unavailable";

  const [limits] = await db().execute<Row>(sql`
    select
      (select count(*)::int from commerce.stock_requests where store_id = ${ask.storeId}::uuid and visitor = ${ask.visitor}
         and created_at > now() - interval '1 day') as by_visitor,
      (select count(*)::int from commerce.stock_requests where store_id = ${ask.storeId}::uuid and email = ${email} and status = 'pending') as pending
  `);
  // The account proves the address only for a customer asking for their own verified one.
  const [customer] = ask.customerId
    ? await db().execute<Row>(sql`
        select id from commerce.customers
        where store_id = ${ask.storeId}::uuid and id = ${ask.customerId}::uuid and email_verified_at is not null and lower(email) = ${email}
      `)
    : [];
  const proven = Boolean(customer);

  const outcome = await db().transaction(async (tx) => {
    const [open] = await tx.execute<Row>(sql`
      select id, status, confirm_sent_at > now() - interval '1 day' as sent_lately from commerce.stock_requests
      where store_id = ${ask.storeId}::uuid and variant_id = ${ask.variantId}::uuid and email = ${email} and status in ('pending', 'waiting')
      for update
    `);
    if (open?.status === "waiting") return { answer: (proven ? "waiting" : "check") as StockAnswer, send: null };
    if (open && proven) {
      await tx.execute(sql`
        update commerce.stock_requests set status = 'waiting', confirm_hash = null, confirm_until = null, confirmed_at = now(),
          customer_id = ${ask.customerId}::uuid
        where id = ${String(open.id)}::uuid
      `);
      return { answer: "waiting" as StockAnswer, send: null };
    }
    if (open) {
      if (open.sent_lately) return { answer: "check" as StockAnswer, send: null };
      const token = newToken();
      await tx.execute(sql`
        update commerce.stock_requests set confirm_hash = ${hash(token)}, cancel_hash = ${hash(token)}, confirm_until = now() + make_interval(days => ${STOCK_CONFIRM_DAYS}),
          confirm_sent_at = now(), locale = ${ask.locale}, market_code = ${ask.marketCode}
        where id = ${String(open.id)}::uuid
      `);
      return { answer: "check" as StockAnswer, send: { id: String(open.id), token } };
    }
    if (Number(limits?.by_visitor ?? 0) >= STOCK_VISITOR_DAY) return { answer: "busy" as StockAnswer, send: null };
    if (!proven && Number(limits?.pending ?? 0) >= STOCK_PENDING_MAX) return { answer: "busy" as StockAnswer, send: null };
    const token = proven ? null : newToken();
    const [row] = await tx.execute<Row>(sql`
      insert into commerce.stock_requests (
        store_id, variant_id, product_id, email, customer_id, locale, market_code, status, confirm_hash, cancel_hash, confirm_until, confirm_sent_at, visitor, confirmed_at
      ) values (
        ${ask.storeId}::uuid, ${ask.variantId}::uuid, ${variant.productId}::uuid, ${email}, ${proven ? ask.customerId : null}::uuid, ${ask.locale},
        ${ask.marketCode}, ${proven ? "waiting" : "pending"}, ${token ? hash(token) : null}, ${token ? hash(token) : null},
        case when ${token !== null} then now() + make_interval(days => ${STOCK_CONFIRM_DAYS}) end,
        case when ${token !== null} then now() end, ${ask.visitor}, case when ${proven} then now() end
      )
      on conflict do nothing
      returning id
    `);
    if (!row) return { answer: "check" as StockAnswer, send: null };
    return { answer: (proven ? "waiting" : "check") as StockAnswer, send: token ? { id: String(row.id), token } : null };
  });

  if (outcome.send) await sendConfirmation(ask, email, outcome.send.id, outcome.send.token);
  return outcome.answer;
}

/** The product's name in a language (the store's main one, else any), with the variant's options when it has siblings. */
async function namesOf(storeId: string, variantId: string, locale: string): Promise<{ product: string; variant: string; handle: string } | null> {
  const [row] = await db().execute<Row>(sql`
    select p.handle, v.options,
      (select count(*)::int from commerce.product_variants o where o.store_id = v.store_id and o.product_id = v.product_id and o.active) as siblings,
      coalesce(
        (select t.title from commerce.product_translations t where t.store_id = p.store_id and t.product_id = p.id
         order by t.locale = ${locale} desc, t.locale = s.locales[1] desc, t.locale limit 1), p.handle) as title
    from commerce.product_variants v
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
    join commerce.stores s on s.id = v.store_id
    where v.store_id = ${storeId}::uuid and v.id = ${variantId}::uuid
  `);
  if (!row) return null;
  const m = t(locale.slice(0, 2));
  const variant = Number(row.siblings) > 1 ? optionLabel(m, (row.options ?? {}) as Record<string, string>) : "";
  return { product: String(row.title), variant, handle: String(row.handle) };
}

const named = (names: { product: string; variant: string }) => (names.variant ? `${names.product} (${names.variant})` : names.product);

async function sendConfirmation(ask: StockAsk, to: string, requestId: string, token: string): Promise<SendOutcome> {
  const [store, names] = await Promise.all([storeById(ask.storeId), namesOf(ask.storeId, ask.variantId, ask.locale)]);
  if (!store || !names) return "failed";
  const lang = ask.locale.slice(0, 2);
  const m = t(lang);
  const slug = marketSlugFor(store, ask.marketCode);
  const link = `${marketUrl(store.slug, slug, `/account/stock/${token}`)}`;
  const email = renderEmail({
    subject: m.stockNotice.confirmSubject(store.name),
    preview: m.stockNotice.confirmHeading,
    blocks: [
      { type: "heading", text: m.stockNotice.confirmHeading },
      { type: "paragraph", text: m.stockNotice.confirmText(store.name, named(names)) },
      { type: "button", text: m.stockNotice.confirmButton, url: link },
      { type: "paragraph", text: m.stockNotice.confirmValid },
      // The same token stops the request later, while it waits (D392).
      { type: "paragraph", text: m.stockNotice.cancelLine },
      { type: "link", text: m.stockNotice.cancelLink, url: `${link}?cancel=1` },
    ],
    footer: emailFooter(store, emailText(lang)),
    lang,
  });
  return sendEmail({
    storeId: ask.storeId,
    kind: "stock.confirm",
    to,
    email,
    fromName: store.name,
    replyTo: store.details.contactEmail ?? null,
    idempotencyKey: `stock-confirm:${requestId}:${hash(token).slice(0, 16)}`,
  });
}

/** The product a confirmation link is about, while the link is waiting and in time (the page asks before it shows the button). */
export async function stockConfirmWaiting(storeId: string, token: string, locale: string): Promise<string | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const [row] = await db().execute<Row>(sql`
    select variant_id from commerce.stock_requests
    where store_id = ${storeId}::uuid and confirm_hash = ${hash(token)} and status = 'pending' and confirm_until > now()
  `);
  if (!row) return null;
  const names = await namesOf(storeId, String(row.variant_id), locale);
  return names ? named(names) : null;
}

/** The button on the confirmation page: the request waits for stock. */
export async function confirmStockRequest(storeId: string, token: string): Promise<boolean> {
  if (!TOKEN_PATTERN.test(token)) return false;
  const rows = await db().execute<Row>(sql`
    update commerce.stock_requests set status = 'waiting', confirm_hash = null, confirm_until = null, confirmed_at = now()
    where store_id = ${storeId}::uuid and confirm_hash = ${hash(token)} and status = 'pending' and confirm_until > now()
    returning id
  `);
  return rows.length > 0;
}

/** The product a cancel link is about, while its request still waits or waits for confirming (D392). */
export async function stockCancelWaiting(storeId: string, token: string, locale: string): Promise<string | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const [row] = await db().execute<Row>(sql`
    select variant_id from commerce.stock_requests
    where store_id = ${storeId}::uuid and cancel_hash = ${hash(token)} and status in ('pending', 'waiting')
  `);
  if (!row) return null;
  const names = await namesOf(storeId, String(row.variant_id), locale);
  return names ? named(names) : null;
}

/** The cancel page's button (D392): the request stops, and no email about it goes. */
export async function cancelStockRequest(storeId: string, token: string): Promise<boolean> {
  if (!TOKEN_PATTERN.test(token)) return false;
  const rows = await db().execute<Row>(sql`
    update commerce.stock_requests set status = 'cancelled', confirm_hash = null, confirm_until = null, cancel_hash = null
    where store_id = ${storeId}::uuid and cancel_hash = ${hash(token)} and status in ('pending', 'waiting')
    returning id
  `);
  return rows.length > 0;
}

/**
 * A signed-in customer stopping their own request for a variant from the product page (D392): only one made for their own verified address,
 * so a session never stops another person's request. Says nothing about whether one was found.
 */
export async function cancelOwnStockRequest(storeId: string, customerId: string, variantId: string): Promise<void> {
  await db().execute(sql`
    update commerce.stock_requests r set status = 'cancelled', confirm_hash = null, confirm_until = null, cancel_hash = null
      from commerce.customers c
     where r.store_id = ${storeId}::uuid and r.variant_id = ${variantId}::uuid and r.status in ('pending', 'waiting')
       and c.store_id = r.store_id and c.id = ${customerId}::uuid and c.email_verified_at is not null and lower(c.email) = r.email
  `);
}

// ---------------------------------------------------------------------------
// When stock is back (6.5)
// ---------------------------------------------------------------------------

export type BackInStockResult = { sent: number; failed: number };

/** Claims a batch of waiting requests whose variant is in stock again and offered, marking them `sent` before any email goes. */
async function claimBack(only: string | undefined, limit: number): Promise<Row[]> {
  return db().transaction(async (tx) => {
    const rows = await tx.execute<Row>(sql`
      select r.id, r.store_id, r.variant_id, r.email, r.locale, r.market_code, r.created_at, s.time_zone
      from commerce.stock_requests r
      join commerce.product_variants v on v.store_id = r.store_id and v.id = r.variant_id and v.active
      join commerce.products p on p.store_id = r.store_id and p.id = r.product_id and p.status = 'active'
      join commerce.stores s on s.id = r.store_id
      join commerce.automations a on a.store_id = r.store_id and a.kind = 'back_in_stock' and a.enabled
      join commerce.variant_availability va on va.store_id = r.store_id and va.variant_id = r.variant_id
      where r.status = 'waiting' and va.in_stock > 0 and ${OFFERED}
        and commerce.store_is_active(r.store_id) and not (s.is_template or s.starter)
        and (${only ?? null}::uuid is null or r.store_id = ${only ?? null}::uuid)
      order by r.created_at
      limit ${limit}
      for update of r skip locked
    `);
    if (rows.length === 0) return rows;
    await tx.execute(sql`
      update commerce.stock_requests set status = 'sent', notified_at = now()
      where id in (select (jsonb_array_elements_text(${JSON.stringify(rows.map((r) => String(r.id)))}::jsonb))::uuid)
    `);
    return rows;
  });
}

/** Each run: one email to every waiting address whose variant is back. Never throws. */
export async function runBackInStock(options: { only?: string; deadline?: number } = {}): Promise<BackInStockResult> {
  const result: BackInStockResult = { sent: 0, failed: 0 };
  try {
    const stores = new Map<string, EmailStore | null>();
    for (let round = 0; round < 5; round++) {
      if (options.deadline !== undefined && Date.now() > options.deadline) break;
      const rows = await claimBack(options.only, 100);
      for (const row of rows) {
        const storeId = String(row.store_id);
        if (!stores.has(storeId)) stores.set(storeId, await storeById(storeId));
        const store = stores.get(storeId);
        const outcome = store ? await sendBack(store, row) : "failed";
        if (outcome === "sent" || outcome === "logged" || outcome === "duplicate") result.sent++;
        else result.failed++;
      }
      if (rows.length < 100) break;
    }
  } catch (error) {
    log("error", "back_in_stock.run_failed", {}, error);
  }
  return result;
}

async function sendBack(store: EmailStore, row: Row): Promise<SendOutcome> {
  const locale = String(row.locale);
  const names = await namesOf(store.id, String(row.variant_id), locale);
  if (!names) return "failed";
  const lang = locale.slice(0, 2);
  const m = t(lang);
  const slug = marketSlugFor(store, row.market_code ? String(row.market_code) : null);
  const link = `${marketUrl(store.slug, slug, `/p/${names.handle}`)}`;
  const asked = new Date(String(row.created_at)).toLocaleDateString(locale, { dateStyle: "long", timeZone: row.time_zone ? String(row.time_zone) : "UTC" });
  const price = await livePrice(store, row, names.handle, locale);
  const email = renderEmail({
    subject: m.stockNotice.backSubject(names.product, store.name),
    preview: m.stockNotice.backText,
    blocks: [
      { type: "heading", text: m.stockNotice.backHeading(named(names)) },
      { type: "paragraph", text: m.stockNotice.backText },
      ...(price ? [{ type: "paragraph" as const, text: [m.stockNotice.priceNow(price.price), ...price.small].join(" · ") }] : []),
      { type: "button", text: m.stockNotice.backButton, url: link },
      { type: "paragraph", text: m.stockNotice.backReason(asked) },
    ],
    footer: emailFooter(store, emailText(lang)),
    lang,
  });
  return sendEmail({
    storeId: store.id,
    kind: "stock.back_in_stock",
    to: String(row.email),
    email,
    fromName: store.name,
    replyTo: store.details.contactEmail ?? null,
    idempotencyKey: `stock-back:${String(row.id)}`,
  });
}

/**
 * The variant's price as the shopper's market shows it now (D392): the storefront's own read (`getProduct()`) written by `<Price>`'s rules
 * (`priceLines()`), never worked out here. None when the product is not offered there.
 */
async function livePrice(store: EmailStore, row: Row, handle: string, locale: string): Promise<{ price: string; small: string[] } | null> {
  try {
    const market = emailMarket(store, row.market_code ? String(row.market_code) : null, locale);
    if (!market) return null;
    const product = await getProduct(store.id, market, handle);
    const variant = product?.variants.find((v) => v.id === String(row.variant_id));
    return variant ? priceLines({ price: variant.price, priceVaries: false }, market) : null;
  } catch {
    return null;
  }
}

/** Daily (6.5): unconfirmed requests past their link, waiting ones older than 180 days, sent and cancelled ones after 30. */
export async function pruneStockRequests(): Promise<number> {
  const rows = await db().execute<Row>(sql`
    delete from commerce.stock_requests
    where (status = 'pending' and confirm_until < now())
       or (status = 'waiting' and created_at < now() - make_interval(days => ${STOCK_WAITING_DAYS}))
       or (status in ('sent', 'cancelled') and updated_at < now() - make_interval(days => ${STOCK_ENDED_DAYS}))
    returning 1
  `);
  return rows.length;
}
