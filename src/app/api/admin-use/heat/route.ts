import { connection } from "next/server";

import { answer } from "@/lib/beacon-answer";
import { MAX_HEAT_BYTES } from "@/lib/page-heat";
import { sameSite } from "@/lib/same-site";
import { recordAdminHeat } from "@/server/admin-heat";
import { getAccount } from "@/server/auth";
import { log } from "@/server/log";

/**
 * One admin screen view's heatmap summary (D895 phase 3b), sent by the admin's collector for a store owner who allowed heatmaps of their
 * own use. POST only, from the same site, signed in, at most 8,000 bytes, and always answered with an empty 204 that is never cached,
 * whether it was kept or not. `recordAdminHeat()` checks the switch, the person and the screen again and keeps daily totals only.
 */

export async function POST(request: Request) {
  await connection();
  try {
    if (!sameSite(request)) return answer(403);
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > MAX_HEAT_BYTES) return answer(413);
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_HEAT_BYTES) return answer(413);
    const account = await getAccount();
    if (!account) return answer(204);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return answer(400);
    }
    await recordAdminHeat({ accountId: account.id, body });
  } catch (error) {
    // Measuring is never worth an error in an owner's browser.
    log("warn", "admin_heat.record_failed", {}, error);
  }
  return answer(204);
}
