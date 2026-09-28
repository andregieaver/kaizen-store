import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const google = await import("./google-reviews");

const run = Date.now().toString(36);
const KEY = "AIzaSyA-kaizen-test-key-000000000001234";
const PLACE = "ChIJN1t_tDeuEmsRUsoyG83frY4";
let storeId: string;
let accountId: string;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`google-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`google-${run}`}, 'Test', null) as id
  `);
  storeId = String(store.id);
  const [account] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`google-${run}@example.com`}`);
  accountId = String(account.id);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await closeDb();
});

/** Google's answers, as the Places API (New) gives them, and what was asked. */
function stubGoogle(answers: Record<string, unknown>) {
  const asked: { url: string; headers: Record<string, string> }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    asked.push({ url, headers: init.headers as Record<string, string> });
    const match = Object.keys(answers).find((part) => url.includes(part));
    return new Response(JSON.stringify(match ? answers[match] : { error: { message: "Not found" } }), { status: match ? 200 : 404 });
  });
  return asked;
}

describe("Google reviews (D91)", () => {
  it("keeps the store's key encrypted, shows only its end, and finds and chooses its business", async () => {
    expect(await google.saveGoogleKey(accountId, storeId, "not a key")).toMatchObject({ ok: false });
    expect(await google.saveGoogleKey(accountId, storeId, KEY)).toEqual({ ok: true });
    const [row] = await db().execute<Row>(sql`select api_key_encrypted from commerce.google_places where store_id = ${storeId}::uuid`);
    expect(String(row.api_key_encrypted)).not.toContain(KEY);
    expect(await google.getGoogleSettings(storeId)).toEqual({ hint: "…1234", place: null });

    const asked = stubGoogle({
      "places:searchText": { places: [{ id: PLACE, displayName: { text: "Kaffebaren" }, formattedAddress: "Storgata 1, Oslo" }] },
      [`places/${PLACE}`]: { id: PLACE, displayName: { text: "Kaffebaren" }, formattedAddress: "Storgata 1, Oslo" },
    });
    expect(await google.findPlaces(storeId, "Kaffebaren Oslo")).toEqual({ ok: true, places: [{ id: PLACE, name: "Kaffebaren", address: "Storgata 1, Oslo" }] });
    expect(asked[0].headers["X-Goog-Api-Key"]).toBe(KEY);
    expect(await google.choosePlace(accountId, storeId, PLACE)).toEqual({ ok: true });
    expect(await google.getGoogleSettings(storeId)).toEqual({ hint: "…1234", place: { id: PLACE, name: "Kaffebaren", address: "Storgata 1, Oslo" } });
  });

  it("asks Google for the reviews in the page's language, and shows nothing when Google says no", async () => {
    const asked = stubGoogle({
      [`places/${PLACE}?languageCode=no`]: {
        id: PLACE,
        displayName: { text: "Kaffebaren" },
        rating: 4.5,
        userRatingCount: 10,
        reviews: [{ name: "r1", rating: 5, text: { text: "Supert" }, authorAttribution: { displayName: "Kari" } }],
      },
    });
    const reviews = await google.placeReviews(storeId, "nb-NO");
    expect(reviews).toMatchObject({ name: "Kaffebaren", rating: 4.5, count: 10, reviews: [{ author: "Kari", text: "Supert" }] });
    expect(asked[0].headers["X-Goog-FieldMask"]).toContain("reviews");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await google.placeReviews(storeId, "sv-SE")).toBeNull();
  });

  it("forgets the key and business", async () => {
    await google.removeGoogle(accountId, storeId);
    expect(await google.getGoogleSettings(storeId)).toBeNull();
    expect(await google.placeReviews(storeId, "nb-NO")).toBeNull();
  });
});
