import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { parseStarterDetails, type StarterDetails } from "@/lib/store-starters";

import type { Account } from "./auth";

vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {} }));

const starters = await import("./store-starters");
const { approveAccessRequest, createAccessRequest, createStoreForOwner } = await import("./platform");
const { listStoreBilling } = await import("./billing");
const { listPublicStores } = await import("./seo");
const { platformOverview } = await import("./platform-overview");
const { listPlatformCustomers } = await import("./platform-customers");
const { getCheckoutInfo } = await import("./orders");
const { sendEmail } = await import("./email");
const { listStores } = await import("./auth");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
const spaSlug = `spa-${run}`;
let admin: Account;
let otherAdmin: Account;
let owner: Account;
let spa: { id: string; storeId: string };

const details = (over: Partial<Record<keyof StarterDetails, string>> = {}): StarterDetails => {
  const parsed = parseStarterDetails({ title: "Spa & salon", summary: "Treatments by time", description: "Two therapists.", category: "appointments", ...over });
  if (!parsed.ok) throw new Error(parsed.problems.join(" "));
  return parsed.details;
};

const one = async (query: ReturnType<typeof sql>) => (await db().execute<Row>(query))[0];

/** The database refused it, with this reason in its message (Drizzle wraps the driver's error). */
async function refused(work: PromiseLike<unknown>, code: RegExp): Promise<void> {
  try {
    await work;
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause?.message ?? "";
    expect(`${(error as Error).message} ${cause}`).toMatch(code);
    return;
  }
  throw new Error("The database took it, and should have refused.");
}

beforeAll(async () => {
  const [a] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin) values (${`platform-${run}@example.com`}, 'Platform', true) returning id, email
  `);
  admin = { id: String(a.id), email: String(a.email), name: "Platform", platformAdmin: true };
  const [b] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin) values (${`platform2-${run}@example.com`}, 'Other', true) returning id, email
  `);
  otherAdmin = { id: String(b.id), email: String(b.email), name: "Other", platformAdmin: true };
  // An owner with a store of their own (only owners may create more).
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`owner-${run}@example.com`}, 'Kari', 'First') returning id
  `);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`first-${run}`}, 'First', null)`);
  const [o] = await db().execute<Row>(sql`select id, email from commerce.accounts where lower(email) = ${`owner-${run}@example.com`}`);
  owner = { id: String(o.id), email: String(o.email), name: "Kari", platformAdmin: false };
});

afterAll(async () => {
  await closeDb();
});

describe("a platform admin makes a store template (D175)", () => {
  it("refuses anyone who does not run the platform", async () => {
    expect(await starters.createStarter(owner, { slug: `nope-${run}`, details: details() })).toMatchObject({ ok: false });
  });

  it("copies the default template into a store marked starter, owned by the admin, unpublished and last", async () => {
    const result = await starters.createStarter(admin, { slug: spaSlug, details: details() });
    expect(result).toMatchObject({ ok: true, slug: spaSlug });
    if (!result.ok) return;
    const row = await one(sql`
      select s.id, s.starter, s.is_template, s.name, st.published, st.position,
             (select max(position) from commerce.store_starters) as last,
             (select m.role from commerce.store_members m where m.store_id = s.id and m.account_id = ${admin.id}::uuid) as role,
             (select count(*)::int from commerce.products p where p.store_id = s.id) as products
      from commerce.store_starters st join commerce.stores s on s.id = st.store_id where st.id = ${result.id}::uuid
    `);
    expect(row).toMatchObject({ starter: true, is_template: false, name: "Spa & salon", published: false, role: "owner" });
    expect(Number(row.position)).toBe(Number(row.last));
    expect(Number(row.products)).toBeGreaterThan(0);
    spa = { id: result.id, storeId: String(row.id) };
    const audit = await one(sql`select count(*)::int as n from commerce.audit_log where action = 'platform.starter_created' and store_id = ${spa.storeId}::uuid`);
    expect(Number(audit.n)).toBe(1);
  });

  it("refuses a taken address and keeps nothing", async () => {
    const before = await one(sql`select count(*)::int as n from commerce.store_starters`);
    expect(await starters.createStarter(admin, { slug: spaSlug, details: details() })).toEqual({ ok: false, problems: [`The address ${spaSlug} is taken. Choose another.`] });
    expect((await one(sql`select count(*)::int as n from commerce.store_starters`)).n).toBe(before.n);
  });

  it("is listed for the platform, not offered while unpublished", async () => {
    expect((await starters.listStarters()).some((s) => s.id === spa.id && !s.published)).toBe(true);
    expect((await starters.listOfferedStarters()).some((s) => s.id === spa.id)).toBe(false);
  });

  it("lets another platform admin in as an owner when they open its admin", async () => {
    expect(await starters.joinStarter(otherAdmin, spa.id)).toEqual({ ok: true, slug: spaSlug });
    expect(await starters.joinStarter(otherAdmin, spa.id)).toEqual({ ok: true, slug: spaSlug });
    const row = await one(sql`
      select m.role, (select count(*)::int from commerce.audit_log a where a.action = 'platform.starter_joined' and a.store_id = ${spa.storeId}::uuid) as joins
      from commerce.store_members m where m.store_id = ${spa.storeId}::uuid and m.account_id = ${otherAdmin.id}::uuid
    `);
    expect(row).toMatchObject({ role: "owner", joins: 1 });
    expect(await starters.joinStarter(owner, spa.id)).toMatchObject({ ok: false });
  });
});

describe("the database's rules for store templates", () => {
  it("keeps a starter a starter, never also the template, and refuses its orders", async () => {
    await refused(db().execute(sql`update commerce.stores set starter = false where id = ${spa.storeId}::uuid`), /stores\.starter_fixed/);
    await refused(db().execute(sql`update commerce.stores set is_template = true where id = ${spa.storeId}::uuid`), /stores_starter_not_template|stores_one_template/);
    expect((await one(sql`select commerce.store_is_active(${spa.storeId}::uuid) as open`)).open).toBe(false);
  });

  it("never makes a store that has customers a starter", async () => {
    const first = await one(sql`select id from commerce.stores where slug = ${`first-${run}`}`);
    await db().execute(sql`insert into commerce.customers (store_id, email) values (${String(first.id)}::uuid, ${`shopper-${run}@example.com`})`);
    await refused(db().execute(sql`update commerce.stores set starter = true where id = ${String(first.id)}::uuid`), /stores\.starter_has_sales/);
  });

  it("describes only a starter store", async () => {
    const first = await one(sql`select id from commerce.stores where slug = ${`first-${run}`}`);
    await refused(
      db().execute(sql`insert into commerce.store_starters (store_id, title, category) values (${String(first.id)}::uuid, 'X', 'other')`),
      /store_starters\.not_starter/,
    );
  });
});

describe("setting the template up, then publishing it", () => {
  beforeAll(async () => {
    // The admin sets the store up as a spa: bookings on, its own time zone, business buyers too, a tick for the terms, a therapist
    // with opening hours, a draft of its terms as the terms page, gift messages, a customer group, a second currency.
    await db().execute(sql`
      update commerce.stores set modules = array['bookings'], time_zone = 'Europe/Stockholm', audience = 'both', terms_at_checkout = 'checkbox',
        custom_css = '.spa { color: teal; }', tracking = '{"googleAnalytics": "G-SPA"}'::jsonb, legal_name = 'Spa template AS'
      where id = ${spa.storeId}::uuid
    `);
    await db().execute(sql`
      insert into commerce.booking_resources (store_id, kind, name, email, hours, capacity, active, position)
      values (${spa.storeId}::uuid, 'staff', 'Therapist Anna', 'anna@example.com', '{"week": {"mon": {"open": "09:00", "close": "17:00"}}, "exceptions": []}'::jsonb, 1, true, 9)
    `);
    const [page] = await db().execute<Row>(sql`
      insert into commerce.pages (store_id, type, slug, draft) values (${spa.storeId}::uuid, 'page', 'vilkar', '{"title": "Vilkår", "rows": []}'::jsonb)
      returning id
    `);
    await db().execute(sql`insert into commerce.page_roles (store_id, role, page_id) values (${spa.storeId}::uuid, 'terms', ${String(page.id)}::uuid)`);
    await db().execute(sql`
      insert into commerce.order_settings (store_id, gift_messages, auto_archive_days) values (${spa.storeId}::uuid, true, 30)
      on conflict (store_id) do update set gift_messages = true, auto_archive_days = 30
    `);
    await db().execute(sql`insert into commerce.customer_tiers (store_id, name, percent) values (${spa.storeId}::uuid, 'Members', 10)`);
    await db().execute(sql`insert into commerce.store_currencies (store_id, currency, rate) values (${spa.storeId}::uuid, 'EUR', 0.085) on conflict do nothing`);
    // Things that are the template's own and must never reach a new store: a shopper, an audit trail, a Stripe account.
    await db().execute(sql`insert into commerce.customers (store_id, email) values (${spa.storeId}::uuid, ${`preview-${run}@example.com`})`);
  });

  it("is refused to owners until it is published", async () => {
    expect(await createStoreForOwner(owner, "Early", `early-${run}`, spa.id)).toEqual({
      ok: false,
      problems: ["That store template is not offered any more. Choose another."],
    });
    expect((await one(sql`select count(*)::int as n from commerce.stores where slug = ${`early-${run}`}`)).n).toBe(0);
  });

  it("is offered once published, as its frozen copy, first in the order after a move up", async () => {
    expect(await starters.publishStarter(admin, spa.id)).toEqual({ ok: true, copySlug: `${spaSlug}-v1`, notes: [] });
    const second = await starters.createStarter(admin, { slug: `shop-${run}`, details: details({ title: "Shop", category: "retail" }) });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    await starters.publishStarter(admin, second.id);
    await starters.moveStarter(admin, second.id, "up");
    const offered = await starters.listOfferedStarters();
    const ids = offered.map((s) => s.id);
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(spa.id));
    // Owners preview the copy made when it was published (D177), not the store the admin keeps working in.
    expect(offered.find((s) => s.id === spa.id)).toMatchObject({ title: "Spa & salon", category: "appointments", storeSlug: `${spaSlug}-v1` });
    const cards = await starters.starterCards();
    expect(cards[0]).toMatchObject({ id: "", title: "Standard store" });
    expect(cards.find((c) => c.id === spa.id)?.previewHref).toBe(`/s/${spaSlug}-v1`);
    const copy = await one(sql`select starter, starter_copy_of, made_from_starter from commerce.stores where slug = ${`${spaSlug}-v1`}`);
    expect(copy).toEqual({ starter: true, starter_copy_of: spa.id, made_from_starter: null });
    const audit = await one(sql`select details from commerce.audit_log where action = 'platform.starter_published' and store_id = ${spa.storeId}::uuid`);
    expect(audit.details).toMatchObject({ starter: spa.id, copySlug: `${spaSlug}-v1` });
  });

  it("gives an owner's new store the template's set-up and nothing of its own", async () => {
    expect(await createStoreForOwner(owner, "My spa", `myspa-${run}`, spa.id)).toMatchObject({ ok: true, slug: `myspa-${run}` });
    const store = await one(sql`
      select s.id, s.modules, s.time_zone, s.audience, s.terms_at_checkout, s.custom_css, s.tracking, s.legal_name, s.starter, s.made_from_starter,
             s.setup_completed_at
      from commerce.stores s where s.slug = ${`myspa-${run}`}
    `);
    expect(store).toMatchObject({
      modules: ["bookings"],
      time_zone: "Europe/Stockholm",
      audience: "both",
      terms_at_checkout: "checkbox",
      custom_css: ".spa { color: teal; }",
      tracking: {},
      legal_name: null,
      starter: false,
      made_from_starter: spa.id,
      setup_completed_at: null,
    });
    const id = String(store.id);
    const counts = await one(sql`
      select
        (select count(*)::int from commerce.products where store_id = ${id}::uuid) as products,
        (select count(*)::int from commerce.products where store_id = ${spa.storeId}::uuid and status <> 'archived') as template_products,
        (select count(*)::int from commerce.booking_resources where store_id = ${id}::uuid and name = 'Therapist Anna' and email = '' and hours <> '{}'::jsonb) as therapist,
        (select count(*)::int from commerce.pages p join commerce.page_roles r on r.page_id = p.id
           where p.store_id = ${id}::uuid and r.role = 'terms' and p.slug = 'vilkar' and p.published_at is null) as terms_draft,
        (select gift_messages from commerce.order_settings where store_id = ${id}::uuid) as gifts,
        (select count(*)::int from commerce.customer_tiers where store_id = ${id}::uuid and name = 'Members') as tiers,
        (select count(*)::int from commerce.store_currencies where store_id = ${id}::uuid and currency = 'EUR') as currencies,
        (select count(*)::int from commerce.customers where store_id = ${id}::uuid) as customers,
        (select count(*)::int from commerce.store_members where store_id = ${id}::uuid) as members,
        (select count(*)::int from commerce.stripe_accounts where store_id = ${id}::uuid) as stripe,
        (select count(*)::int from commerce.store_starters where store_id = ${id}::uuid) as listed
    `);
    expect(Number(counts.products)).toBe(Number(counts.template_products));
    expect(counts).toMatchObject({ therapist: 1, terms_draft: 1, gifts: true, tiers: 1, currencies: 1, customers: 0, members: 1, stripe: 0, listed: 0 });
    // The new store is an ordinary one: it takes orders once open, and it is counted.
    expect((await one(sql`select commerce.store_is_active(${id}::uuid) as open`)).open).toBe(true);
    expect((await starters.listStarters()).find((s) => s.id === spa.id)?.storesMade).toBe(1);
  });

  it("never takes another store, the template's own store or an unknown id as the source", async () => {
    const first = await one(sql`select id from commerce.stores where slug = ${`first-${run}`}`);
    const template = await one(sql`select id from commerce.stores where is_template`);
    for (const id of [String(first.id), String(template.id), spa.storeId, crypto.randomUUID()]) {
      expect(await createStoreForOwner(owner, "Sneaky", `sneaky-${run}`, id)).toMatchObject({ ok: false });
    }
    expect((await one(sql`select count(*)::int as n from commerce.stores where slug = ${`sneaky-${run}`}`)).n).toBe(0);
  });

  it("still makes a Standard store from the default template", async () => {
    expect(await createStoreForOwner(owner, "Plain", `plain-${run}`)).toMatchObject({ ok: true, slug: `plain-${run}` });
    const store = await one(sql`select made_from_starter, audience, modules from commerce.stores where slug = ${`plain-${run}`}`);
    expect(store.made_from_starter).toBeNull();
  });
});

describe("sign-up with a store template", () => {
  it("keeps a published template on the request, drops anything else, and approval copies it", async () => {
    await createAccessRequest({ name: "Siri", email: `siri-${run}@example.com`, storeName: "Siri Spa", message: "", starterId: spa.id });
    await createAccessRequest({ name: "Per", email: `per-${run}@example.com`, storeName: "Per", message: "", starterId: crypto.randomUUID() });
    const siri = await one(sql`select id, starter_id from commerce.access_requests where lower(email) = ${`siri-${run}@example.com`}`);
    const per = await one(sql`select id, starter_id from commerce.access_requests where lower(email) = ${`per-${run}@example.com`}`);
    expect(siri.starter_id).toBe(spa.id);
    expect(per.starter_id).toBeNull();

    expect(await approveAccessRequest(admin, String(siri.id), `siri-${run}`, "Siri Spa", "https://example.com")).toMatchObject({ ok: true });
    const made = await one(sql`select made_from_starter, modules from commerce.stores where slug = ${`siri-${run}`}`);
    expect(made).toMatchObject({ made_from_starter: spa.id, modules: ["bookings"] });
  });

  it("refuses an unpublished template the admin chooses, and gives a request whose template was unpublished since the Standard store (D177)", async () => {
    await createAccessRequest({ name: "Ola", email: `ola-${run}@example.com`, storeName: "Ola", message: "", starterId: spa.id });
    await createAccessRequest({ name: "Eva", email: `eva-${run}@example.com`, storeName: "Eva", message: "", starterId: spa.id });
    const ola = await one(sql`select id from commerce.access_requests where lower(email) = ${`ola-${run}@example.com`}`);
    const eva = await one(sql`select id from commerce.access_requests where lower(email) = ${`eva-${run}@example.com`}`);
    expect(await starters.unpublishStarter(admin, spa.id)).toEqual({ ok: true, pendingRequests: 2 });
    // Chosen by the admin: refused in plain words, nothing made.
    expect(await approveAccessRequest(admin, String(ola.id), `ola-${run}`, "Ola", "https://example.com", spa.id)).toEqual({
      ok: false,
      problems: ["That store template is not offered any more. Choose another."],
    });
    expect((await one(sql`select status from commerce.access_requests where id = ${String(ola.id)}::uuid`)).status).toBe("pending");
    // Kept from the request: the Standard store, and the admin is told.
    expect(await approveAccessRequest(admin, String(ola.id), `ola-${run}`, "Ola", "https://example.com")).toMatchObject({
      ok: true,
      fellBack: { starter: "Spa & salon", design: null },
    });
    expect((await one(sql`select made_from_starter from commerce.stores where slug = ${`ola-${run}`}`)).made_from_starter).toBeNull();
    // The request page leaves the choice empty for a template no longer offered, and the admin is told the same.
    expect(await approveAccessRequest(admin, String(eva.id), `eva-${run}`, "Eva", "https://example.com", null)).toMatchObject({
      ok: true,
      fellBack: { starter: "Spa & salon" },
    });
    expect((await starters.publishStarter(admin, spa.id)).ok).toBe(true);
  });
});

describe("a store template is not a real store", () => {
  it("is left out of the platform's counts, store lists, customers and billing", async () => {
    const overview = await platformOverview();
    const count = await one(sql`select count(*)::int as n from commerce.stores where status <> 'closed' and not (is_template or starter)`);
    const total = Object.values(overview.stores ?? {}).reduce((sum: number, n) => sum + (typeof n === "number" ? n : 0), 0);
    expect(total).toBeGreaterThan(0);
    expect(JSON.stringify(overview)).not.toContain(spaSlug);
    expect(Number(count.n)).toBeGreaterThan(0);
    expect((await listStores(admin)).some((s) => s.slug === spaSlug)).toBe(false);
    expect((await listStoreBilling({ includeClosed: true })).some((s) => s.slug === spaSlug)).toBe(false);
    const customers = await listPlatformCustomers({ q: `platform-${run}` });
    expect(customers.flatMap((c) => c.stores.map((s) => s.slug))).not.toContain(spaSlug);
  });

  it("is never indexable, takes no payment and says why", async () => {
    expect((await listPublicStores()).find((s) => s.slug === spaSlug)?.indexable).toBe(false);
    const market = await one(sql`select code from commerce.markets where store_id = ${spa.storeId}::uuid and active limit 1`);
    expect(await getCheckoutInfo(spa.storeId, String(market.code))).toMatchObject({ starter: true, paymentsOn: false });
  });

  it("emails no shopper, but still its staff", async () => {
    const shopper = await sendEmail({
      storeId: spa.storeId,
      kind: "account.code",
      to: `preview-${run}@example.com`,
      email: { subject: "Your code", html: "<p>1</p>", text: "1" },
      fromName: "Spa",
    });
    expect(shopper).toBe("suppressed");
    const kept = await one(sql`select status, error, to_address from commerce.email_messages where store_id = ${spa.storeId}::uuid and kind = 'account.code' order by created_at desc limit 1`);
    expect(kept).toMatchObject({ status: "failed", error: "suppressed: a store template does not email shoppers", to_address: "[removed]" });
    const staff = await sendEmail({
      storeId: spa.storeId,
      kind: "stock.low",
      to: admin.email,
      email: { subject: "Low stock", html: "<p>1</p>", text: "1" },
      fromName: "Spa",
    });
    expect(staff).not.toBe("suppressed");
  });

  it("refuses an order whoever asks", async () => {
    const market = await one(sql`select code, currency from commerce.markets where store_id = ${spa.storeId}::uuid and active limit 1`);
    await refused(
      db().execute(sql`
        insert into commerce.orders (store_id, number, email, market_code, currency, locale, subtotal_minor, shipping_minor, tax_minor, total_minor,
          billing_address, shipping_address, status)
        values (${spa.storeId}::uuid, 'X-1', 'a@example.com', ${String(market.code)}, ${String(market.currency)}, 'nb-NO', 0, 0, 0, 0,
          '{}'::jsonb, '{}'::jsonb, 'pending_payment')
      `),
      /orders\.store_starter/,
    );
  });
});

describe("the life of a store template (D177)", () => {
  it("keeps saved details as a draft until it is published again; owners read the published ones", async () => {
    expect(await starters.saveStarterDraft(admin, spa.id, details({ title: "Spa, salon and sauna" }))).toEqual({ ok: true });
    expect((await starters.listOfferedStarters()).find((s) => s.id === spa.id)?.title).toBe("Spa & salon");
    const row = await starters.getStarter(spa.id);
    expect(row?.draft?.title).toBe("Spa, salon and sauna");
    expect(starters.shownDetails(row!).title).toBe("Spa, salon and sauna");
    expect(starters.starterLifecycle(row!).changed).toBe(true);
    // Saving the published details again is no draft.
    expect(await starters.saveStarterDraft(admin, spa.id, details())).toEqual({ ok: true });
    expect((await starters.getStarter(spa.id))?.draft).toBeNull();
    await starters.saveStarterDraft(admin, spa.id, details({ title: "Spa, salon and sauna" }));
    expect(await starters.saveStarterDraft(owner, spa.id, details())).toMatchObject({ ok: false });
  });

  it("copies new stores from what was published, never from changes made in its store since", async () => {
    await db().execute(sql`update commerce.stores set time_zone = 'Europe/Helsinki' where id = ${spa.storeId}::uuid`);
    await db().execute(sql`insert into commerce.audit_log (store_id, action, details) values (${spa.storeId}::uuid, 'store.settings_saved', '{}'::jsonb)`);
    expect((await starters.getStarter(spa.id))?.changedInStore).toBe(true);
    expect(await createStoreForOwner(owner, "Before", `before-${run}`, spa.id)).toMatchObject({ ok: true });
    expect((await one(sql`select time_zone from commerce.stores where slug = ${`before-${run}`}`)).time_zone).toBe("Europe/Stockholm");

    const published = await starters.publishStarter(admin, spa.id);
    expect(published).toMatchObject({ ok: true });
    const copySlug = (published as { copySlug: string }).copySlug;
    expect((await starters.listOfferedStarters()).find((s) => s.id === spa.id)).toMatchObject({ title: "Spa, salon and sauna", storeSlug: copySlug });
    expect(await createStoreForOwner(owner, "After", `after-${run}`, spa.id)).toMatchObject({ ok: true });
    expect(await one(sql`select time_zone, made_from_starter from commerce.stores where slug = ${`after-${run}`}`)).toEqual({ time_zone: "Europe/Helsinki", made_from_starter: spa.id });
    // The copies it replaced are closed and kept; only one is open.
    const copies = await db().execute<Row>(sql`select status from commerce.stores where starter_copy_of = ${spa.id}::uuid order by created_at`);
    expect(copies.map((c) => c.status).filter((status) => status === "active")).toHaveLength(1);
    expect(copies.length).toBeGreaterThan(1);
    const row = await starters.getStarter(spa.id);
    expect(row).toMatchObject({ draft: null, changedInStore: false, publishedSlug: copySlug });
  });

  it("never lists its frozen copies among anyone's stores, and nobody works in one", async () => {
    const copies = await db().execute<Row>(sql`select slug from commerce.stores where starter_copy_of = ${spa.id}::uuid`);
    const slugs = copies.map((c) => String(c.slug));
    expect(slugs.length).toBeGreaterThan(0);
    const { snapshotSources } = await import("./design-presets");
    const { workStoresFor } = await import("./work-owner");
    const seen = [
      ...(await listStores(admin)).map((s) => s.slug),
      ...(await snapshotSources(admin)).map((s) => s.slug),
      ...(await listStoreBilling({ includeClosed: true })).map((s) => s.slug),
      ...(await starters.listStarters()).map((s) => s.storeSlug),
      ...Object.values(await workStoresFor(admin)).flatMap((list) => list.map((s: { slug: string }) => s.slug)),
    ];
    for (const slug of slugs) expect(seen).not.toContain(slug);
  });

  it("is taken out of the choices at once when unpublished or archived, and comes back unpublished when restored", async () => {
    const shop = (await starters.listStarters()).find((s) => s.storeSlug === `shop-${run}`)!;
    expect(await starters.archiveStarter(admin, shop.id)).toEqual({ ok: true });
    expect((await starters.listOfferedStarters()).some((s) => s.id === shop.id)).toBe(false);
    expect((await starters.listStarters()).some((s) => s.id === shop.id)).toBe(false);
    expect((await starters.listStarters("archived")).find((s) => s.id === shop.id)).toMatchObject({ published: false });
    expect(await starters.publishStarter(admin, shop.id)).toEqual({ ok: false, problems: ["This store template is archived. Restore it before publishing it."] });
    expect(await createStoreForOwner(owner, "Shelved", `shelved-${run}`, shop.id)).toMatchObject({ ok: false });
    expect(await starters.restoreStarter(admin, shop.id)).toEqual({ ok: true });
    expect((await starters.getStarter(shop.id))).toMatchObject({ archivedAt: null, published: false });
    const audit = await one(sql`
      select count(*)::int as n from commerce.audit_log where target_id = ${shop.id} and action in ('platform.starter_archived', 'platform.starter_restored')
    `);
    expect(audit.n).toBe(2);
  });

  it("is deleted only while unused: its stores are closed and kept", async () => {
    expect(await starters.deleteStarter(admin, spa.id)).toEqual({
      ok: false,
      problems: [expect.stringMatching(/^This store template cannot be deleted: \d+ stores were made from it and \d+ access requests name it\. Archive it instead\.$/)],
    });
    const unused = await starters.createStarter(admin, { slug: `unused-${run}`, details: details({ title: "Unused" }) });
    if (!unused.ok) throw new Error("not made");
    await starters.publishStarter(admin, unused.id);
    const storeId = String((await one(sql`select store_id from commerce.store_starters where id = ${unused.id}::uuid`)).store_id);
    expect(await starters.deleteStarter(owner, unused.id)).toMatchObject({ ok: false });
    expect(await starters.deleteStarter(admin, unused.id)).toEqual({ ok: true });
    expect((await one(sql`select count(*)::int as n from commerce.store_starters where id = ${unused.id}::uuid`)).n).toBe(0);
    const closed = await db().execute<Row>(sql`select status from commerce.stores where id = ${storeId}::uuid or slug = ${`unused-${run}-v1`}`);
    expect(closed.map((r) => r.status)).toEqual(["closed", "closed"]);
  });
});
