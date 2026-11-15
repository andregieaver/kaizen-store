import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {}, revalidateTag: () => {} }));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const { forgetLimitMemos, usageNow } = await import("./limits");
const { forgetAiAbilities } = await import("./ai");
const { makeStore, membershipOf } = await import("./trust-fixtures");
const { getStore } = await import("./stores");

type Row = Record<string, unknown>;
let store: Awaited<ReturnType<typeof makeStore>>;

/** A store override of one limit at what the store uses now plus `room`. */
async function cap(key: string, room = 0): Promise<void> {
  forgetLimitMemos();
  const used = key === "stores_owned" ? 0 : await usageNow(store.id, key as Parameters<typeof usageNow>[1]);
  await db().execute(sql`
    insert into commerce.limit_overrides (store_id, key, value, reason) values (${store.id}::uuid, ${key}, ${used + room}, 'Test')
    on conflict (store_id, account_id, key) do update set value = excluded.value`);
  forgetLimitMemos();
  forgetAiAbilities();
}

beforeAll(async () => {
  store = await makeStore("enforce");
});

beforeEach(async () => {
  await db().execute(sql`delete from commerce.limit_overrides where store_id = ${store.id}::uuid or account_id = ${store.account.id}::uuid`);
  forgetLimitMemos();
  forgetAiAbilities();
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.limit_overrides where store_id = ${store.id}::uuid or account_id = ${store.account.id}::uuid`);
  await closeDb();
});

describe("the product limit", () => {
  it("refuses a new product at the limit, and still saves one that already counts", async () => {
    const { getEditorContext, getProductForEdit, saveProduct } = await import("./products");
    const shop = (await getStore(store.slug))!;
    const editor = await getEditorContext(shop);
    const [existing] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${store.id}::uuid and status <> 'archived' and kind = 'goods' order by created_at limit 1`);
    const input = (await getProductForEdit(shop, editor, String(existing.id)))!;
    await cap("products");
    const copy = { ...input, handle: `${input.handle}-again`, variants: input.variants.map((v) => ({ ...v, id: null, sku: `${v.sku}-again` })) };
    const refused = await saveProduct(shop, editor, null, copy as typeof input);
    expect(refused).toMatchObject({ ok: false });
    expect(refused.ok ? "" : refused.problems.join(" ")).toMatch(/products/);
    expect(await saveProduct(shop, editor, String(existing.id), input)).toMatchObject({ ok: true });
  });
});

describe("the staff limit", () => {
  it("refuses an invitation past the store's places", async () => {
    const settings = await import("./settings");
    const member = await membershipOf(store.slug, store.account);
    await cap("staff_seats");
    const result = await settings.inviteStaff(member, `seat-${store.slug}@example.com`, "admin");
    expect(result).toMatchObject({ ok: false });
    await cap("staff_seats", 1);
    expect(await settings.inviteStaff(member, `seat-${store.slug}@example.com`, "admin")).toEqual({ ok: true });
  });
});

describe("the store limit", () => {
  it("refuses another store past the owner's limit", async () => {
    const platform = await import("./platform");
    await db().execute(sql`insert into commerce.limit_overrides (account_id, key, value, reason) values (${store.account.id}::uuid, 'stores_owned', 1, 'Test')`);
    const made = await platform.createStoreForOwner(store.account, "Second", `${store.slug}-second`);
    expect(made).toMatchObject({ ok: false });
    expect(made.ok ? "" : made.problems.join(" ")).toMatch(/1 stores/);
  });
});

describe("storage", () => {
  it("refuses a person's upload past the limit, never Kaizena Flow's own", async () => {
    const { storageRefusal } = await import("./limits");
    await cap("storage_bytes", 1000);
    expect(await storageRefusal(store.id, 500)).toBeNull();
    expect(await storageRefusal(store.id, 5000)).toMatch(/storage/);
    expect(await storageRefusal(null, 10 ** 12)).toBeNull();
    expect(await storageRefusal("platform", 10 ** 12)).toBeNull();
  });
});

describe("AI on Kaizena Flow's key", () => {
  it("is no AI for the month at the limit, and only for that store", async () => {
    const ai = await import("./ai");
    const [had] = await db().execute<Row>(sql`select count(*)::int as n from commerce.ai_providers where store_id is null and enabled`);
    if (Number(had.n) === 0) {
      await db().execute(sql`insert into commerce.ai_providers (store_id, provider, base_url, enabled, text_model) values (null, 'openai', null, true, 'text-a')`).catch(() => undefined);
    }
    const before = await ai.aiFor(store.id, { feature: "search" });
    await db().execute(sql`insert into commerce.limit_overrides (store_id, key, value, reason) values (${store.id}::uuid, 'ai_cost_month_micros', 0, 'Test')`);
    forgetLimitMemos();
    forgetAiAbilities();
    if (before?.source === "platform") expect(await ai.aiFor(store.id, { feature: "search" })).toBeNull();
    expect(await ai.aiFor(null, { feature: "search" })).toEqual(before ? expect.objectContaining({ source: before.source }) : null);
  });

  describe("the month's cost is the measured days plus a live part (bloat review 0.21)", () => {
    const provider = `enforce-cost-${Date.now().toString(36)}`;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const dayOf = (offset: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset)).toISOString().slice(0, 10);
    const monthStart = `${today.slice(0, 7)}-01`;
    // Up to three past days of this month (none on the 1st): the cases then hold on today alone.
    const past = [dayOf(-3), dayOf(-2), dayOf(-1)].filter((day) => day >= monthStart);
    const yesterday = dayOf(-1);

    /** One call on Kaizena Flow's key at `at`, priced by the test's model. */
    const call = (at: string, input: number) =>
      db().execute(sql`
        insert into commerce.ai_usage (created_at, store_id, source, provider, model, kind, feature, input_tokens, output_tokens)
        values (${at}::timestamptz, ${store.id}::uuid, 'platform', ${provider}, 'priced', 'text', 'search', ${input}, ${input / 2})
      `);
    /** What the whole-month sum gives, as the limit read it before. */
    const wholeMonth = async () => {
      const { aiCostSql: whole } = await import("./usage-sql");
      const [row] = await db().execute<Row>(whole(new Date(`${monthStart}T00:00:00Z`), now, store.id));
      return Number(row?.value ?? 0);
    };
    const monthNow = async () => {
      forgetLimitMemos();
      return usageNow(store.id, "ai_cost_month_micros", now);
    };

    beforeAll(async () => {
      await db().execute(sql`
        insert into commerce.ai_model_prices (provider, model, input_per_million, output_per_million, effective_from)
        values (${provider}, 'priced', 3, 9, '2000-01-01')
      `);
      for (const [i, day] of past.entries()) await call(`${day}T12:00:00Z`, 1_000_000 * (i + 1));
      // At midnight UTC today, so the call is today's and before `now` whenever the test runs.
      await call(`${today}T00:00:00Z`, 500_000);
    });

    afterAll(async () => {
      await db().execute(sql`delete from commerce.ai_usage where provider = ${provider}`);
      await db().execute(sql`delete from commerce.ai_model_prices where provider = ${provider}`);
      await db().execute(sql`delete from commerce.store_usage_daily where store_id = ${store.id}::uuid and metric = 'ai_cost_micros'`);
    });

    it("equals the whole month with every past day measured", async () => {
      const { measureDay } = await import("./usage-meter");
      for (const day of past) await measureDay(day, false);
      const expected = await wholeMonth();
      expect(expected).toBeGreaterThan(0);
      expect(await monthNow()).toBe(expected);
    });

    it("equals the whole month with yesterday not measured", async () => {
      if (past.includes(yesterday)) {
        await db().execute(sql`delete from commerce.store_usage_daily where store_id = ${store.id}::uuid and metric = 'ai_cost_micros' and day = ${yesterday}::date`);
      }
      expect(await monthNow()).toBe(await wholeMonth());
    });

    it("never counts today's partial row, nor a past day measured while it was going", async () => {
      const { measureDay } = await import("./usage-meter");
      for (const day of past) await measureDay(day, false);
      await measureDay(today, true);
      await call(`${today}T00:00:00Z`, 250_000);
      const expected = await wholeMonth();
      expect(await monthNow()).toBe(expected);
      if (past.includes(yesterday)) {
        // Yesterday measured at noon (the night's run not yet come): a partial row, so the live part covers yesterday again in full.
        await db().execute(sql`
          update commerce.store_usage_daily set value = 1, updated_at = ${`${yesterday}T12:00:00Z`}::timestamptz
          where store_id = ${store.id}::uuid and metric = 'ai_cost_micros' and day = ${yesterday}::date
        `);
        expect(await monthNow()).toBe(expected);
      }
    });
  });
});
