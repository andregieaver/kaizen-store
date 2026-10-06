import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/db/client";
import { orderColumns } from "@/lib/order-csv";
import { parseCsv, writeCsv, type Cell } from "@/lib/csv";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

const { orderExportReader } = await import("./order-export");
const { getStore } = await import("./stores");
const { newPlainStore, seedOrder } = await import("./order-ops-fixture");

type Profile = "accounting" | "full";

/**
 * What wave 3's second run added to the order file (D173, `docs/wave-3-orders.md` 5.5, `docs/analytics.md`): tags, archived, source and the order's gift in both profiles, and
 * the gift's words (a third party's name and a message) in the Full profile only, none of it for an erased person's order, a message that begins with a formula kept as text.
 * The reader is `orderExportReader()` itself, the one the export job runs.
 */

afterAll(async () => {
  await closeDb();
});

async function fileOf(slug: string, profile: Profile, layout: "lines" | "orders" = "orders") {
  const store = (await getStore(slug))!;
  const reader = await orderExportReader(store, { mode: "range", from: "2020-01-01", to: "2099-12-31", which: "all", layout, profile, copied: true, dialect: "standard" });
  const read = await reader.read(null, 1000);
  const rows: Cell[][] = read.rows;
  const header = reader.header;
  const objects = rows.map((row) => Object.fromEntries(header.map((h, i) => [h, row[i]]))) as Record<string, Cell>[];
  return { header, objects, text: writeCsv([header, ...rows], "standard") };
}

async function seeded(label: string) {
  const store = await newPlainStore(label);
  const tagged = await seedOrder(store, { captured: true, tags: ["VIP", "=1+1"], archived: true, status: "fulfilled" });
  const gifted = await seedOrder(store, { captured: true, gift: { to: "Mormor", from: "Kari", message: "=cmd|' /C calc'!A0" } });
  const staff = await seedOrder(store, { captured: true, draft: { accountId: store.accountId } });
  const copied = await seedOrder(store, { copied: true, tags: ["history"] });
  const erased = await seedOrder(store, { captured: true, restricted: true, tags: ["calls on Fridays"], gift: { to: "Elin", from: "Per", message: "Private words" } });
  const plain = await seedOrder(store, { captured: true });
  return { store, tagged, gifted, staff, copied, erased, plain };
}

describe("the order file's new columns", () => {
  it("has tags, archived, source and gift_order in the Accounting profile, and the gift's words only in the Full one, in the contract's header", async () => {
    const { store } = await seeded("exp-ops-header");
    const accounting = await fileOf(store.slug, "accounting");
    const full = await fileOf(store.slug, "full");
    expect(accounting.header).toEqual(orderColumns("orders", "accounting"));
    expect(full.header).toEqual(orderColumns("orders", "full"));
    for (const c of ["tags", "archived", "source", "gift_order"]) expect(accounting.header).toContain(c);
    for (const c of ["gift_to", "gift_from", "gift_message"]) {
      expect(accounting.header).not.toContain(c);
      expect(full.header).toContain(c);
    }
    // Not a word of the gift in the accounting file, whatever the order.
    expect(accounting.text).not.toMatch(/Mormor|calc|Private words/);
  });

  it("says each order's tags, archive, source and gift as the store has them, and copied history as copied", async () => {
    const { store, tagged, gifted, staff, copied, plain } = await seeded("exp-ops-values");
    const { objects } = await fileOf(store.slug, "accounting");
    const of = (number: string) => objects.find((o) => o.order_number === number)!;
    expect(of(tagged.number)).toMatchObject({ tags: "=1+1, VIP", archived: "true", source: "checkout", gift_order: "false" });
    expect(of(gifted.number)).toMatchObject({ tags: null, archived: "false", gift_order: "true" });
    expect(of(staff.number)).toMatchObject({ source: "draft", archived: "false" });
    expect(of(copied.number)).toMatchObject({ source: "copied", tags: "history", copied: "true" });
    expect(of(plain.number)).toMatchObject({ tags: null, archived: "false", source: "checkout", gift_order: "false" });
  });

  it("gives the gift's words in the Full profile, and writes a message that begins with a formula as text, never as a formula", async () => {
    const { store, gifted } = await seeded("exp-ops-gift");
    const { objects, text } = await fileOf(store.slug, "full");
    expect(objects.find((o) => o.order_number === gifted.number)).toMatchObject({ gift_to: "Mormor", gift_from: "Kari", gift_message: "=cmd|' /C calc'!A0" });
    // The writer escapes the cell in the file itself (OWASP): no cell of the file starts with a formula character.
    const rows = parseCsv(text).rows;
    const header = rows[0];
    const written = rows.slice(1).find((r) => r[header.indexOf("order_number")] === gifted.number)![header.indexOf("gift_message")];
    expect(written.startsWith("=")).toBe(false);
    expect(written).toContain("cmd|");
    for (const row of rows.slice(1)) for (const cell of row) expect(/^[=+@\t\r]/.test(cell), cell).toBe(false);
  });

  it("carries nothing a person typed of an erased person's order, in either profile: no tag, no gift word, and the flags stay", async () => {
    const { store, erased } = await seeded("exp-ops-erased");
    for (const profile of ["accounting", "full"] as const) {
      const { objects, text } = await fileOf(store.slug, profile);
      const row = objects.find((o) => o.order_number === erased.number)!;
      expect(row.tags, profile).toBe("[removed]");
      expect(row.gift_order).toBe("true");
      if (profile === "full") expect([row.gift_to, row.gift_from, row.gift_message]).toEqual(["[removed]", "[removed]", "[removed]"]);
      expect(text).not.toMatch(/calls on Fridays|Elin|Private words/);
    }
  });

  it("is the same in the lines layout: the order's columns on every line's row", async () => {
    const store = await newPlainStore("exp-ops-lines");
    const order = await seedOrder(store, { captured: true, tags: ["rush"], lines: [{ title: "A", sku: "A-1" }, { title: "B", sku: "B-1" }] });
    const { objects } = await fileOf(store.slug, "accounting", "lines");
    const rows = objects.filter((o) => o.order_number === order.number);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect([row.tags, row.archived, row.source]).toEqual(["rush", "false", "checkout"]);
  });

  it("never carries another store's tags", async () => {
    const mine = await newPlainStore("exp-ops-mine");
    const theirs = await newPlainStore("exp-ops-theirs");
    await seedOrder(mine, { captured: true, tags: ["mine"] });
    await seedOrder(theirs, { captured: true, tags: ["theirs-only"] });
    const { text } = await fileOf(mine.slug, "accounting");
    expect(text).toContain("mine");
    expect(text).not.toContain("theirs-only");
  });
});
