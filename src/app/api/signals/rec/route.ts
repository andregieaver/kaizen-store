import { connection } from "next/server";

import { answer } from "@/lib/beacon-answer";
import { REC_SEGMENT_MAX_BYTES } from "@/lib/recording";
import { sameSite } from "@/lib/same-site";
import { log } from "@/server/log";
import { recordSegment } from "@/server/recordings";

export const maxDuration = 30;

/**
 * One segment of a recording of a visit (D656, `docs/heatmaps-and-recordings.md` 8.2), sent by the storefront's recorder for a visitor who
 * allowed recordings while the store records. POST only, from the same site, at most 1 MB. The answer tells the recorder what to do and
 * says nothing else: 204 kept, 410 stop recording this tab, 400 invalid, 413 too big, 429 over budget, 503 our failure (drop it).
 */

export async function POST(request: Request) {
  await connection();
  if (!sameSite(request)) return answer(403);
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > REC_SEGMENT_MAX_BYTES) return answer(413);
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > REC_SEGMENT_MAX_BYTES) return answer(413);
    const params = new URL(request.url).searchParams;
    const query = Object.fromEntries(["store", "id", "seq", "z"].map((k) => [k, params.get(k)]));
    return answer(await recordSegment({ headers: request.headers, query, bytes }));
  } catch (error) {
    log("warn", "recordings.segment_failed", {}, error);
    return answer(503);
  }
}
