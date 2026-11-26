import { connection } from "next/server";

import { answer } from "@/lib/beacon-answer";
import { REC_SEGMENT_MAX_BYTES } from "@/lib/recording";
import { sameSite } from "@/lib/same-site";
import { recordAdminSegment } from "@/server/admin-recordings";
import { getAccount } from "@/server/auth";
import { log } from "@/server/log";

export const maxDuration = 30;

/**
 * One segment of a recording of a store owner's own use of the admin (D895 phase 3b), sent by the admin's recorder for an owner who allowed
 * recordings. POST only, from the same site, signed in, at most 1 MB. Answered as the stores' segments are: 204 kept, 410 stop recording
 * this tab, 400 invalid, 413 too big, 503 our failure. `recordAdminSegment()` checks the switch, the person and the screens again and keeps
 * only the scrubbed events.
 */
export async function POST(request: Request) {
  await connection();
  if (!sameSite(request)) return answer(403);
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > REC_SEGMENT_MAX_BYTES) return answer(413);
  try {
    const account = await getAccount();
    if (!account) return answer(410);
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > REC_SEGMENT_MAX_BYTES) return answer(413);
    const params = new URL(request.url).searchParams;
    const query = Object.fromEntries(["id", "seq", "z"].map((k) => [k, params.get(k)]));
    return answer(await recordAdminSegment({ accountId: account.id, query, bytes }));
  } catch (error) {
    log("warn", "admin_recordings.segment_failed", {}, error);
    return answer(503);
  }
}
