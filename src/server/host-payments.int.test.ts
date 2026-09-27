import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { addDays, zonedDate, zonedTime } from "@/lib/booking-slots";
import { toMarket } from "@/lib/markets";

import type { Membership } from "./auth";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.1" }),
}));

/** Kaizen's platform Stripe client, faked: it records what it is asked. */
const fake = vi.hoisted(() => {
  const sessions = new Map<string, Record<string, unknown>>();
  const created: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  const transfers: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  const reversals: { id: string; params: Record<string, unknown> }[] = [];
  const refunds: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  const accountUpdates: { id: string; params: Record<string, unknown> }[] = [];
  const domains: { domain: string; account?: string }[] = [];
  const charges: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  const state = { cardPayments: "pending", transferFails: false, accounts: 0, run: Date.now().toString(36) };
  const account = (id: string) => ({
    id,
    configuration: { merchant: { capabilities: { card_payments: { status: state.cardPayments } } } },
    requirements: { entries: [] },
  });
  let next = 0;
  const client = {
    v2: {
      core: {
        accounts: {
          create: async () => account(`acct_host${state.run}${++state.accounts}`),
          retrieve: async (id: string) => account(id),
          update: async (id: string, params: Record<string, unknown>) => {
            accountUpdates.push({ id, params });
            return account(id);
          },
        },
      },
    },
    accounts: { createExternalAccount: async () => ({ id: "ba_test" }) },
    paymentMethodDomains: {
      create: async (params: { domain_name: string }, options: { stripeAccount?: string }) => {
        domains.push({ domain: params.domain_name, account: options?.stripeAccount });
        return { id: `pmd_${domains.length}` };
      },
      list: async () => ({ data: [] }),
    },
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
          const id = `cs_host_${++next}`;
          sessions.set(id, { status: "open", payment_status: "unpaid" });
          created.push({ params, options });
          return params.ui_mode === "elements"
            ? { id, url: null, client_secret: `${id}_secret_test` }
            : { id, url: `https://checkout.stripe.test/${id}`, client_secret: null };
        },
        retrieve: async (id: string, _params: unknown, options: { stripeAccount?: string }) => {
          if (!options?.stripeAccount) throw new Error("no connected account");
          // The deposit's card, saved for a no-show fee (D66).
          return { id, payment_intent: { id: `pi_${id}`, payment_method: "pm_saved" }, customer: "cus_guest", ...sessions.get(id) };
        },
        expire: async (id: string) => ({ id }),
      },
    },
    paymentIntents: {
      create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
        charges.push({ params, options });
        return { id: `pi_noshow${charges.length}`, status: "succeeded" };
      },
    },
    transfers: {
      create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
        if (state.transferFails) throw new Error("Insufficient funds in Stripe account.");
        transfers.push({ params, options });
        return { id: `tr_${transfers.length}` };
      },
      createReversal: async (id: string, params: Record<string, unknown>) => {
        reversals.push({ id, params });
        return { id: `trr_${reversals.length}` };
      },
    },
    refunds: {
      create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
        refunds.push({ params, options });
        return { id: `re_${refunds.length}`, status: "succeeded" };
      },
    },
  };
  return { client, created, sessions, transfers, reversals, refunds, accountUpdates, domains, charges, state };
});

vi.mock("./stripe", () => ({ platformStripe: () => fake.client, platformPublishableKey: () => null }));

const { changeLine } = await import("./cart");
const { startCheckout } = await import("./checkout");
const { getShopperOrder } = await import("./orders");
const { refundOrder } = await import("./order-admin");
const { markNoShow } = await import("./no-show");
const { inviteHost } = await import("./hosts");
const { storeFeeBps } = await import("./billing");
const payments = await import("./host-payments");
const dac7 = await import("./dac7");
const { saleFee } = await import("@/lib/stripe-account");

const run = Date.now().toString(36);
const slug = `hostpay-${run}`;
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const storeAccount = `acct_store${run}`;
let storeId: string;
let hostId: string;
let cabinVariant: string;
let mugVariant: string;
let tz: string;
/** The host's paid order, half refunded, for the tax report. */
const paidOrder = { id: "", due: 0, commission: 0, half: 0, back: 0, total: 0 };

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id
  `);
  storeId = String(store.id);
  await db().execute(sql`
    insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due)
    values (${storeId}::uuid, 'test', ${storeAccount}, 'active', false)
  `);
  await db().execute(sql`
    update commerce.payment_providers set enabled = true, active_mode = 'test', order_invoices = true where store_id = ${storeId}::uuid
  `);
  await db().execute(sql`update commerce.platform_settings set checkout_ui = 'hosted'`);
  const [owner] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name) values (${`owner-${slug}@example.com`}, 'Owner') returning id
  `);
  const member: Membership = {
    account: { id: String(owner.id), email: `owner-${slug}@example.com`, name: "Owner", platformAdmin: false },
    role: "owner",
    store: { id: storeId, slug } as Store,
  };
  const added = await inviteHost(member, { name: "Karis hytter", email: `kari-${slug}@example.com`, commissionPercent: "12.5", vatRegistered: true });
  if (!added.ok) throw new Error(added.problems.join(" "));
  hostId = added.id;
  // The demo cabin is the host's: 1 450 kr a night outside summer, 500 kr cleaning, 30 % paid now.
  const [cabin] = await db().execute<Row>(sql`
    update commerce.products set host_id = ${hostId}::uuid
    where store_id = ${storeId}::uuid and handle = 'demo-hytte'
    returning (select v.id from commerce.product_variants v where v.product_id = commerce.products.id limit 1) as variant_id,
      (select time_zone from commerce.stores where id = ${storeId}::uuid) as tz
  `);
  cabinVariant = String(cabin.variant_id);
  tz = String(cabin.tz);
  const [mug] = await db().execute<Row>(sql`
    select id from commerce.product_variants where store_id = ${storeId}::uuid and sku = 'DEMO-MUG-WHITE'
  `);
  mugVariant = String(mug.id);
});

afterAll(async () => {
  await db().execute(sql`update commerce.platform_settings set checkout_ui = 'custom'`);
  await closeDb();
});

const shop = () => ({ storeId, storeSlug: slug, market: no });
const hostAccount = () => `acct_host${fake.state.run}1`;
const cartId = () => jar.get(`cart_${storeId}_${no.slug}`)!;

/** Two ordinary nights, from a Monday a few weeks ahead outside high summer. */
function checkIn(weeksLater = 0): string {
  const today = zonedDate(Date.now(), "Europe/Oslo");
  let date = addDays(today.slice(5) >= "06-01" && today.slice(5) < "08-16" ? `${today.slice(0, 4)}-08-20` : today, 14 + 7 * weeksLater);
  while (new Date(`${date}T12:00:00Z`).getUTCDay() !== 1) date = addDays(date, 1);
  return new Date(zonedTime(date, "15:00", tz)).toISOString();
}

async function addCabin(weeksLater = 0) {
  expect(
    (await changeLine(shop(), cabinVariant, 2, "add", null, undefined, { startsAt: checkIn(weeksLater), resourceId: null })).outcome,
  ).toBe("added");
}

describe("paying hosts (D71)", () => {
  it("never mixes a host's booking with the store's own goods in one checkout", async () => {
    jar.clear();
    await addCabin();
    await changeLine(shop(), mugVariant, 1, "add");
    expect(await startCheckout(shop(), cartId(), "https://shop.test", "Frakt")).toEqual({ ok: false, problem: "host_mix" });
    expect(fake.created).toHaveLength(0);
  });

  it("waits for the host's account to take payments, then charges it with the store's commission in the fee", async () => {
    jar.clear();
    await addCabin();
    // Kaizen makes the host's test account (D20), which Stripe has not cleared yet.
    expect(await startCheckout(shop(), cartId(), "https://shop.test", "Frakt")).toEqual({ ok: false, problem: "host_payments_off" });
    const accounts = await payments.getHostStripeAccounts(storeId, hostId);
    expect(accounts.test).toMatchObject({ accountId: hostAccount(), cardPayments: "pending", managedByKaizen: true });
    const [cancelled] = await db().execute<Row>(sql`
      select status, host_id from commerce.orders where cart_id = ${cartId()}::uuid order by placed_at desc limit 1
    `);
    expect(cancelled).toMatchObject({ status: "cancelled", host_id: hostId });

    fake.state.cardPayments = "active";
    const started = await startCheckout(shop(), cartId(), "https://shop.test", "Frakt");
    expect(started).toMatchObject({ ok: true });
    const [order] = await db().execute<Row>(sql`
      select o.id, o.commission_minor, o.total_minor, p.amount_minor as due, p.provider_account, p.provider_reference
      from commerce.orders o join commerce.payments p on p.order_id = o.id
      where o.cart_id = ${cartId()}::uuid and o.status = 'pending_payment'
    `);
    const due = Number(order.due);
    // 30 % of two nights and cleaning now, of which the store keeps 12.5 %.
    expect(due).toBe(Math.round((2 * 145000 + 50000) * 0.3));
    const commission = Math.round(due * 0.125);
    expect(Number(order.commission_minor)).toBe(commission);
    const { params, options } = fake.created.at(-1)!;
    expect(options).toMatchObject({ stripeAccount: hostAccount() });
    expect(order.provider_account).toBe(hostAccount());
    expect((params.payment_intent_data as Record<string, unknown>).application_fee_amount).toBe(
      (saleFee(due, await storeFeeBps(storeId)) ?? 0) + commission,
    );
    // The store's invoices are not the host's.
    expect(params).not.toHaveProperty("invoice_creation");

    // Paid, but Kaizen's balance cannot cover the transfer yet: it waits, and the store's account is asked to take transfers.
    fake.state.transferFails = true;
    const sessionId = String(order.provider_reference);
    fake.sessions.set(sessionId, { status: "complete", payment_status: "paid" });
    const orderId = String(order.id);
    expect((await getShopperOrder(storeId, orderId, sessionId))?.status).toBe("paid");
    const [pending] = await db().execute<Row>(sql`select * from commerce.host_commissions where order_id = ${orderId}::uuid`);
    expect(pending).toMatchObject({ status: "pending", host_id: hostId, mode: "test", currency: "NOK", attempts: 1 });
    expect(Number(pending.amount_minor)).toBe(commission);
    // Only Stripe's own errors are passed on word for word.
    expect(pending.last_error).toBe("Stripe could not be reached.");
    expect(fake.accountUpdates).toEqual([
      { id: storeAccount, params: { configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } } } },
    ]);
    // Applying the payment again records nothing twice.
    await getShopperOrder(storeId, orderId, sessionId);
    expect((await db().execute(sql`select 1 from commerce.host_commissions where order_id = ${orderId}::uuid`)).length).toBe(1);

    fake.state.transferFails = false;
    expect(await payments.payHostCommissions({ id: String(pending.id) })).toBe(1);
    expect(fake.transfers.at(-1)).toEqual({
      params: expect.objectContaining({ amount: commission, currency: "nok", destination: storeAccount }),
      options: { idempotencyKey: `host-commission-${String(pending.id)}-${commission}` },
    });
    const [paid] = await db().execute<Row>(sql`select status, transfer_id, last_error from commerce.host_commissions where order_id = ${orderId}::uuid`);
    expect(paid).toEqual({ status: "paid", transfer_id: `tr_${fake.transfers.length}`, last_error: "" });

    // A refund of half gives the shopper back half, the host half the fee, and the store half its commission.
    const half = Math.floor(due / 2);
    const refunded = await refundOrder(storeId, orderId, { amountMinor: half, reason: "Guest cancelled", restock: [] }, null);
    expect(refunded).toMatchObject({ ok: true });
    expect(fake.refunds.at(-1)?.options).toMatchObject({ stripeAccount: hostAccount() });
    const back = Math.round((commission * half) / due);
    expect(fake.reversals).toEqual([{ id: String(paid.transfer_id), params: { amount: back, metadata: { order_id: orderId } } }]);
    Object.assign(paidOrder, { id: orderId, due, commission, half, back });
    expect(await payments.hostEarnings(storeId, hostId)).toEqual([
      expect.objectContaining({ orderId, kind: "booking", paidMinor: due, refundedMinor: half, commissionMinor: commission - back, sent: true }),
    ]);
  });

  it("reports the host, what they were paid and the home they rented out for DAC7", async () => {
    const [row] = await db().execute<Row>(sql`
      select h.account_id, b.resource_id, o.total_minor from commerce.hosts h, commerce.bookings b, commerce.orders o
      where h.id = ${hostId}::uuid and b.order_id = ${paidOrder.id}::uuid and o.id = b.order_id
    `);
    const resourceId = String(row.resource_id);
    await db().execute(sql`update commerce.booking_resources set host_id = ${hostId}::uuid where id = ${resourceId}::uuid`);
    const hosting = {
      account: { id: String(row.account_id), email: "", name: null, platformAdmin: false },
      store: { id: storeId, slug } as Store,
      host: { id: hostId, name: "Karis hytter", commissionBps: 1250 },
    };
    const [unit] = await db().execute<Row>(sql`select name from commerce.booking_resources where id = ${resourceId}::uuid`);
    expect(await dac7.hostTaxStatus(storeId)).toEqual(new Map([[hostId, { details: false, missingAddresses: [String(unit.name)] }]]));

    expect(await dac7.saveHostTaxDetails(hosting, { kind: "individual", legalName: "Kari Nordmann", dateOfBirth: "", address: "x" })).toMatchObject({
      ok: false,
    });
    expect(
      await dac7.saveHostTaxDetails(hosting, {
        kind: "individual",
        legalName: "Kari Nordmann",
        dateOfBirth: "1980-05-17",
        address: "Storgata 1, 0155 Oslo",
        country: "NO",
        tin: "01018012345",
        tinCountry: "NO",
        vatNumber: "",
        businessNumber: "",
        iban: "NO9386011117947",
      }),
    ).toEqual({ ok: true });
    expect(await dac7.saveUnitProperty(hosting, resourceId, { address: "Hytteveien 3, 3864 Rauland", landRegistryNumber: "1/2" })).toEqual({ ok: true });
    expect(await dac7.hostTaxStatus(storeId)).toEqual(new Map([[hostId, { details: true, missingAddresses: [] }]]));

    const year = Number(zonedDate(Date.now(), tz).slice(0, 4));
    const q = Math.floor((Number(zonedDate(Date.now(), tz).slice(5, 7)) - 1) / 3);
    const report = await dac7.dac7Report(storeId, year, tz);
    const quarter = (value: number) => [0, 1, 2, 3].map((i) => (i === q ? value : 0));
    const total = Number(row.total_minor);
    paidOrder.total = total;
    expect(report.sellers).toEqual([
      expect.objectContaining({
        hostId,
        currency: "NOK",
        details: expect.objectContaining({ legalName: "Kari Nordmann", tin: "01018012345", dateOfBirth: "1980-05-17" }),
        // The whole booking, deposit and what is paid on arrival, less the refund.
        considerationMinor: quarter(total - paidOrder.half),
        feesMinor: quarter(paidOrder.commission - paidOrder.back),
        activities: quarter(1),
      }),
    ]);
    expect(report.properties).toEqual([
      expect.objectContaining({
        resourceId,
        address: "Hytteveien 3, 3864 Rauland",
        landRegistryNumber: "1/2",
        considerationMinor: quarter(total),
        activities: quarter(1),
        nights: 2,
      }),
    ]);
    expect((await dac7.dac7Report(storeId, year - 1, tz)).sellers).toEqual([]);
    const csv = dac7.dac7Csv(report, "sellers").split("\r\n");
    expect(csv[0]).toMatch(/^Host,Email,Type,Legal name,Date of birth,Address,Country,TIN,/);
    expect(csv[1]).toContain(`Karis hytter,kari-${slug}@example.com,individual,Kari Nordmann,1980-05-17,"Storgata 1, 0155 Oslo",NO,01018012345,NO`);
    expect(dac7.dac7Csv(report, "properties")).toContain("Kari Nordmann,");
  });

  it("keeps the store's commission of a no-show fee charged to the guest's saved card, and reports the fee", async () => {
    // The guest never came: the stay is past, and the listing charges the whole stay on a no-show.
    const [booking] = await db().execute<Row>(sql`
      update commerce.bookings set starts_at = now() - interval '3 days', ends_at = now() - interval '1 day',
        blocked_from = now() - interval '3 days', blocked_to = now() - interval '1 day'
      where order_id = ${paidOrder.id}::uuid returning id, product_id
    `);
    await db().execute(sql`
      update commerce.appointment_settings set no_show_percent = 100 where product_id = ${String(booking.product_id)}::uuid
    `);
    const [line] = await db().execute<Row>(sql`
      select venue_minor from commerce.order_lines where order_id = ${paidOrder.id}::uuid and variant_id is not null
    `);
    // The whole stay, less the deposit already paid: what was left for arrival.
    const fee = Number(line.venue_minor);
    expect(fee).toBeGreaterThan(0);
    const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`owner-${slug}@example.com`}`);
    const member: Membership = {
      account: { id: String(owner.id), email: "", name: null, platformAdmin: false },
      role: "owner",
      store: { id: storeId, slug } as Store,
    };
    expect(await markNoShow(member, String(booking.id), true)).toEqual({ ok: true, chargedMinor: fee });

    // Charged on the host's account, with Kaizen's fee and the store's 12.5 % in the application fee.
    const commission = Math.round(fee * 0.125);
    const { params, options } = fake.charges.at(-1)!;
    expect(options).toMatchObject({ stripeAccount: hostAccount() });
    expect(params).toMatchObject({ amount: fee, payment_method: "pm_saved", customer: "cus_guest" });
    expect(params.application_fee_amount).toBe((saleFee(fee, await storeFeeBps(storeId)) ?? 0) + commission);
    const [owed] = await db().execute<Row>(sql`
      select c.kind, c.amount_minor, c.status, p.provider_reference from commerce.host_commissions c
      join commerce.payments p on p.id = c.payment_id where c.order_id = ${paidOrder.id}::uuid and c.kind = 'no_show'
    `);
    expect(owed).toEqual({ kind: "no_show", amount_minor: String(commission), status: "paid", provider_reference: `pi_noshow${fake.charges.length}` });
    expect(fake.transfers.at(-1)?.params).toMatchObject({ amount: commission, destination: storeAccount, description: expect.stringMatching(/no-show fee/) });

    // The host and the store see it next to the booking, newest first.
    const earnings = await payments.hostEarnings(storeId, hostId);
    expect(earnings.map((e) => [e.kind, e.paidMinor, e.commissionMinor])).toEqual([
      ["no_show", fee, commission],
      ["booking", paidOrder.due, paidOrder.commission - paidOrder.back],
    ]);
    // The tax report counts the fee as paid to the host, and the commission on it.
    const report = await dac7.dac7Report(storeId, Number(zonedDate(Date.now(), tz).slice(0, 4)), tz);
    const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
    expect(sum(report.sellers[0].considerationMinor)).toBe(paidOrder.total - paidOrder.half + fee);
    expect(sum(report.sellers[0].feesMinor)).toBe(paidOrder.commission - paidOrder.back + commission);
  });

  it("registers the site's domain on the host's account for wallets on Kaizen's checkout page, once", async () => {
    await db().execute(sql`update commerce.platform_settings set checkout_ui = 'custom'`);
    try {
      for (const weeks of [2, 4]) {
        jar.clear();
        await addCabin(weeks);
        expect(await startCheckout(shop(), cartId(), "https://butikk.example.no", "Frakt")).toMatchObject({ ok: true });
        expect(fake.created.at(-1)?.options).toMatchObject({ stripeAccount: hostAccount() });
      }
      expect(fake.domains).toEqual([{ domain: "butikk.example.no", account: hostAccount() }]);
      const [row] = await db().execute<Row>(sql`
        select h.payment_domains as host, s.payment_domains as store
        from commerce.host_stripe_accounts h, commerce.stripe_accounts s
        where h.host_id = ${hostId}::uuid and h.mode = 'test' and s.store_id = ${storeId}::uuid and s.mode = 'test'
      `);
      // The store's own account is not touched.
      expect(row).toEqual({ host: ["butikk.example.no"], store: [] });
    } finally {
      await db().execute(sql`update commerce.platform_settings set checkout_ui = 'hosted'`);
    }
  });

  it("takes the store's commission as a share of what is paid online", () => {
    expect(payments.commissionOf(61800, 1250)).toBe(7725);
    expect(payments.commissionOf(0, 1250)).toBe(0);
    expect(payments.commissionOf(1000, 0)).toBe(0);
    expect(payments.commissionOf(1000, 10000)).toBe(1000);
  });
});
