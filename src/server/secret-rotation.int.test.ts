import { createHash, randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { decryptSecret, encryptSecret, keyId } from "@/lib/secret-box";

vi.mock("server-only", () => ({}));

const { makeStore } = await import("./trust-fixtures");
const { reencryptSecrets, secretColumns } = await import("./secret-rotation");

/**
 * Rotating the settings key (PSI SEC-06): while a previous key is set, every kept secret moves to the current key as `v2.<kid>.…`, whether
 * it was kept as `v1` or as a `v2` naming the old key; one already under the current key is left as it is, one naming a key this server does
 * not have is never picked, and outside a rotation nothing is read. Against the real schema, so the columns found are the ones production has.
 */

type Row = Record<string, unknown>;
const current = randomBytes(32);
const old = randomBytes(32);
const stranger = randomBytes(32);
let stores: string[] = [];

const token = async (storeId: string) =>
  String((await db().execute<Row>(sql`select token from commerce.feed_settings where store_id = ${storeId}::uuid`))[0].token);

beforeAll(async () => {
  stores = await Promise.all(["rot-v1", "rot-v2", "rot-current", "rot-stranger"].map(async (name) => (await makeStore(name)).id));
  const kept = [
    encryptSecret("feed-one", old, "v1"),
    encryptSecret("feed-two", old, "v2"),
    encryptSecret("feed-three", current, "v2"),
    encryptSecret("feed-four", stranger, "v2"),
  ];
  for (const [i, storeId] of stores.entries()) {
    await db().execute(sql`insert into commerce.feed_settings (store_id, token_hash, token) values (${storeId}::uuid, ${createHash("sha256").update(`rotation-${i}-${storeId}`).digest("hex")}, ${kept[i]})`);
  }
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.feed_settings where store_id in (${sql.join(stores.map((id) => sql`${id}::uuid`), sql`, `)})`);
  await closeDb();
});

describe("rotating the settings key", () => {
  it("finds the columns that keep secrets, and none kept as a hash", async () => {
    const columns = (await secretColumns()).map((c) => `${c.table}.${c.column}`);
    for (const one of [
      "payment_credentials.secret_key_ciphertext",
      "payment_credentials.webhook_secret_ciphertext",
      "ai_providers.api_key_encrypted",
      "mollie_connections.refresh_token",
      "kaizen_life_links.access_token",
      "domain_purchases.auth_code_box",
      "webhook_endpoints.secret_encrypted",
      "custom_apps.token_encrypted",
      "shipping_carriers.secrets_encrypted",
      "feed_settings.token",
    ]) {
      expect(columns).toContain(one);
    }
  });

  it("does nothing outside a rotation", async () => {
    expect(await reencryptSecrets(current, [])).toEqual({ moved: 0, failed: 0, left: 0 });
    expect(await reencryptSecrets(null, [old])).toEqual({ moved: 0, failed: 0, left: 0 });
    expect(await token(stores[0])).toMatch(/^v1\./);
  });

  it("moves v1 and old-key secrets to the current key, and leaves the current ones and one naming a key it does not have", async () => {
    const before = await Promise.all(stores.map(token));
    const first = await reencryptSecrets(current, [old], 100_000);
    expect(first.moved).toBeGreaterThanOrEqual(2);

    const after = await Promise.all(stores.map(token));
    for (const i of [0, 1]) {
      expect(after[i].startsWith(`v2.${keyId(current)}.`)).toBe(true);
      expect(decryptSecret(after[i], current, [])).toBe(["feed-one", "feed-two"][i]);
    }
    expect(after[2]).toBe(before[2]);
    expect(after[3]).toBe(before[3]);

    // Run again: nothing of these left to move. What is left is only what no key here opens (other tests' secrets kept as v1 under keys
    // of their own), each counted as failed.
    const second = await reencryptSecrets(current, [old], 100_000);
    expect(second.moved).toBe(0);
    expect(second.left).toBe(second.failed);
    expect(await Promise.all(stores.map(token))).toEqual(after);
  });
});
