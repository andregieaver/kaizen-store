import "server-only";

import { sql } from "drizzle-orm";
import { cache } from "react";

import { db, readDb } from "@/db/client";
import {
  googleKeyInput,
  googleProblem,
  parsePlaceReviews,
  parsePlaces,
  placeIdInput,
  placeLanguage,
  type GooglePlace,
  type GooglePlaceReviews,
} from "@/lib/google-reviews";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";

import { audit } from "./auth";
import { encryptionKey } from "./settings";

type Row = Record<string, unknown>;

/**
 * Google reviews (D91): each owner's Google Maps Platform key and the
 * business whose reviews its testimonials components show (a store's, or
 * Kaizen's with a null store). Reviews are asked for when a page is shown
 * and never kept, as Google's terms ask, so each page view showing them is
 * one request on the owner's Google account. Nothing about the visitor is
 * sent: only the business's id and the page's language.
 */

const API = "https://places.googleapis.com/v1";
const TIMEOUT_MS = 8_000;

export type GoogleSettings = { hint: string; place: GooglePlace | null };

const owned = (storeId: string | null) => (storeId ? sql`store_id = ${storeId}::uuid` : sql`store_id is null`);

/** The owner's saved key (as a hint) and business; null when none. */
export async function getGoogleSettings(storeId: string | null): Promise<GoogleSettings | null> {
  const [row] = await db().execute<Row>(sql`select * from commerce.google_places where ${owned(storeId)}`);
  if (!row) return null;
  return {
    hint: String(row.api_key_hint),
    place: row.place_id ? { id: String(row.place_id), name: String(row.place_name), address: String(row.place_address ?? "") } : null,
  };
}

/** The owner's key and business, the key decrypted; null when either is missing or the key cannot be read. */
async function connection(storeId: string | null, read: () => Pick<ReturnType<typeof readDb>, "execute"> = db): Promise<{ apiKey: string; placeId: string | null } | null> {
  const [row] = await read().execute<Row>(sql`select api_key_encrypted, place_id from commerce.google_places where ${owned(storeId)}`);
  const key = encryptionKey();
  if (!row || !key) return null;
  try {
    return { apiKey: decryptSecret(String(row.api_key_encrypted), key), placeId: row.place_id ? String(row.place_id) : null };
  } catch {
    return null;
  }
}

async function google(apiKey: string, path: string, fields: string, init: RequestInit = {}): Promise<{ ok: true; json: unknown } | { ok: false; problem: string }> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": fields, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { ok: false, problem: "Google did not answer. Try again in a moment." };
  }
  const json: unknown = await response.json().catch(() => null);
  return response.ok ? { ok: true, json } : { ok: false, problem: googleProblem(json, response.status) };
}

export type GoogleResult = { ok: true } | { ok: false; problems: string[] };

/** Saves the owner's key (a new one replaces the old; the business chosen stays). */
export async function saveGoogleKey(accountId: string, storeId: string | null, raw: unknown): Promise<GoogleResult> {
  const parsed = googleKeyInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: [parsed.error.issues[0].message] };
  const key = encryptionKey();
  if (!key) return { ok: false, problems: ["Kaizen cannot keep the key safe right now, so it was not saved. Try again later."] };
  const hint = `…${parsed.data.slice(-4)}`;
  await db().execute(sql`
    insert into commerce.google_places (store_id, api_key_encrypted, api_key_hint, updated_by)
    values (${storeId}::uuid, ${encryptSecret(parsed.data, key)}, ${hint}, ${accountId}::uuid)
    on conflict (store_id) do update set
      api_key_encrypted = excluded.api_key_encrypted, api_key_hint = excluded.api_key_hint,
      updated_at = now(), updated_by = excluded.updated_by
  `);
  await audit(accountId, storeId, storeId ? "google.key_saved" : "google.platform_key_saved", {});
  return { ok: true };
}

/** Businesses on Google matching what the owner typed, to choose theirs from. */
export async function findPlaces(storeId: string | null, query: string): Promise<{ ok: true; places: GooglePlace[] } | { ok: false; problems: string[] }> {
  const text = query.trim().slice(0, 200);
  if (!text) return { ok: false, problems: ["Type the business's name and town."] };
  const saved = await connection(storeId);
  if (!saved) return { ok: false, problems: ["Save a Google API key first."] };
  const answer = await google(saved.apiKey, "/places:searchText", "places.id,places.displayName,places.formattedAddress", {
    method: "POST",
    body: JSON.stringify({ textQuery: text, pageSize: 5 }),
  });
  if (!answer.ok) return { ok: false, problems: [answer.problem] };
  return { ok: true, places: parsePlaces(answer.json) };
}

/** Chooses the business whose reviews show, as Google names it now. */
export async function choosePlace(accountId: string, storeId: string | null, raw: unknown): Promise<GoogleResult> {
  const id = placeIdInput.safeParse(raw);
  if (!id.success) return { ok: false, problems: [id.error.issues[0].message] };
  const saved = await connection(storeId);
  if (!saved) return { ok: false, problems: ["Save a Google API key first."] };
  const answer = await google(saved.apiKey, `/places/${encodeURIComponent(id.data)}`, "id,displayName,formattedAddress");
  if (!answer.ok) return { ok: false, problems: [answer.problem] };
  const [place] = parsePlaces({ places: [answer.json] });
  if (!place) return { ok: false, problems: ["Google did not find that business."] };
  await db().execute(sql`
    update commerce.google_places set place_id = ${place.id}, place_name = ${place.name}, place_address = ${place.address},
      updated_at = now(), updated_by = ${accountId}::uuid
    where ${owned(storeId)}
  `);
  await audit(accountId, storeId, storeId ? "google.place_chosen" : "google.platform_place_chosen", { placeId: place.id, name: place.name });
  return { ok: true };
}

/** Forgets the owner's key and business: Google reviews stop showing. */
export async function removeGoogle(accountId: string, storeId: string | null): Promise<void> {
  const rows = await db().execute<Row>(sql`delete from commerce.google_places where ${owned(storeId)} returning id`);
  if (rows.length > 0) await audit(accountId, storeId, storeId ? "google.removed" : "google.platform_removed", {});
}

/**
 * The owner's business's rating and reviews in a language, asked of Google
 * now (once per request however many components show them); null when
 * none is set up or Google does not answer, and the components show nothing.
 */
export const placeReviews = cache(async (storeId: string | null, locale: string): Promise<GooglePlaceReviews | null> => {
  const saved = await connection(storeId, readDb);
  if (!saved?.placeId) return null;
  const answer = await google(
    saved.apiKey,
    `/places/${encodeURIComponent(saved.placeId)}?languageCode=${encodeURIComponent(placeLanguage(locale))}`,
    "id,displayName,rating,userRatingCount,googleMapsUri,reviews",
  );
  if (!answer.ok) {
    console.warn("Google reviews could not be read", answer.problem);
    return null;
  }
  return parsePlaceReviews(answer.json);
});
