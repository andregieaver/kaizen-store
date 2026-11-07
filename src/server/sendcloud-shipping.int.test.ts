import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

import { checkCarrier } from "./bring-shipping";
import { sendcloudSenders } from "./sendcloud-shipping";
import { carrierContext, getCarrier, saveCarrier } from "./shipping-carriers";

type Row = Record<string, unknown>;

const tag = Date.now().toString(36);
let storeId: string;
let accountId: string;

const form = (fields: Record<string, string>, environment = "test") => ({ environment, countries: ["DE", "FR"], fields });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const addresses = { data: [{ id: 41, name: "Gerda", company_name: "Gerdas Laden", address_line_1: "Hauptstraße", house_number: "12", postal_code: "10115", city: "Berlin", country_code: "DE" }] };

/** A stand-in for Sendcloud's sender addresses; every call it is asked is kept. */
function sendcloud(answer: () => Response) {
  const calls: { url: string; authorization: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), authorization: String((init.headers as Record<string, string>).Authorization ?? "") });
      return answer();
    }),
  );
  return calls;
}

beforeAll(async () => {
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`sendcloud-${tag}@example.com`}, 'Owner') returning id`);
  accountId = String(account.id);
  const [store] = await db().execute<Row>(sql`insert into commerce.stores (slug, name, created_by) values (${`sendcloud-${tag}`}, 'Gerdas Laden', ${accountId}::uuid) returning id`);
  storeId = String(store.id);
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  await db().execute(sql`delete from commerce.shipping_carriers where store_id = ${storeId}::uuid`);
  await closeDb();
});

describe("Sendcloud's connection (D483 step 1)", () => {
  it("is saved with its two keys, the secret encrypted, before a sender address is chosen", async () => {
    expect(await sendcloudSenders(storeId)).toBeNull();
    expect(await saveCarrier(accountId, storeId, "sendcloud", form({ publicKey: "pub-key", secretKey: "secret-key-9876" }))).toEqual({ ok: true });
    const saved = await getCarrier(storeId, "sendcloud");
    expect(saved).toMatchObject({ carrier: "sendcloud", environment: "test", complete: true, details: { publicKey: "pub-key" }, secrets: { secretKey: "…9876" } });
    const [row] = await db().execute<Row>(sql`select secrets_encrypted from commerce.shipping_carriers where store_id = ${storeId}::uuid and carrier = 'sendcloud'`);
    expect(String(row.secrets_encrypted)).not.toContain("secret-key-9876");
    expect(await carrierContext(storeId, "sendcloud")).toMatchObject({ details: { publicKey: "pub-key" }, secrets: { secretKey: "secret-key-9876" } });
  });

  it("lists the shop's own sender addresses to choose from, asked with its keys", async () => {
    const calls = sendcloud(() => json(addresses));
    expect(await sendcloudSenders(storeId)).toEqual({ ok: true, senders: [{ id: "41", label: "Gerdas Laden, Hauptstraße 12, 10115 Berlin, DE", country: "DE" }] });
    expect(calls[0].url).toBe("https://panel.sendcloud.sc/api/v3/addresses/sender-addresses?page_size=100");
    expect(calls[0].authorization).toBe(`Basic ${Buffer.from("pub-key:secret-key-9876").toString("base64")}`);
  });

  it("is checked: not accepted until a sender address is chosen, then accepted, and the answer is kept", async () => {
    sendcloud(() => json(addresses));
    expect(await checkCarrier(accountId, storeId, "sendcloud")).toMatchObject({ ok: false, problem: expect.stringMatching(/choose the sender address/) });
    expect((await getCarrier(storeId, "sendcloud"))?.check).toMatchObject({ ok: false });

    // Choosing the address saves the form again, the secret left empty (kept), which clears the last check.
    expect(await saveCarrier(accountId, storeId, "sendcloud", form({ publicKey: "pub-key", secretKey: "", senderAddressId: "41" }))).toEqual({ ok: true });
    expect((await getCarrier(storeId, "sendcloud"))?.check).toBeNull();
    expect(await checkCarrier(accountId, storeId, "sendcloud")).toEqual({ ok: true });
    expect((await getCarrier(storeId, "sendcloud"))?.check).toMatchObject({ ok: true, message: null });
  });

  it("says why when Sendcloud refuses the keys, and refuses a sender address that is not one of the list's", async () => {
    sendcloud(() => json({ errors: [{ status: 401, code: "not_authenticated" }] }, 401));
    expect(await checkCarrier(accountId, storeId, "sendcloud")).toMatchObject({ ok: false, problem: expect.stringMatching(/did not accept these keys/) });
    expect(await sendcloudSenders(storeId)).toMatchObject({ ok: false, problem: expect.stringMatching(/did not accept these keys/) });
    expect(await saveCarrier(accountId, storeId, "sendcloud", form({ publicKey: "pub-key", senderAddressId: "Berlin" }))).toEqual({
      ok: false,
      problems: ["Choose the sender address from the list."],
    });
  });

  it("is a carrier the database accepts, and only the five", async () => {
    const [row] = await db().execute<Row>(sql`select count(*)::int as n from commerce.shipping_carriers where store_id = ${storeId}::uuid and carrier = 'sendcloud'`);
    expect(row.n).toBe(1);
    await expect(db().execute(sql`insert into commerce.shipping_carriers (store_id, carrier) values (${storeId}::uuid, 'dhl')`)).rejects.toThrow();
  });
});
