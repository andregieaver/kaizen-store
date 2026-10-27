import { connection } from "next/server";
import { z } from "zod";

import { COMMENT_BODY_MAX, COMMENT_EMAIL_MAX, COMMENT_NAME_MAX } from "@/lib/blog-comments";
import { sameSite } from "@/lib/same-site";
import { postComment } from "@/server/blog-comments";

/**
 * A visitor's comment on an article (D341, decision 3 of the wave's spec), from the store's own pages only. It sets no cookie and keeps no
 * address: the visitor is counted under a keyed hash of theirs (`visitorBucket()`), the comment checked for spam in code and kept as the
 * blog's setting says. The answer says whether it is shown now or waits, never why one was held.
 */

const commentRequest = z.object({
  store: z.string().regex(/^[a-z0-9-]{1,63}$/),
  market: z.string().regex(/^[a-z0-9-]{2,30}$/),
  article: z.uuid(),
  name: z.string().max(COMMENT_NAME_MAX * 2),
  email: z.string().max(COMMENT_EMAIL_MAX * 2).default(""),
  body: z.string().max(COMMENT_BODY_MAX * 2),
  /** A field people never see: only robots fill it in. */
  website: z.string().max(1000).default(""),
  /** Milliseconds from showing the form to sending it. */
  elapsed: z.number().int().min(0).max(1e10).default(0),
});

const answer = (status: number, body: unknown) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  await connection();
  if (!sameSite(request)) return answer(403, { ok: false, error: "failed" });
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 20_000) return answer(413, { ok: false, error: "invalid" });
    body = JSON.parse(text);
  } catch {
    return answer(400, { ok: false, error: "invalid" });
  }
  const parsed = commentRequest.safeParse(body);
  if (!parsed.success) return answer(400, { ok: false, error: "invalid" });
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const { status, body: result } = await postComment(parsed.data, address);
  return answer(status, result);
}
