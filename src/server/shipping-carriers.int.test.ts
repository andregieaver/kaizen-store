import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/db/client";

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

import { carrierContext, getCarrier, listCarriers, removeCarrier, saveCarrier } from "./shipping-carriers";

type Row = Record<string, unknown>;

const tag = Date.now().toString(36);
let storeId: string;
let other: string;
let accountId: string;

const sender = { senderName: "Shop AS", senderStreet: "Lagerveien 2", senderPostalCode: "0150", senderCity: "Oslo" };
const form = (fields: Record<string, string>, countries = ["NO"], environment = "test") => ({ environment, countries, fields });

beforeAll(async () => {
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`ship-${tag}@example.com`}, 'Owner') returning id`);
  accountId = String(account.id);
  const ids: string[] = [];
  for (const slug of [`ship-a-${tag}`, `ship-b-${tag}`]) {
    const [store] = await db().execute<Row>(sql`insert into commerce.stores (slug, name, created_by) values (${slug}, ${slug}, ${accountId}::uuid) returning id`);
    ids.push(String(store.id));
  }
  [storeId, other] = ids;
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.shipping_carriers where store_id in (${storeId}::uuid, ${other}::uuid)`);
  await closeDb();
});

describe("shipping carriers", () => {
  it("saves a store's details, keeping the secret encrypted and showing only its hint", async () => {
    const result = await saveCarrier(accountId, storeId, "bring", form({ customerNumber: "123", apiUid: "me@shop.no", apiKey: "key-abcdef-1234", ...sender }));
    expect(result).toEqual({ ok: true });
    const saved = await getCarrier(storeId, "bring");
    expect(saved).toMatchObject({ carrier: "bring", environment: "test", complete: true, countries: ["NO"], details: { customerNumber: "123", apiUid: "me@shop.no", ...sender }, secrets: { apiKey: "…1234" } });
    expect(JSON.stringify(saved)).not.toContain("key-abcdef");
    const [row] = await db().execute<Row>(sql`select secrets_encrypted from commerce.shipping_carriers where store_id = ${storeId}::uuid and carrier = 'bring'`);
    expect(String(row.secrets_encrypted)).not.toContain("key-abcdef");
  });

  it("keeps the saved secret when it is left empty, and replaces it when a new one is given", async () => {
    await saveCarrier(accountId, storeId, "bring", form({ customerNumber: "456", apiUid: "me@shop.no", apiKey: "", ...sender }, ["NO", "SE"], "live"));
    expect(await carrierContext(storeId, "bring")).toEqual({
      storeId,
      environment: "live",
      details: { customerNumber: "456", apiUid: "me@shop.no", ...sender },
      secrets: { apiKey: "key-abcdef-1234" },
    });
    await saveCarrier(accountId, storeId, "bring", form({ customerNumber: "456", apiUid: "me@shop.no", apiKey: "newer-key-9999", ...sender }));
    expect((await carrierContext(storeId, "bring"))!.secrets.apiKey).toBe("newer-key-9999");
    expect((await getCarrier(storeId, "bring"))!.secrets.apiKey).toBe("…9999");
  });

  it("refuses incomplete or unknown input and saves nothing", async () => {
    expect(await saveCarrier(accountId, storeId, "postnord", form({ customerNumber: "", apiKey: "" }))).toMatchObject({ ok: false });
    expect(await getCarrier(storeId, "postnord")).toBeNull();
    expect(await saveCarrier(accountId, storeId, "dhl", form({}))).toEqual({ ok: false, problems: ["Unknown carrier."] });
  });

  it("gives no context for details that are not complete, and keeps each store's own", async () => {
    await saveCarrier(accountId, storeId, "porterbuddy", form({ apiKey: "pb-key-0000" }));
    expect((await carrierContext(storeId, "porterbuddy"))!.secrets).toEqual({ apiKey: "pb-key-0000" });
    expect(await carrierContext(other, "porterbuddy")).toBeNull();
    expect(await listCarriers(other)).toEqual([]);
    expect((await listCarriers(storeId)).map((c) => c.carrier)).toEqual(["bring", "porterbuddy"]);
  });

  it("forgets everything when removed, and its table is private", async () => {
    await removeCarrier(accountId, storeId, "bring");
    expect(await getCarrier(storeId, "bring")).toBeNull();
    const [rls] = await db().execute<Row>(sql`select relrowsecurity from pg_class where relname = 'shipping_carriers' and relnamespace = 'commerce'::regnamespace`);
    expect(rls.relrowsecurity).toBe(true);
  });
});
