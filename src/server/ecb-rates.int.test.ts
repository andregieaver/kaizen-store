import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { ECB_HIST_90D_URL, isEcbUrl } from "@/lib/ecb-history";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const fx = await import("./invoice-test-fixture");
const { ECB_LIMIT_ALL_STORES_PER_HOUR, ECB_LIMIT_PER_STORE_PER_HOUR, fetchRateForOwner, fetchRatesForDay, overridesFor, plainRate, rateLookup, storeEcbRates, storedRates, takeEcbSlot } = await import("./ecb-rates");
const { listOverrides, setRateOverride } = await import("./tax-rate-overrides");

type Row = Record<string, unknown>;

/**
 * The euro rates behind the OSS and IOSS returns (D161, docs 3.1, 4.5): the daily job stores the ECB's days once and never replaces one,
 * a failing fetch changes nothing and never throws, an owner asks for one day or enters their own rate with a reason (audit-logged,
 * owners only, for that store only), and the lookup a return reads prefers the owner's rate and otherwise takes the day's or the next
 * publication day's. The ECB is faked with an injected fetch that records every address it is asked for.
 *
 * The rate table is append-only and shared, so each test uses currency codes of its own (the ECB publishes none of them).
 */

afterAll(async () => {
  await closeDb();
});

let n = 0;
const used = new Set<string>();
/** A currency code no real feed publishes and no other test run used: `Q` and two letters from a run-and-counter. */
const code = () => {
  // Made-up codes (676 of them) must not repeat inside a run: a repeat finds a rate an earlier test stored and the request never reaches the stand-in.
  for (;;) {
    const x = (Date.now() + ++n * 7919 + Math.floor(Math.random() * 1_000_000)) % 676;
    const c = `Q${String.fromCharCode(65 + Math.floor(x / 26))}${String.fromCharCode(65 + (x % 26))}`;
    if (!used.has(c)) {
      used.add(c);
      return c;
    }
  }
};

/** The test currencies are made up: the ECB publishes none of them, so the "is it a currency the ECB publishes" check is told yes. */
const yes = async () => true;

const feed = (days: Record<string, Record<string, string>>) =>
  `<?xml version="1.0"?><gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><Cube>${Object.entries(days)
    .map(([day, rates]) => `<Cube time="${day}">${Object.entries(rates).map(([c, r]) => `<Cube currency="${c}" rate="${r}"/>`).join("")}</Cube>`)
    .join("")}</Cube></gesmes:Envelope>`;

function recorder(answer: (url: string) => Response) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    return answer(url);
  };
  return { fn: fn as never, calls };
}

const stored = async (currency: string) =>
  (await db().execute<Row>(sql`select rate_date::text as d, rate::text as r from commerce.ecb_reference_rates where currency = ${currency} order by rate_date`)).map((r) => [String(r.d), String(r.r)]);

describe("the daily job", () => {
  it("stores the days it does not have, never replaces a stored day (a difference is only counted) and asks only the ECB", async () => {
    const fresh = code();
    const known = code();
    await db().execute(sql`insert into commerce.ecb_reference_rates (rate_date, currency, rate) values ('2026-09-30', ${known}, 5.5)`);
    const rec = recorder(() =>
      new Response(feed({ "2026-10-02": { [fresh]: "2.5", [known]: "5.6" }, "2026-09-30": { [fresh]: "2.4", [known]: "5.7" } })),
    );
    const result = await storeEcbRates({ fetch: rec.fn });
    expect(result.ok).toBe(true);
    expect(result.differing).toBeGreaterThanOrEqual(1);
    expect(rec.calls).toEqual([ECB_HIST_90D_URL]);
    expect(rec.calls.every(isEcbUrl)).toBe(true);
    expect(await stored(fresh)).toEqual([["2026-09-30", "2.400000"], ["2026-10-02", "2.500000"]]);
    // The stored day of the other currency is as it was; the day that was absent was added.
    expect(await stored(known)).toEqual([["2026-09-30", "5.500000"], ["2026-10-02", "5.600000"]]);

    // The same feed again changes nothing.
    const again = await storeEcbRates({ fetch: rec.fn });
    expect(again).toMatchObject({ ok: true, inserted: 0 });
    expect(await stored(fresh)).toHaveLength(2);
  });

  it("changes nothing and never throws when the ECB is down, answers with a page that is not the feed, or the connection fails", async () => {
    const before = Number((await db().execute<Row>(sql`select count(*)::int as n from commerce.ecb_reference_rates`))[0].n);
    for (const fetcher of [
      recorder(() => new Response("maintenance", { status: 503 })).fn,
      recorder(() => new Response("<html>not a feed</html>")).fn,
      (async () => {
        throw new Error("ECONNRESET");
      }) as never,
    ]) {
      expect(await storeEcbRates({ fetch: fetcher })).toEqual({ ok: false, inserted: 0, differing: 0, days: 0 });
    }
    expect(Number((await db().execute<Row>(sql`select count(*)::int as n from commerce.ecb_reference_rates`))[0].n)).toBe(before);
  });

  it("is append-only in the database too: a stored rate cannot be changed or removed", async () => {
    const c = code();
    await db().execute(sql`insert into commerce.ecb_reference_rates (rate_date, currency, rate) values ('2026-09-29', ${c}, 1.5)`);
    await expect(db().execute(sql`update commerce.ecb_reference_rates set rate = 9 where currency = ${c}`)).rejects.toThrow();
    await expect(db().execute(sql`delete from commerce.ecb_reference_rates where currency = ${c}`)).rejects.toThrow();
    expect(await stored(c)).toEqual([["2026-09-29", "1.500000"]]);
  });
});

describe("one day on request", () => {
  const now = new Date("2026-10-04T10:00:00Z");
  const portal = (c: string, rows: [string, string][]) =>
    ["KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS", ...rows.map(([d, r]) => `EXR.D.${c}.EUR.SP00.A,D,${c},EUR,SP00,A,${d},${r},A`)].join("\r\n");

  it("writes the one rate a return needs (the next day of publication's when the day itself had none) and says where from", async () => {
    const c = code();
    // 2026-09-27 is a Sunday: the rate of Monday 28 September is used.
    const rec = recorder(() => new Response(portal(c, [["2026-09-28", "3.3333"], ["2026-09-29", "3.4"]])));
    const result = await fetchRatesForDay(c, "2026-09-27", { fetch: rec.fn, now, isPublished: yes });
    expect(result).toEqual({ ok: true, rate: "3.3333", date: "2026-09-28", already: false });
    expect(await stored(c)).toEqual([["2026-09-28", "3.333300"]]);
    expect(rec.calls.every(isEcbUrl)).toBe(true);
    // A second request finds it stored and asks nobody.
    const quiet = recorder(() => new Response("never", { status: 500 }));
    expect(await fetchRatesForDay(c, "2026-09-27", { fetch: quiet.fn, now, isPublished: yes })).toEqual({ ok: true, rate: "3.3333", date: "2026-09-28", already: true });
    expect(quiet.calls).toEqual([]);
  });

  it("refuses a day that has not come, a currency the ECB does not publish, a day before the schemes and a day not yet published; unavailable when nothing answers", async () => {
    const c = code();
    const rec = recorder(() => new Response(portal(c, [])));
    expect(await fetchRatesForDay(c, "2026-10-05", { fetch: rec.fn, now, isPublished: yes })).toMatchObject({ ok: false, reason: "future" });
    expect(await fetchRatesForDay("EUR", "2026-09-30", { fetch: rec.fn, now, isPublished: yes })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await fetchRatesForDay("dkk; drop table", "2026-09-30", { fetch: rec.fn, now, isPublished: yes })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await fetchRatesForDay(c, "2021-06-30", { fetch: rec.fn, now, isPublished: yes })).toMatchObject({ ok: false, reason: "invalid" });
    expect(rec.calls).toEqual([]);
    // Today, before the ECB published: the portal has no row and neither has the feed.
    const empty = recorder((url) => new Response(url.includes("hist") ? feed({ "2026-10-02": { [c]: "1.1" } }) : portal(c, [])));
    expect(await fetchRatesForDay(c, "2026-10-04", { fetch: empty.fn, now, isPublished: yes })).toMatchObject({ ok: false, reason: "not_published" });
    expect(await stored(c)).toEqual([]);
    const down = recorder(() => new Response("down", { status: 503 }));
    expect(await fetchRatesForDay(c, "2026-09-30", { fetch: down.fn, now, isPublished: yes })).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("is the owner's: an admin is refused and nothing is asked; the owner's fetch is audit-logged once", async () => {
    const own = await fx.makeStore("ecb-owner");
    const owner = await fx.ownerOf(own, "owner");
    const admin = await fx.ownerOf(own, "admin");
    const c = code();
    const rec = recorder(() => new Response(portal(c, [["2026-09-30", "4.4"]])));
    expect(await fetchRateForOwner(admin, { currency: c, day: "2026-09-30" }, { fetch: rec.fn, now, isPublished: yes })).toMatchObject({ ok: false, reason: "forbidden" });
    expect(rec.calls).toEqual([]);
    expect(await fetchRateForOwner(owner, { currency: c, day: "not a day" }, { fetch: rec.fn, now, isPublished: yes })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await fetchRateForOwner(owner, { currency: c, day: "2026-09-30" }, { fetch: rec.fn, now, isPublished: yes })).toMatchObject({ ok: true, rate: "4.4", already: false });
    expect(await fetchRateForOwner(owner, { currency: c, day: "2026-09-30" }, { fetch: rec.fn, now, isPublished: yes })).toMatchObject({ ok: true, already: true });
    const log = await db().execute<Row>(sql`select details, area from commerce.audit_log where store_id = ${own.storeId}::uuid and action = 'analytics.tax_rate_fetched'`);
    expect(log).toHaveLength(1);
    expect(log[0].area).toBe("analytics");
    expect(log[0].details).toMatchObject({ currency: c, day: "2026-09-30", rate: "4.4" });
  });
});

describe("an owner's request cannot be turned into a stream of downloads from the ECB", () => {
  const now = new Date("2026-10-04T10:00:00Z");
  const portal = (c: string, rows: [string, string][]) =>
    ["KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS", ...rows.map(([d, r]) => `EXR.D.${c}.EUR.SP00.A,D,${c},EUR,SP00,A,${d},${r},A`)].join("\r\n");

  it("asks the ECB for nothing when the code is not a currency it publishes (no portal call, no 8 MB history)", async () => {
    // The finding: currency=ZZZ for an old day failed at the portal, skipped the 90-day feed and downloaded eurofxref-hist.xml, every time.
    const rec = recorder(() => new Response("never", { status: 500 }));
    for (const bad of ["ZZZ", "XXX", "ABC"]) expect(await fetchRatesForDay(bad, "2021-08-02", { fetch: rec.fn, now })).toMatchObject({ ok: false, reason: "invalid" });
    expect(rec.calls).toEqual([]);
  });

  it("still serves a currency the ECB added after the list was written, once the daily job has stored a rate for it", async () => {
    const c = code();
    await db().execute(sql`insert into commerce.ecb_reference_rates (rate_date, currency, rate) values ('2026-09-01', ${c}, 2.5)`);
    const rec = recorder(() => new Response(portal(c, [["2026-09-02", "2.6"]])));
    expect(await fetchRatesForDay(c, "2026-09-02", { fetch: rec.fn, now })).toMatchObject({ ok: true, rate: "2.6", already: false });
  });

  it("allows a store a few requests an hour, then refuses without calling the ECB, and a stored rate or an invalid request costs none", async () => {
    const own = await fx.makeStore("ecb-limit");
    const owner = await fx.ownerOf(own, "owner");
    const c = code();
    const rec = recorder(() => new Response(portal(c, [["2026-09-30", "4.4"]])));
    // A request that never reaches the ECB takes no slot.
    for (let i = 0; i < ECB_LIMIT_PER_STORE_PER_HOUR + 3; i += 1) expect(await fetchRateForOwner(owner, { currency: c, day: "2026-10-05" }, { fetch: rec.fn, now, isPublished: yes })).toMatchObject({ reason: "future" });
    expect(await fetchRateForOwner(owner, { currency: c, day: "2026-09-30" }, { fetch: rec.fn, now, isPublished: yes })).toMatchObject({ ok: true });
    expect(await fetchRateForOwner(owner, { currency: c, day: "2026-09-30" }, { fetch: rec.fn, now, isPublished: yes })).toMatchObject({ ok: true, already: true });
    expect(rec.calls.length).toBeGreaterThan(0);
    const before = rec.calls.length;
    // Use up the rest of the hour for this store; the next request that would call the ECB is refused and calls nobody.
    for (let i = 0; i < ECB_LIMIT_PER_STORE_PER_HOUR; i += 1) await takeEcbSlot(own.storeId);
    const other = code();
    const refused = await fetchRateForOwner(owner, { currency: other, day: "2026-09-29" }, { fetch: rec.fn, now, isPublished: yes });
    expect(refused).toMatchObject({ ok: false, reason: "limit" });
    expect(rec.calls.length).toBe(before);
    // Another store has its own count.
    const second = await fx.makeStore("ecb-limit-2");
    expect(await takeEcbSlot(second.storeId)).toBe(true);
  });

  it("also bounds every store together, because they share one address towards the ECB, and resets with the hour", async () => {
    const own = await fx.makeStore("ecb-limit-all");
    const bucket = "ecb:fetch";
    const readGlobal = async () => Number((await db().execute<Row>(sql`select coalesce(sum(count), 0)::int as n from commerce.chat_usage where store_id is null and bucket = ${bucket} and "window" = date_trunc('hour', now())`))[0].n);
    const before = await readGlobal();
    try {
      await db().execute(sql`
        insert into commerce.chat_usage (store_id, bucket, "window", count) values (null, ${bucket}, date_trunc('hour', now()), ${ECB_LIMIT_ALL_STORES_PER_HOUR - 1})
        on conflict (store_id, bucket, "window") do update set count = ${ECB_LIMIT_ALL_STORES_PER_HOUR - 1}
      `);
      expect(await takeEcbSlot(own.storeId)).toBe(true);
      expect(await takeEcbSlot(own.storeId)).toBe(false);
    } finally {
      await db().execute(sql`delete from commerce.chat_usage where store_id is null and bucket = ${bucket}`);
      if (before > 0) await db().execute(sql`insert into commerce.chat_usage (store_id, bucket, "window", count) values (null, ${bucket}, date_trunc('hour', now()), ${before})`);
    }
  });
});

describe("the owner's own rate", () => {
  it("needs an owner, a reason of at least ten characters and a day that has passed; an upsert with the old and new rate in the audit log", async () => {
    const own = await fx.makeStore("ecb-override");
    const owner = await fx.ownerOf(own, "owner");
    const admin = await fx.ownerOf(own, "admin");
    const c = code();
    const input = { currency: c, day: "2026-09-30", rate: "7.5", reason: "My accountant's rate for this quarter" };
    expect(await setRateOverride(admin, input)).toMatchObject({ ok: false });
    expect(await setRateOverride(owner, { ...input, reason: "too short" })).toMatchObject({ ok: false });
    expect(await setRateOverride(owner, { ...input, rate: "0" })).toMatchObject({ ok: false });
    expect(await setRateOverride(owner, { ...input, rate: "1.1234567" })).toMatchObject({ ok: false });
    expect(await setRateOverride(owner, { ...input, currency: "EUR" })).toMatchObject({ ok: false });
    expect(await setRateOverride(owner, { ...input, day: "2021-06-30" })).toMatchObject({ ok: false });
    expect(await setRateOverride(owner, { ...input, day: "2999-01-01" })).toMatchObject({ ok: false });
    expect(await listOverrides(own.storeId)).toEqual([]);

    expect(await setRateOverride(owner, input)).toEqual({ ok: true, currency: c, day: "2026-09-30", rate: "7.5", previous: null });
    expect(await setRateOverride(owner, { ...input, rate: "7,4755", reason: "Corrected to the ECB's published rate" })).toEqual({ ok: true, currency: c, day: "2026-09-30", rate: "7.4755", previous: "7.5" });
    const [row] = await listOverrides(own.storeId);
    expect(row).toMatchObject({ currency: c, day: "2026-09-30", rate: "7.4755", reason: "Corrected to the ECB's published rate" });
    const log = await db().execute<Row>(sql`select details, area from commerce.audit_log where store_id = ${own.storeId}::uuid and action = 'analytics.tax_rate_override_set' order by created_at`);
    expect(log.map((l) => l.details)).toEqual([
      { currency: c, day: "2026-09-30", previous: null, rate: "7.5" },
      { currency: c, day: "2026-09-30", previous: "7.5", rate: "7.4755" },
    ]);
    expect(log.every((l) => l.area === "analytics")).toBe(true);
  });

  it("is that store's alone: another store's lookup does not see it", async () => {
    const a = await fx.makeStore("ecb-own-a");
    const b = await fx.makeStore("ecb-own-b");
    const c = code();
    await setRateOverride(await fx.ownerOf(a), { currency: c, day: "2026-09-30", rate: "6.5", reason: "Store A's own agreed rate" });
    expect(await listOverrides(b.storeId)).toEqual([]);
    expect(await overridesFor(b.storeId, [c], "2026-09-30", "2026-09-30")).toEqual([]);
    const mine = await rateLookup(a.storeId, [{ currency: c, day: "2026-09-30" }]);
    const theirs = await rateLookup(b.storeId, [{ currency: c, day: "2026-09-30" }]);
    expect(mine(c, "2026-09-30")).toEqual({ rate: "6.5", date: "2026-09-30", source: "owner", reason: "Store A's own agreed rate" });
    expect(theirs(c, "2026-09-30")).toBeNull();
  });
});

describe("the lookup a return reads", () => {
  it("takes the owner's rate first, else the day's, else the next day of publication's, else nothing; the euro is never asked for", async () => {
    const own = await fx.makeStore("ecb-lookup");
    const c = code();
    const d = code();
    await db().execute(sql`
      insert into commerce.ecb_reference_rates (rate_date, currency, rate) values
        ('2026-09-30', ${c}, 7.4755), ('2026-12-31', ${c}, 7.4), ('2027-01-04', ${c}, 7.45), ('2026-09-30', ${d}, 2)
    `);
    await setRateOverride(await fx.ownerOf(own), { currency: d, day: "2026-09-30", rate: "2.25", reason: "Agreed with the accountant" });
    const look = await rateLookup(own.storeId, [
      { currency: c, day: "2026-09-30" },
      { currency: c, day: "2026-12-31" },
      { currency: c, day: "2027-01-01" },
      { currency: d, day: "2026-09-30" },
      { currency: c, day: "2026-11-30" },
      { currency: "EUR", day: "2026-09-30" },
    ]);
    expect(look(c, "2026-09-30")).toEqual({ rate: "7.4755", date: "2026-09-30", source: "ecb", reason: null });
    // 1 January is a TARGET closing day: the first publication after it is Monday 4 January (2027-01-01 is a Friday, 2 and 3 a weekend).
    expect(look(c, "2027-01-01")).toEqual({ rate: "7.45", date: "2027-01-04", source: "ecb", reason: null });
    expect(look(d, "2026-09-30")).toEqual({ rate: "2.25", date: "2026-09-30", source: "owner", reason: "Agreed with the accountant" });
    // 30 November has no stored day, and the next publication day's is not stored either: nothing, never an old or today's rate.
    expect(look(c, "2026-11-30")).toBeNull();
    expect(look("EUR", "2026-09-30")).toBeNull();
    expect((await rateLookup(own.storeId, [{ currency: "EUR", day: "2026-09-30" }]))("DKK", "2026-09-30")).toBeNull();
  });

  it("formats a stored rate as the ECB wrote it", async () => {
    expect(plainRate("7.475500")).toBe("7.4755");
    expect(plainRate("10.000000")).toBe("10");
    expect(plainRate("11")).toBe("11");
    const c = code();
    await db().execute(sql`insert into commerce.ecb_reference_rates (rate_date, currency, rate) values ('2026-09-30', ${c}, 7.4755)`);
    expect(await storedRates([c], "2026-09-30", "2026-09-30")).toEqual([{ date: "2026-09-30", currency: c, rate: "7.4755" }]);
  });
});
