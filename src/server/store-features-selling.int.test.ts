import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { featureOn } from "@/lib/store-features";

import { makeStore, membershipOf, run } from "./trust-fixtures";

vi.mock("server-only", () => ({}));
// 'use cache' needs Next's cache outside a request: run the functions as they are.
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

const features = await import("./store-features");
const { getStore } = await import("./stores");
const { listProducts, getProduct, listGridProducts } = await import("./catalog");
const { listIndexedProducts } = await import("./seo");
const { appointmentSlots, getAppointmentOffer } = await import("./appointments");
const { getRangeOffer, rangeDates } = await import("./ranges");
const { changeLine, getCart } = await import("./cart");
const { cartSummary } = await import("./cart-summary");
const { getEditorContext, emptyProduct, getProductForEdit, saveProduct, listAdminProducts } = await import("./products");
const { listHostings } = await import("./hosts");
const { saveResource, resourceFeatureOn } = await import("./bookings");
const { calendarForToken } = await import("./calendar-sync");
const { prepareDueDeliveries } = await import("./standing-orders");
const { resolveFeatureShop } = await import("./shop");

type Row = Record<string, unknown>;

/**
 * Store features, step 3 (D178, docs/store-features.md 4c): the Selling group. A new store starts with the shop alone, so its demo
 * appointment, stay and rental are offered nowhere until their feature is on; a product sold only as a subscription and every purchase option
 * wait for Subscriptions; the cart, the editor's save, the booking pickers, the host area, the resources' calendars and the box cutoffs refuse
 * what is off; nothing is deleted, and switching back on brings each back. Switching off is refused while customers would be hit. Money (the cart
 * and the order agreeing with each feature off, in kroner and in euro) is held in `checkout-kinds.int.test.ts`.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
const owner = () => membershipOf(store.slug, store.account, "owner");
type Selling = "subscriptions" | "boxes" | "appointments" | "bookings";
const switchFeature = async (id: Selling, on: boolean) => {
  const result = await features.setFeature(await owner(), id, on, { confirmed: true });
  expect(result, `${id} ${on ? "on" : "off"}`).toMatchObject({ ok: true });
};
const fresh = async () => (await getStore(store.slug))!;
const handles = async () => {
  const s = await fresh();
  return (await listProducts(s.id, s.markets[0])).map((p) => p.handle);
};
const product: Record<string, string> = {};
const variant: Record<string, string> = {};
const shop = async () => {
  const s = await fresh();
  return { storeId: s.id, market: s.markets[0] };
};
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

beforeAll(async () => {
  store = await makeStore("selling");
  await db().execute(sql`update commerce.stores set country = 'NO' where id = ${store.id}::uuid`);
  const rows = await db().execute<Row>(sql`
    select p.id as product_id, p.handle, v.id as variant_id, v.sku from commerce.products p
    join commerce.product_variants v on v.product_id = p.id where p.store_id = ${store.id}::uuid
  `);
  for (const row of rows) {
    product[String(row.handle)] = String(row.product_id);
    variant[String(row.sku)] = String(row.variant_id);
  }
});
afterAll(async () => {
  await closeDb();
});

describe("a new store's demo bookings (D178)", () => {
  it("starts with the shop alone: the demo appointment, stay and rental are offered nowhere until their feature is on", async () => {
    const s = await fresh();
    expect(s.features).toEqual(["shop"]);
    const listed = await handles();
    expect(listed).toContain("demo-keramikkopp");
    for (const handle of ["demo-massasje", "demo-hytte", "demo-sykkelutleie"]) {
      expect(listed, handle).not.toContain(handle);
      expect(await getProduct(s.id, s.markets[0], handle), handle).toBeNull();
    }
    expect((await listIndexedProducts(s.id)).map((p) => p.handle)).not.toContain("demo-massasje");
    expect((await listGridProducts(s.id, s.markets[0], { categoryIds: [], tagIds: [], sort: "newest", limit: 50 })).map((p) => p.handle)).not.toContain("demo-hytte");
    expect(await getAppointmentOffer(s.id, product["demo-massasje"])).toBeNull();
    expect(await appointmentSlots(s.id, product["demo-massasje"])).toBeNull();
    expect(await getRangeOffer(s.id, product["demo-hytte"])).toBeNull();
    expect(await rangeDates(s.id, product["demo-hytte"], null)).toBeNull();
    // The admin's list says why a published one is not shown.
    const admin = await listAdminProducts(s);
    expect(admin.find((p) => p.handle === "demo-massasje")?.hiddenBy).toBe("Appointments");
    expect(admin.find((p) => p.handle === "demo-hytte")?.hiddenBy).toBe("Stays and rentals");
    expect(admin.find((p) => p.handle === "demo-keramikkopp")?.hiddenBy).toBeNull();
  });

  it("offers the appointment with Appointments on, and stays and rentals with Stays and rentals on, each apart", async () => {
    await switchFeature("appointments", true);
    let s = await fresh();
    expect(await handles()).toContain("demo-massasje");
    expect(await handles()).not.toContain("demo-hytte");
    expect(await getProduct(s.id, s.markets[0], "demo-massasje")).not.toBeNull();
    expect(await getAppointmentOffer(s.id, product["demo-massasje"])).not.toBeNull();
    expect(await getRangeOffer(s.id, product["demo-hytte"])).toBeNull();

    await switchFeature("bookings", true);
    s = await fresh();
    expect(await handles()).toEqual(expect.arrayContaining(["demo-massasje", "demo-hytte", "demo-sykkelutleie"]));
    expect(await getRangeOffer(s.id, product["demo-hytte"])).not.toBeNull();

    await switchFeature("appointments", false);
    s = await fresh();
    expect(await handles()).not.toContain("demo-massasje");
    expect(await handles()).toContain("demo-hytte");
    expect(await getAppointmentOffer(s.id, product["demo-massasje"])).toBeNull();
    await switchFeature("bookings", false);
    expect(await handles()).not.toContain("demo-hytte");
  });
});

describe("the cart and the editor refuse what is off (D178)", () => {
  it("refuses an appointment, a stay and a rental while their feature is off, whatever a stale page sends", async () => {
    jar.clear();
    const s = await shop();
    const massage = await changeLine(s, variant["DEMO-MASSAGE-60"], 1, "add", null, undefined, { startsAt: future(10), resourceId: null });
    expect(massage).not.toMatchObject({ outcome: "added" });
    const stay = await changeLine(s, variant["DEMO-HYTTE"], 2, "add", null, undefined, { startsAt: future(30), resourceId: null });
    expect(stay).not.toMatchObject({ outcome: "added" });
    expect(await changeLine(s, variant["DEMO-MUG-WHITE"], 1, "add")).toMatchObject({ outcome: "added" });
  });

  it("makes a line already in the cart unavailable when its feature goes off, and the cart sells the rest", async () => {
    await switchFeature("appointments", true);
    try {
      jar.clear();
      const s = await shop();
      const week = await appointmentSlots(s.storeId, product["demo-massasje"]);
      const slot = week?.days.flatMap((d) => d.slots).find((t) => t.resourceIds.length > 0);
      expect(slot, "a free massage time").toBeDefined();
      expect(await changeLine(s, variant["DEMO-MASSAGE-60"], 1, "add", null, undefined, { startsAt: slot!.startsAt, resourceId: null })).toMatchObject({ outcome: "added" });
      expect(await changeLine(s, variant["DEMO-MUG-WHITE"], 1, "add")).toMatchObject({ outcome: "added" });
      await switchFeature("appointments", false);
      const cart = await getCart(await shop());
      expect(cart.lines.find((l) => l.variantId === variant["DEMO-MASSAGE-60"])?.status).toBe("unavailable");
      expect(cart.lines.find((l) => l.variantId === variant["DEMO-MUG-WHITE"])?.status).toBe("ok");
      const summary = await cartSummary(await shop(), cart);
      expect(summary.blocked).toBe(true);
    } finally {
      if (featureOn(await fresh(), "appointments")) await switchFeature("appointments", false);
    }
  });

  it("refuses to make a product an appointment, a stay or a rental while that is off, and lets one of that kind be edited", async () => {
    const s = await fresh();
    const context = await getEditorContext(s);
    expect(context).toMatchObject({ appointmentsOn: false, staysOn: false, subscriptionsOn: false });
    const fresh1 = { ...emptyProduct(context), kind: "appointment" as const };
    const refused = await saveProduct(s, context, null, fresh1);
    expect(refused).toMatchObject({ ok: false, problems: [expect.stringContaining("Appointments is switched off")] });
    const mug = (await getProductForEdit(s, context, product["demo-keramikkopp"]))!;
    expect(await saveProduct(s, context, product["demo-keramikkopp"], { ...mug, kind: "stay" })).toMatchObject({ ok: false, problems: [expect.stringContaining("Stays and rentals is switched off")] });
    // The demo massage is an appointment already: it can still be edited (its kind is its own), and stays one.
    const massage = (await getProductForEdit(s, context, product["demo-massasje"]))!;
    expect(await saveProduct(s, context, product["demo-massasje"], massage)).toMatchObject({ ok: true });
    const [row] = await db().execute<Row>(sql`select kind from commerce.products where id = ${product["demo-massasje"]}::uuid`);
    expect(row.kind).toBe("appointment");
  });
});

describe("subscriptions (D178)", () => {
  const plans = async () =>
    Number((await db().execute<Row>(sql`select count(*)::int as n from commerce.selling_plans where product_id = ${product["demo-keramikkopp"]}::uuid and active`))[0].n);
  const PLAN = { id: null, interval: "month" as const, intervalCount: 1, discountPercent: 10, trialDays: 0, signupFee: {}, minCycles: 0 };

  it("keeps a product's purchase options as they are while Subscriptions is off, and saves them once it is on", async () => {
    let s = await fresh();
    let context = await getEditorContext(s);
    const mug = (await getProductForEdit(s, context, product["demo-keramikkopp"]))!;
    expect(await saveProduct(s, context, product["demo-keramikkopp"], { ...mug, plans: [PLAN], subscriptionOnly: true })).toMatchObject({ ok: true });
    expect(await plans()).toBe(0);
    expect((await db().execute<Row>(sql`select subscription_only from commerce.products where id = ${product["demo-keramikkopp"]}::uuid`))[0].subscription_only).toBe(false);

    await switchFeature("subscriptions", true);
    s = await fresh();
    context = await getEditorContext(s);
    expect(context.subscriptionsOn).toBe(true);
    expect(await saveProduct(s, context, product["demo-keramikkopp"], { ...mug, plans: [PLAN] })).toMatchObject({ ok: true });
    expect(await plans()).toBe(1);
    expect((await getProduct(s.id, s.markets[0], "demo-keramikkopp"))!.plans).toHaveLength(1);

    // Off: kept, but not offered; a save from the editor, which sends what it loaded, changes nothing.
    await switchFeature("subscriptions", false);
    s = await fresh();
    context = await getEditorContext(s);
    expect((await getProduct(s.id, s.markets[0], "demo-keramikkopp"))!.plans).toEqual([]);
    const loaded = (await getProductForEdit(s, context, product["demo-keramikkopp"]))!;
    expect(loaded.plans).toHaveLength(1);
    expect(await saveProduct(s, context, product["demo-keramikkopp"], { ...loaded, plans: [] })).toMatchObject({ ok: true });
    expect(await plans()).toBe(1);
  });

  it("refuses a line on a plan while it is off, sells the product once, and makes a plan line already in the cart unavailable", async () => {
    const [plan] = await db().execute<Row>(sql`select id from commerce.selling_plans where product_id = ${product["demo-keramikkopp"]}::uuid and active limit 1`);
    const planId = String(plan.id);
    await switchFeature("subscriptions", true);
    jar.clear();
    expect(await changeLine(await shop(), variant["DEMO-MUG-WHITE"], 1, "add", planId)).toMatchObject({ outcome: "added" });
    await switchFeature("subscriptions", false);
    const cart = await getCart(await shop());
    expect(cart.lines.find((l) => l.plan)?.status).toBe("unavailable");
    const summary = await cartSummary(await shop(), cart);
    expect(summary).toMatchObject({ plan: null, renewal: null, blocked: true });

    jar.clear();
    expect(await changeLine(await shop(), variant["DEMO-MUG-WHITE"], 1, "add", planId)).not.toMatchObject({ outcome: "added" });
    expect(await changeLine(await shop(), variant["DEMO-MUG-WHITE"], 1, "add")).toMatchObject({ outcome: "added" });
  });

  it("hides a product sold only as a subscription while it is off, and offers it again when on", async () => {
    await db().execute(sql`update commerce.products set subscription_only = true where id = ${product["demo-keramikkopp"]}::uuid`);
    try {
      expect(await handles()).not.toContain("demo-keramikkopp");
      const s = await fresh();
      expect(await getProduct(s.id, s.markets[0], "demo-keramikkopp")).toBeNull();
      expect((await listAdminProducts(s)).find((p) => p.handle === "demo-keramikkopp")?.hiddenBy).toBe("Subscriptions");
      jar.clear();
      expect(await changeLine(await shop(), variant["DEMO-MUG-WHITE"], 1, "add")).not.toMatchObject({ outcome: "added" });
      await switchFeature("subscriptions", true);
      expect(await handles()).toContain("demo-keramikkopp");
      await switchFeature("subscriptions", false);
    } finally {
      await db().execute(sql`update commerce.products set subscription_only = false where id = ${product["demo-keramikkopp"]}::uuid`);
    }
  });
});

describe("stays and rentals' hosts and the resources' calendars (D178)", () => {
  it("has no host area while Stays and rentals is off, and keeps the host", async () => {
    const [host] = await db().execute<Row>(sql`
      insert into commerce.hosts (store_id, account_id, name) values (${store.id}::uuid, ${store.account.id}::uuid, 'Hytteeier') returning id
    `);
    expect(await listHostings(store.account)).toEqual([]);
    await switchFeature("bookings", true);
    expect((await listHostings(store.account)).map((h) => h.slug)).toEqual([store.slug]);
    await switchFeature("bookings", false);
    expect(await listHostings(store.account)).toEqual([]);
    expect((await db().execute<Row>(sql`select disabled_at from commerce.hosts where id = ${String(host.id)}::uuid`))[0].disabled_at).toBeNull();
  });

  it("changes no staff, room or item of a feature that is off, and serves no calendar of one", async () => {
    const member = await owner();
    expect(await saveResource(member, null, { name: "Ola", email: "", capacity: 1, active: true, hours: "" }, "staff")).toMatchObject({
      ok: false,
      problems: [expect.stringContaining("Appointments is switched off")],
    });
    const [unit] = await db().execute<Row>(sql`select id from commerce.booking_resources where store_id = ${store.id}::uuid and kind = 'unit' limit 1`);
    const unitId = String(unit.id);
    expect(await resourceFeatureOn(member.store, unitId)).toBe(false);
    const token = `cal${run}${"x".repeat(24)}`.slice(0, 40);
    await db().execute(sql`update commerce.booking_resources set calendar_token = ${token} where id = ${unitId}::uuid`);
    expect(await calendarForToken(token)).toBeNull();
    await switchFeature("bookings", true);
    expect(await resourceFeatureOn((await owner()).store, unitId)).toBe(true);
    expect(await calendarForToken(token)).not.toBeNull();
    await switchFeature("bookings", false);
  });
});

describe("the subscriptions page's files (D178)", () => {
  it("refuses the subscriptions analytics files while Subscriptions is off, and gives them when on", async () => {
    const { mayExportTable } = await import("./analytics-export");
    expect(mayExportTable(await owner(), "subscriptions.bridge")).toBe(false);
    expect(mayExportTable(await owner(), "products.table")).toBe(true);
    await switchFeature("subscriptions", true);
    expect(mayExportTable(await owner(), "subscriptions.bridge")).toBe(true);
    await switchFeature("subscriptions", false);
  });
});

describe("subscription boxes (D178)", () => {
  it("has no box page or cutoffs while it is off; delivery days are kept", async () => {
    const s = await fresh();
    const market = s.markets[0];
    expect(await resolveFeatureShop(store.slug, market.slug, "boxes")).toBeNull();
    const [schedule] = await db().execute<Row>(sql`
      insert into commerce.delivery_schedules (store_id, market_code, currency, name, delivery_weekday, cutoff_days, cutoff_time)
      values (${store.id}::uuid, ${market.code}, ${market.nativeCurrency}, 'Fredag', 5, 1, '00:00') returning id
    `);
    const [customer] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email) values (${store.id}::uuid, ${`box-${run}@example.com`}) returning id`);
    await db().execute(sql`
      insert into commerce.standing_orders (store_id, customer_id, schedule_id, status, payment_method, consent_at)
      values (${store.id}::uuid, ${String(customer.id)}::uuid, ${String(schedule.id)}::uuid, 'active', 'pm_test', now() - interval '30 days')
    `);
    const made = async () => Number((await db().execute<Row>(sql`select count(*)::int as n from commerce.standing_deliveries where store_id = ${store.id}::uuid`))[0].n);
    await prepareDueDeliveries();
    expect(await made()).toBe(0);
    // Switching it on is allowed; switching it off again waits while the list is active.
    await switchFeature("boxes", true);
    expect(await resolveFeatureShop(store.slug, market.slug, "boxes")).not.toBeNull();
    const refused = await features.setFeature(await owner(), "boxes", false, { confirmed: true });
    expect(refused).toMatchObject({ ok: false, blockers: [expect.objectContaining({ path: "/deliveries" })] });
    await db().execute(sql`update commerce.standing_orders set status = 'cancelled', cancelled_at = now() where store_id = ${store.id}::uuid`);
    await switchFeature("boxes", false);
    expect((await db().execute<Row>(sql`select count(*)::int as n from commerce.delivery_schedules where store_id = ${store.id}::uuid`))[0].n).toBe(1);
  });
});

describe("switching the Selling features off is refused while customers would be hit (D178)", () => {
  const book = async (handle: string, kind: "staff" | "unit", startsInDays: number) => {
    const [resource] = await db().execute<Row>(sql`
      select r.id from commerce.booking_resources r
      join commerce.product_resources pr on pr.store_id = r.store_id and pr.resource_id = r.id
      where r.store_id = ${store.id}::uuid and pr.product_id = ${product[handle]}::uuid and r.kind = ${kind} limit 1
    `);
    const startsAt = future(startsInDays);
    const endsAt = future(startsInDays + 1);
    const [row] = await db().execute<Row>(sql`
      insert into commerce.bookings (store_id, product_id, resource_id, starts_at, ends_at, blocked_from, blocked_to, status)
      values (${store.id}::uuid, ${product[handle]}::uuid, ${String(resource.id)}::uuid, ${startsAt}::timestamptz, ${endsAt}::timestamptz,
              ${startsAt}::timestamptz, ${endsAt}::timestamptz, 'confirmed')
      returning id
    `);
    return String(row.id);
  };

  it("waits for an appointment still to come, and allows it once it is cancelled", async () => {
    await switchFeature("appointments", true);
    const id = await book("demo-massasje", "staff", 5);
    expect(await features.setFeature(await owner(), "appointments", false, { confirmed: true })).toMatchObject({
      ok: false,
      blockers: [expect.objectContaining({ path: "/bookings" })],
    });
    await db().execute(sql`update commerce.bookings set status = 'cancelled', cancelled_at = now() where id = ${id}::uuid`);
    await switchFeature("appointments", false);
  });

  it("waits for a stay still to come and for hosts' commissions not paid out", async () => {
    await switchFeature("bookings", true);
    const id = await book("demo-hytte", "unit", 12);
    expect(await features.storeFeatureBlockers(store.id, "bookings")).toEqual([expect.objectContaining({ path: "/bookings/stays" })]);
    await db().execute(sql`update commerce.bookings set status = 'cancelled', cancelled_at = now() where id = ${id}::uuid`);
    expect(await features.storeFeatureBlockers(store.id, "bookings")).toEqual([]);
    const facts = { ...(await features.featureFacts(store.id)), unpaidHostCommissions: 1 };
    const { featureBlockers } = await import("@/lib/store-features");
    expect(featureBlockers("bookings", facts)).toEqual([expect.objectContaining({ path: "/hosts" })]);
    await switchFeature("bookings", false);
  });
});
