import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { encodeTouch } from "@/lib/first-touch";

import type { Account } from "./auth";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const channels = await import("./platform-channels");
const { createAccessRequest } = await import("./platform");

/**
 * Where Kaizena Flow's owners come from and what they are worth (C2, D522) against a real database: a request keeps its first touch, the
 * period's requests are counted by channel against the spend entered (by a platform owner or its finance role, never read-only), and the
 * owners' stores are grouped by the month they were made with what Kaizena Flow was paid for their plans.
 */

const run = Date.now().toString(36);
const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Oslo" });
const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
afterAll(async () => {
  await db().execute(sql`delete from commerce.platform_marketing_spend where campaign = ${`Test ${run}`}`);
  await closeDb();
});

describe("Kaizena Flow's channels and owners (D522)", () => {
  it("keeps a sign-up's first touch, and counts the period's requests by channel against the spend", async () => {
    const [f] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_role) values (${`ch-fin-${run}@example.com`}, 'Fia', 'finance') returning id`);
    const [r] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_role) values (${`ch-read-${run}@example.com`}, 'Rut', 'read_only') returning id`);
    const finance = { id: String(f.id), email: "x", name: null, platformAdmin: false, platformRole: "finance" } as Account;
    const reader = { id: String(r.id), email: "x", name: null, platformAdmin: false, platformRole: "read_only" } as Account;

    // A cookie from a paid search ad, classified; none without one.
    const touch = channels.signupFirstTouch(encodeTouch({ source: "google", medium: "cpc", campaign: `Test ${run}`, day: today }));
    expect(touch).toMatchObject({ channel: "paid_search", source: "google" });
    expect(channels.signupFirstTouch(undefined)).toBeNull();
    const before = await channels.platformChannels(today, tomorrow);
    const paidBefore = before.rows.find((x) => x.channel === "paid_search")?.requests ?? 0;
    await createAccessRequest({ name: "Ada", email: `ch-a-${run}@example.com`, storeName: "Ads", message: "", firstTouch: touch }, { quiet: true });
    await createAccessRequest({ name: "Bo", email: `ch-b-${run}@example.com`, storeName: "Bare", message: "" }, { quiet: true });
    const [kept] = await db().execute<Row>(sql`select first_channel, first_source, first_campaign from commerce.access_requests where email = ${`ch-a-${run}@example.com`}`);
    expect(kept).toEqual({ first_channel: "paid_search", first_source: "google", first_campaign: `test ${run}` });

    // Spend: finance may, read-only may not; the same key again replaces it.
    expect(await channels.savePlatformSpend(reader, { day: today, channel: "paid_search", campaign: `Test ${run}`, amountMinor: 100_000, currency: "NOK", note: "" })).toEqual({ ok: false, problem: "plans" });
    expect(await channels.savePlatformSpend(finance, { day: today, channel: "nowhere", campaign: "", amountMinor: 1, currency: "NOK", note: "" })).toEqual({ ok: false, problem: "channel" });
    expect(await channels.savePlatformSpend(finance, { day: today, channel: "paid_search", campaign: `Test ${run}`, amountMinor: 0, currency: "NOK", note: "" })).toEqual({ ok: false, problem: "amount" });
    expect(await channels.savePlatformSpend(finance, { day: today, channel: "paid_search", campaign: `Test ${run}`, amountMinor: 100_000, currency: "NOK", note: "" })).toEqual({ ok: true });
    expect(await channels.savePlatformSpend(finance, { day: today, channel: "paid_search", campaign: `Test ${run}`, amountMinor: 250_000, currency: "nok", note: "Corrected" })).toEqual({ ok: true });
    const listed = (await channels.listPlatformSpend(today, tomorrow)).filter((s) => s.campaign === `Test ${run}`);
    expect(listed).toEqual([expect.objectContaining({ channel: "paid_search", amountMinor: 250_000, currency: "NOK", note: "Corrected" })]);

    const after = await channels.platformChannels(today, tomorrow);
    const paid = after.rows.find((x) => x.channel === "paid_search")!;
    expect(paid.requests).toBe(paidBefore + 1);
    expect(paid.spendMinor).toBeGreaterThanOrEqual(250_000);
    expect(after.rows.some((x) => x.channel === "unknown")).toBe(true);

    expect(await channels.removePlatformSpend(reader, listed[0].id)).toBe(false);
    expect(await channels.removePlatformSpend(finance, listed[0].id)).toBe(true);
  });

  it("groups the owners' stores by the month they were made, with what they paid for plans", async () => {
    const before = await channels.platformOwnerCohorts();
    const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`ch-owner-${run}@example.com`}, 'Ola', 'Kohort') returning id`);
    await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`kohort-${run}`}, 'Kohort', null)`);
    const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${`kohort-${run}`}`);
    const month = today.slice(0, 7);
    const rowBefore = before.rows.find((x) => x.month === month);
    await db().execute(sql`
      insert into commerce.platform_sales (mode, stripe_invoice_id, buyer_store_id, kind, paid_at, currency, net_minor, vat_minor, total_minor, credited_minor)
      values ('live', ${`in_${run}`}, ${String(store.id)}::uuid, 'plan', now(), ${before.currency}, 80_000, 20_000, 100_000, 50_000),
             ('test', ${`in_t_${run}`}, ${String(store.id)}::uuid, 'plan', now(), ${before.currency}, 99_000, 0, 99_000, 0)
    `);
    const after = await channels.platformOwnerCohorts();
    const row = after.rows.find((x) => x.month === month)!;
    expect(row.stores).toBe((rowBefore?.stores ?? 0) + 1);
    // Half credited: half the net counts; the test mode's sale never does.
    expect(row.paidMinor - (rowBefore?.paidMinor ?? 0)).toBe(40_000);
    expect(row.everPaid).toBe((rowBefore?.everPaid ?? 0) + 1);
    await db().execute(sql`delete from commerce.platform_sales where stripe_invoice_id in (${`in_${run}`}, ${`in_t_${run}`})`);
  });
});
