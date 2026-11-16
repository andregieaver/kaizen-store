import { connection } from "next/server";
import { z } from "zod";

import { sameSite } from "@/lib/same-site";
import { getOpenStore } from "@/server/stores";
import { log } from "@/server/log";
import { forgetRecordings } from "@/server/recordings";
import { budgetVisitor, takeBudget } from "@/server/request-budget";

/**
 * A visitor's browser asks for its recordings to be deleted (D656, `docs/heatmaps-and-recordings.md` 8.3): on a withdrawal, on the Cookies
 * page's button, or when leftover ids are found. No consent is asked (withdrawing must work after withdrawal). Same site, at most 4,000
 * bytes, always an empty 204.
 */
const MAX_BYTES = 4000;
const body = z.object({ store: z.string().regex(/^[a-z0-9-]{1,63}$/), ids: z.array(z.string()).max(51) });
const answer = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  await connection();
  try {
    if (!sameSite(request)) return answer(403);
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_BYTES) return answer(413);
    const parsed = body.safeParse(JSON.parse(text));
    if (!parsed.success) return answer(204);
    const store = await getOpenStore(parsed.data.store);
    if (!store || !(await takeBudget(store.id, "forget", budgetVisitor(request.headers)))) return answer(204);
    await forgetRecordings(parsed.data);
  } catch (error) {
    log("warn", "recordings.forget_failed", {}, error);
  }
  return answer(204);
}
