import "server-only";

import { sql } from "drizzle-orm";

import type { ListedCookie } from "@/components/consent/cookie-policy";
import { db } from "@/db/client";
import {
  declaredCookies,
  toolCategories,
  trackingSchema,
  type OptionalCategory,
  type TrackingSettings,
} from "@/lib/cookie-consent";

import { audit, type Account } from "./auth";

/**
 * What a site stores in the browser (D58), for its cookie page and consent:
 * Kaizen's own cookies for that kind of site and those of the tools it has
 * switched on; the optional categories are what visitors are asked about.
 */
export async function siteCookies(
  storeId: string | null,
  tracking: TrackingSettings,
): Promise<{ cookies: ListedCookie[]; categories: OptionalCategory[] }> {
  void storeId;
  const cookies = declaredCookies(storeId === null ? "platform" : "store", tracking).map(
    ({ name, provider, category, days, purpose }): ListedCookie => ({ name, provider, category, days, purpose }),
  );
  return { cookies, categories: toolCategories(tracking) };
}

/**
 * Saves a site's analytics and marketing tools (D58): Kaizen's with a null
 * store. Each loads only once a visitor allows its category.
 */
export async function saveTracking(
  account: Account,
  storeId: string | null,
  input: unknown,
): Promise<{ ok: true; tracking: TrackingSettings } | { ok: false; problems: string[] }> {
  const parsed = trackingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const json = JSON.stringify(parsed.data);
  if (storeId === null) {
    await db().execute(sql`
      update commerce.platform_settings set tracking = ${json}::jsonb, updated_at = now(), updated_by = ${account.id}::uuid
    `);
  } else {
    await db().execute(sql`update commerce.stores set tracking = ${json}::jsonb where id = ${storeId}::uuid`);
  }
  await audit(account.id, storeId, `${storeId === null ? "platform" : "store"}.tracking_updated`, {
    tools: Object.keys(parsed.data),
  });
  return { ok: true, tracking: parsed.data };
}
