import { createHash, randomBytes, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { BroadcastContent } from "@/lib/broadcasts";
import { consentCookieName, encodeConsent, FULL_CONSENT, NO_CONSENT } from "@/lib/cookie-consent";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

const au = await import("./automations");
const { recordProductView, pruneProductViews } = await import("./product-views");
const { storeById } = await import("./shopper-emails");

type Row = Record<string, unknown>;

/**
 * Browse abandonment (D4 of `docs/100-day-challenge.md`, D691) on a real store: a product view is kept only for a signed-in customer subscribed to
 * the store's emails who allowed marketing cookies, while the store's browse email is on and the browser sends no Global Privacy Control; the
 * email goes after its days with the products looked at and not bought, once a week at most, never after an order; switching it off deletes the
 * views, and views older than their days are pruned.
 */

const run = Date.now().toString(36);
const DAY = 86_400_000;
let storeId: string;
let owner: string;
let products: { product: string; variant: string; handle: string }[];

const words = (subject: string): BroadcastContent => ({
  "nb-NO": { subject, preview: "", blocks: [{ type: "paragraph", text: `${subject}: hei` }, { type: "button", text: "Se", url: "/" }] },
});

async function store() {
  const s = await storeById(storeId);
  if (!s) throw new Error("no store");
  return s;
}

/** A customer signed in in this "browser" (the cookie jar), and on the list unless `listed` is false. */
async function signedIn(email: string, listed = true): Promise<string> {
  const [c] = await db().execute<Row>(sql`
    insert into commerce.customers (store_id, email, email_verified_at, name) values (${storeId}::uuid, ${email}, now(), 'Kari') returning id
  `);
  const token = randomBytes(32).toString("base64url");
  await db().execute(sql`
    insert into commerce.customer_sessions (store_id, customer_id, token_hash, expires_at, verified_at)
    values (${storeId}::uuid, ${String(c.id)}::uuid, ${createHash("sha256").update(token).digest("hex")}, now() + interval '1 day', now())
  `);
  jar.set(`account_${storeId}`, token);
  if (listed) {
    await db().execute(sql`
      insert into commerce.marketing_subscribers (store_id, email, locale, market_code, status, source, consent_text, consented_at, token)
      values (${storeId}::uuid, ${email}, 'nb-NO', 'NO', 'subscribed', 'account', 'Yes please', now() - interval '60 days', ${randomBytes(32).toString("base64url")})
    `);
  }
  return String(c.id);
}

const consent = (marketing: boolean) =>
  jar.set(consentCookieName(storeId), encodeConsent({ visitor: randomUUID(), version: "marketing", choices: marketing ? FULL_CONSENT : NO_CONSENT }));

const viewsOf = (customer: string) =>
  db().execute<Row>(sql`select product_id from commerce.customer_product_views where store_id = ${storeId}::uuid and customer_id = ${customer}::uuid order by viewed_at`);

const sends = () =>
  db().execute<Row>(sql`select key, outcome from commerce.automation_sends where store_id = ${storeId}::uuid and kind = 'browse' order by created_at`);

const htmlOf = async (key: string) => {
  const [row] = await db().execute<Row>(sql`select html from commerce.email_messages where idempotency_key = ${`automation:${storeId}:${key}`}`);
  return String(row?.html ?? "");
};

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`br-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`br-${run}`}, 'Test', null) as id`);
  storeId = String(created.id);
  // These tests are about what is sent, not how often or when: the contact policy (D764) is held by contact-policy.int.test.ts.
  for (const id of [storeId]) {
    await db().execute(sql`insert into commerce.contact_policies (store_id, per_week, spacing_hours, quiet_hours) values (${id}::uuid, 14, 0, false)`);
  }
  await db().execute(sql`update commerce.stores set status = 'active', locales = array['nb-NO', 'en-GB'] where id = ${storeId}::uuid`);
  const [m] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${storeId}::uuid limit 1`);
  owner = String(m.account_id);
  const rows = await db().execute<Row>(sql`
    select distinct on (p.id) p.id as product, v.id as variant, p.handle from commerce.products p
    join commerce.product_variants v on v.store_id = p.store_id and v.product_id = p.id and v.active and v.delivery = 'physical'
    where p.store_id = ${storeId}::uuid and p.status = 'active' and p.kind = 'goods' and p.audience = 'all' and not p.subscription_only
      and exists (select 1 from commerce.inventory_levels l where l.store_id = v.store_id and l.variant_id = v.id)
    order by p.id, v.id limit 3
  `);
  products = rows.map((r) => ({ product: String(r.product), variant: String(r.variant), handle: String(r.handle) }));
  if (products.length < 3) throw new Error("the demo store needs three goods");
  for (const p of products) await db().execute(sql`update commerce.inventory_levels set on_hand = 50 where store_id = ${storeId}::uuid and variant_id = ${p.variant}::uuid`);
  delete process.env.RESEND_API_KEY;
}, 60_000);

beforeEach(() => jar.clear());

afterAll(async () => {
  await closeDb();
});

describe("product views (D691)", () => {
  it("are kept only for a signed-in subscriber who allowed marketing cookies, while the browse email is on, and never with GPC", async () => {
    const none = new Headers();
    const kari = await signedIn(`kari-${run}@example.com`);
    consent(true);
    // Off: nothing is kept for an email that will not go.
    expect(await recordProductView(storeId, products[0].product, none)).toBe(false);
    const saved = await au.saveAutomation(await store(), owner, "browse", { delayDays: 1, content: words("browse") });
    expect(saved.ok).toBe(true);
    expect((await au.switchAutomation(await store(), owner, "browse", true)).ok).toBe(true);

    expect(await recordProductView(storeId, products[0].product, new Headers({ "sec-gpc": "1" }))).toBe(false);
    expect(await recordProductView(storeId, "not-a-product", none)).toBe(false);
    expect(await recordProductView(storeId, products[0].product, none)).toBe(true);
    expect((await viewsOf(kari)).map((r) => r.product_id)).toEqual([products[0].product]);

    consent(false);
    expect(await recordProductView(storeId, products[1].product, none)).toBe(false);

    jar.clear();
    const notListed = await signedIn(`ola-${run}@example.com`, false);
    consent(true);
    expect(await recordProductView(storeId, products[1].product, none)).toBe(false);
    expect(await viewsOf(notListed)).toHaveLength(0);

    jar.clear();
    consent(true);
    expect(await recordProductView(storeId, products[1].product, none)).toBe(false);
  });

  it("email what was looked at and not bought, once, after the days; and switching off deletes the views", async () => {
    const email = `anne-${run}@example.com`;
    const anne = await signedIn(email);
    consent(true);
    const later = new Date(Date.now() + 1000);
    expect(await recordProductView(storeId, products[1].product, new Headers())).toBe(true);
    expect(await recordProductView(storeId, products[2].product, new Headers())).toBe(true);
    expect(await viewsOf(anne)).toHaveLength(2);

    // Within the day nothing goes; after it, one email with the products looked at.
    const [sub] = await db().execute<Row>(sql`select id from commerce.marketing_subscribers where store_id = ${storeId}::uuid and email = ${email}`);
    const hers = async () => (await sends()).filter((s) => String(s.key).startsWith(`browse:${String(sub.id)}:`));
    await au.runAutomations({ only: storeId, now: new Date(later.getTime() + 3_600_000) });
    expect(await hers()).toHaveLength(0);
    await au.runAutomations({ only: storeId, now: new Date(later.getTime() + DAY + 60_000) });
    const [first] = await hers();
    expect(first.outcome).toBe("logged");
    const html = await htmlOf(String(first.key));
    expect(html).toContain(`/p/${products[1].handle}`);
    expect(html).toContain(`/p/${products[2].handle}`);
    // Once a week at most.
    await au.runAutomations({ only: storeId, now: new Date(later.getTime() + DAY + 120_000) });
    expect(await hers()).toHaveLength(1);

    // Views older than their days go; switching it off deletes the rest at once.
    expect(await pruneProductViews(new Date(Date.now() + 8 * DAY))).toBeGreaterThanOrEqual(2);
    expect(await recordProductView(storeId, products[1].product, new Headers())).toBe(true);
    expect((await au.switchAutomation(await store(), owner, "browse", false)).ok).toBe(true);
    expect(await viewsOf(anne)).toHaveLength(0);
  });
});
