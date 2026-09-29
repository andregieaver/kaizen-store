import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { emptyGroup, newField, newRowId, type FieldDef, type FieldGroupInput } from "@/lib/custom-fields";
import { moneyCurrencies } from "@/lib/field-money";
import { mainCurrency } from "@/lib/markets";

import type { Membership } from "./auth";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

vi.mock("next/cache", () => ({
  cacheLife: () => {},
  cacheTag: () => {},
  updateTag: () => {},
  revalidateTag: () => {},
  refresh: () => {},
}));

const fields = await import("./custom-fields");
const { getStore } = await import("./stores");

/**
 * Money in custom fields (D120): entered in a currency the store offers, kept as
 * whole minor units, shown in the market's currency at the store's rates (or in
 * its own when no rate is known), never with a VAT label, and never to the chat.
 */

const run = Date.now().toString(36);
const LOCALES = ["nb-NO", "sv-SE"];
let store: Store;
let member: Membership;
let product: { id: string };

beforeAll(async () => {
  const name = `money-${run}`;
  const [request] = await db().execute<Row>(
    sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'F', 'Penger') returning id`,
  );
  await db().execute<Row>(
    sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Penger', null)`,
  );
  const [owner] = await db().execute<Row>(
    sql`select id, email from commerce.accounts where email = ${`${name}@example.com`}`,
  );
  await db().execute(sql`update commerce.stores set locales = array['nb-NO', 'sv-SE'] where slug = ${name}`);
  const [id] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${name}`);
  // The store converts between kroner and kronor at rates it set; the Danish krone has none.
  await db().execute(sql`
    insert into commerce.store_currencies (store_id, currency, rate, round_to, position)
    values (${String(id.id)}::uuid, 'NOK', 11.5, 1, 0), (${String(id.id)}::uuid, 'SEK', 11.2, 1, 1), (${String(id.id)}::uuid, 'EUR', 1, 1, 2)
  `);
  store = (await getStore(name))!;
  member = {
    account: { id: String(owner.id), email: String(owner.email), name: "F", platformAdmin: false },
    role: "owner",
    store,
  } as Membership;
  const [mine] = await db().execute<Row>(
    sql`select id from commerce.products where store_id = ${store.id}::uuid and status = 'active' order by handle limit 1`,
  );
  product = { id: String(mine.id) };
});

afterAll(async () => {
  await closeDb();
});

const deposit: FieldDef = {
  ...newField("money"),
  id: "f_deposit00001",
  name: "deposit",
  label: "Deposit",
  access: "public",
};
const saveGroup = async (input: Partial<FieldGroupInput> & { fields: FieldDef[] }) =>
  fields.saveFieldGroup(member, {
    ...emptyGroup(),
    name: "Terms",
    slug: `terms-${Math.random().toString(36).slice(2, 8)}`,
    ...input,
  });
const write = async (raw: unknown) => {
  const facts = (await fields.productFacts(db(), store.id, product.id))!;
  return db().transaction((tx) =>
    fields.saveFieldData(tx, store.id, "product", product.id, raw, {
      facts,
      locales: LOCALES,
      main: "nb-NO",
      requireAll: false,
    }),
  );
};
const shown = async (locale: string, lang: string, market: string) =>
  (await fields.shownFieldsFor(store.id, "product", product.id, locale, lang, market)).flatMap((g) => g.fields);

describe("what the store offers", () => {
  it("is its main currency first, then those it can show", () => {
    expect(store.markets.map((m) => m.slug)).toEqual(expect.arrayContaining(["no", "se", "dk"]));
    // The store's first market's currency is its main one (`mainCurrency()`).
    expect(mainCurrency(store)).toBe(store.markets[0].nativeCurrency);
    expect(moneyCurrencies(store)[0]).toBe(mainCurrency(store));
  });

  it("is listed for the editor, main first, once each", async () => {
    const lookups = await fields.fieldLookups(store.id);
    expect(lookups.currencies?.[0]).toBe(mainCurrency(store));
    expect(lookups.currencies).toEqual(expect.arrayContaining(["NOK", "SEK", "DKK", "EUR"]));
    expect(new Set(lookups.currencies).size).toBe(lookups.currencies?.length);
  });
});

describe("a money field on a product", () => {
  beforeAll(async () => {
    expect(await saveGroup({ fields: [deposit] })).toMatchObject({ ok: true });
  });

  it("cannot be switched on for the chat", async () => {
    const result = await saveGroup({
      slug: `chat-${run}`,
      fields: [{ ...deposit, id: "f_deposit00002", name: "deposit_two", chat: true }],
    });
    expect(result).toMatchObject({ ok: false });
    expect((result as { problems: string[] }).problems.join(" ")).toContain("cannot be told by the chat");
  });

  it("is kept as minor units and shown in the market's currency at the store's rates", async () => {
    expect(
      await write({ values: { [deposit.id]: { amountMinor: 50000, currency: "NOK" } }, translations: {} }),
    ).toEqual([]);
    const [row] = await db().execute<Row>(
      sql`select values from commerce.field_values where store_id = ${store.id}::uuid and entity = 'product' and entity_id = ${product.id}::uuid and locale = ''`,
    );
    expect(row.values).toEqual({ [deposit.id]: { amountMinor: 50000, currency: "NOK" } });

    // Norway: as entered. Sweden: kroner to kronor at 11.2 / 11.5. Both with the language's own way of writing, and no VAT label.
    const [inNorway] = await shown("nb-NO", "nb", "no");
    const [inSweden] = await shown("sv-SE", "sv", "se");
    expect(inNorway).toMatchObject({ type: "money", value: { amountMinor: 50000, currency: "NOK" } });
    expect(inNorway.text).toMatch(/500,00/);
    expect(inNorway.text).toMatch(/kr|NOK/);
    expect(inSweden.text).toMatch(/486,96/);
    expect(inSweden.text).toMatch(/kr|SEK/);
    expect(inNorway.text).not.toBe(inSweden.text);
    for (const field of [inNorway, inSweden]) expect(field.text).not.toMatch(/mva|moms|vat/i);
  });

  it("is shown in a currency the shopper chose, when the store can convert to it", async () => {
    const [inEuro] = await shown("nb-NO", "nb", "no-eur");
    expect(inEuro.text).toMatch(/43,48/);
    expect(inEuro.text).toContain("€");
  });

  it("is shown in its own currency where the store has no rate for the market's", async () => {
    const [inDenmark] = await shown("nb-NO", "nb", "dk");
    expect(inDenmark.text).toMatch(/500,00/);
    expect(inDenmark.text).toMatch(/NOK|kr/);
    expect(inDenmark.text).not.toMatch(/DKK/);
  });

  it("is refused in a currency the store does not offer, or that is not one, and nothing is written", async () => {
    const before = await fields.getFieldData(store.id, "product", product.id);
    const notOffered = await write({
      values: { [deposit.id]: { amountMinor: 100, currency: "GBP" } },
      translations: {},
    });
    expect(notOffered.join(" ")).toContain("Deposit: the store does not offer GBP");
    const made = await write({ values: { [deposit.id]: { amountMinor: 100, currency: "XYZ" } }, translations: {} });
    expect(made.join(" ")).toContain("Deposit: Choose a currency.");
    const fraction = await write({ values: { [deposit.id]: { amountMinor: 1.5, currency: "NOK" } }, translations: {} });
    expect(fraction).not.toEqual([]);
    expect(await fields.getFieldData(store.id, "product", product.id)).toEqual(before);
  });

  it("is left out of the chat's details and structured data, and is not a field the AI manager fills in", async () => {
    const groups = await fields.shownFieldsFor(store.id, "product", product.id, "nb-NO", "nb", "no");
    const { chatDetails, structuredProperties } = await import("@/lib/custom-fields");
    expect(chatDetails(groups)).toEqual([]);
    expect(structuredProperties(groups)).toEqual([]);
  });

  it("is taken away by an empty amount", async () => {
    expect(await write({ values: { [deposit.id]: { amountMinor: "", currency: "NOK" } }, translations: {} })).toEqual(
      [],
    );
    expect(await shown("nb-NO", "nb", "no")).toEqual([]);
  });
});

describe("money inside a repeater's rows", () => {
  const cost: FieldDef = { ...newField("money"), id: "f_cost00000001", name: "cost", label: "Cost" };
  const what: FieldDef = { ...newField("text"), id: "f_what00000001", name: "what", label: "What" };
  const list: FieldDef = {
    ...newField("repeater"),
    id: "f_costlist0001",
    name: "costs",
    label: "Costs",
    access: "public",
    subFields: [what, cost],
  };

  beforeAll(async () => {
    expect(await saveGroup({ fields: [list] })).toMatchObject({ ok: true });
  });

  it("is checked against the store's currencies in every row, and shown per market", async () => {
    const rowA = newRowId();
    const rowB = newRowId();
    const rows = (currency: string) => [
      { id: rowA, [what.id]: "Frakt", [cost.id]: { amountMinor: 9900, currency: "NOK" } },
      { id: rowB, [what.id]: "Retur", [cost.id]: { amountMinor: 1000, currency } },
    ];
    const refused = await write({ values: { [list.id]: rows("GBP") }, translations: {} });
    expect(refused.join(" ")).toContain("Costs: the store does not offer GBP");

    expect(
      await write({
        values: { [list.id]: rows("EUR") },
        translations: { "nb-NO": { [list.id]: { [rowA]: { [what.id]: "Frakt" }, [rowB]: { [what.id]: "Retur" } } } },
      }),
    ).toEqual([]);
    const [inSweden] = await shown("sv-SE", "sv", "se");
    const cells = inSweden.rows?.map((row) => row.map((cell) => cell.text)) ?? [];
    expect(cells[0][1]).toMatch(/96,42/); // 99.00 NOK in kronor: 9900 * 11.2 / 11.5 = 9642 öre
    expect(cells[1][1]).toMatch(/112,00/); // 10.00 EUR in kronor
  });
});
