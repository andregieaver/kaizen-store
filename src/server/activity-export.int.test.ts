import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import { addMember, auditRows, makeAccount, makeStore, membershipOf } from "./trust-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const act = await import("./activity");

type Row = Record<string, unknown>;

/**
 * The owner's CSV of the activity log (wave 1, 1f, docs/wave-1-trust.md 2.9): owners only, a period required, never more than 50,000 entries
 * (refused, not cut short), cells that start with `=`, `+`, `-` or `@` made harmless, the export itself written down, and never another
 * store's entries.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
let other: Awaited<ReturnType<typeof makeStore>>;
let owner: Awaited<ReturnType<typeof membershipOf>>;
let evil: Awaited<ReturnType<typeof makeAccount>>;

beforeAll(async () => {
  store = await makeStore("export");
  other = await makeStore("export2");
  owner = await membershipOf(store.slug, store.account, "owner");
  const account = `+plus-${Date.now()}@example.com`;
  const [row] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${account}, '=SUM(1+1)') returning id, email, name, platform_admin`);
  evil = { id: String(row.id), email: String(row.email), name: String(row.name), platformAdmin: false };
  await addMember(store.id, evil.id, "admin");
  const put = (storeId: string, accountId: string, action: string, at: string, targetId: string, label: string, changes?: unknown) =>
    db().execute(sql`
      insert into commerce.audit_log (store_id, account_id, action, details, area, target_type, target_id, changes, created_at)
      values (${storeId}::uuid, ${accountId}::uuid, ${action}, ${JSON.stringify({ label })}::jsonb, 'products', 'product', ${targetId}, ${changes ? JSON.stringify(changes) : null}::jsonb, ${at}::timestamptz)
    `);
  await put(store.id, evil.id, "product.updated", "2026-05-02T08:30:00Z", "=1+1", "Demo", { title: { from: "=A1", to: "@B2" } });
  await put(store.id, store.account.id, "product.created", "2026-05-03T08:30:00Z", "-5+3", "Lamp, \"big\"\nnew");
  await put(store.id, store.account.id, "product.archived", "2026-05-04T08:30:00Z", "@evil", "Old");
  await put(store.id, store.account.id, "product.updated", "2026-06-20T08:30:00Z", "p9", "Outside the period");
  await put(other.id, other.account.id, "product.updated", "2026-05-02T09:00:00Z", "foreign", "OTHER STORE");
});

afterAll(async () => {
  await closeDb();
});

const csvRows = (csv: string) => csv.trimEnd().split("\r\n");

describe("the owner's download", () => {
  it("is a CSV of the period with a header, in UTC and the store's zone, and holds the person, area, action, target, sentence and changes", async () => {
    const result = await act.exportActivity(owner, { from: "2026-05-01", to: "2026-05-31" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toBe(3);
    const lines = csvRows(result.csv);
    expect(lines[0]).toBe("Time (UTC),Time (Europe/Oslo),Person,Area,Action,Target type,Target id,What happened,Changes");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain("2026-05-02T08:30:00.000Z");
    expect(lines[1]).toContain("2026-05-02 10:30:00"); // Oslo, summer time
    expect(lines[1]).toContain("product.updated");
    expect(result.csv).not.toContain("OTHER STORE");
    expect(result.csv).not.toContain("Outside the period");
  });

  it("makes a cell that starts with = + - or @ harmless, and quotes what holds a comma, a quote or a line break", async () => {
    const result = await act.exportActivity(owner, { from: "2026-05-01", to: "2026-05-31" });
    if (!result.ok) throw new Error("export");
    // The person's email starts with "+", their target id with "=".
    expect(result.csv).toContain(`'+plus-`);
    expect(result.csv).toContain("'=1+1");
    expect(result.csv).toContain("'-5+3");
    expect(result.csv).toContain("'@evil");
    // Nothing starts a cell with a formula character.
    for (const line of csvRows(result.csv).slice(1)) {
      for (const cell of line.match(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g) ?? []) {
        const text = cell.replace(/^,/, "").replace(/^"/, "");
        expect(/^[=+\-@]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)).toBe(false);
      }
    }
    // The sentence holds the label with its comma and line break, quoted.
    expect(result.csv).toContain('"Created the product Lamp, ""big""\nnew"');
  });

  it("needs a period, in order, and says what it needs", async () => {
    expect(await act.exportActivity(owner, {})).toEqual({ ok: false, problem: "Choose the first and last day to download." });
    expect(await act.exportActivity(owner, { from: "2026-05-01" })).toMatchObject({ ok: false });
    expect(await act.exportActivity(owner, { from: "not a date", to: "2026-05-01" })).toMatchObject({ ok: false });
    expect(await act.exportActivity(owner, { from: "2026-06-01", to: "2026-05-01" })).toEqual({ ok: false, problem: "The first day must not be after the last day." });
  });

  it("is for owners only: an admin is refused, and no entry is written for the attempt", async () => {
    const admin = await makeAccount("export-admin");
    await addMember(store.id, admin.id, "admin");
    const member = await membershipOf(store.slug, admin, "admin");
    const before = (await auditRows(store.id, "activity.exported")).length;
    expect(await act.exportActivity(member, { from: "2026-05-01", to: "2026-05-31" })).toEqual({ ok: false, problem: "Only an owner can download the activity log." });
    expect((await auditRows(store.id, "activity.exported")).length).toBe(before);
  });

  it("writes itself down: who exported which days and how many entries", async () => {
    await act.exportActivity(owner, { from: "2026-05-01", to: "2026-05-31" });
    const log = (await auditRows(store.id, "activity.exported")).at(-1)!;
    expect(log).toMatchObject({ account_id: store.account.id, area: "staff", details: { from: "2026-05-01", to: "2026-05-31", rows: 3 } });
  });

  it("never shows another store's entries, even from its owner's session", async () => {
    const foreign = await membershipOf(other.slug, other.account, "owner");
    const result = await act.exportActivity(foreign, { from: "2026-05-01", to: "2026-05-31" });
    if (!result.ok) throw new Error("export");
    expect(result.csv).toContain("OTHER STORE");
    expect(result.csv).not.toContain("1+1");
  });

  it("refuses a period of more than 50,000 entries instead of cutting it short", async () => {
    const big = await makeStore("export-big");
    const member = await membershipOf(big.slug, big.account, "owner");
    await db().execute(sql`
      insert into commerce.audit_log (store_id, account_id, action, details, area, created_at)
      select ${big.id}::uuid, ${big.account.id}::uuid, 'discount.created', '{}'::jsonb, 'marketing', '2026-02-01T00:00:00Z'::timestamptz + (g || ' seconds')::interval
      from generate_series(1, ${act.EXPORT_MAX_ROWS + 1}) g
    `);
    const refused = await act.exportActivity(member, { from: "2026-02-01", to: "2026-02-02" });
    expect(refused).toMatchObject({ ok: false, problem: expect.stringContaining("Choose a shorter period") });
    // A period that fits is served in full.
    const [row] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${big.id}::uuid and created_at < '2026-02-01T00:00:10Z'`);
    expect(row.n).toBeGreaterThan(0);
  });
});
