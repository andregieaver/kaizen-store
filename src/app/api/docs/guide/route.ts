import { connection } from "next/server";

import { guideTurnInput } from "@/lib/docs-guide-schema";
import { isGuideLang } from "@/lib/docs-guide-shape";
import { platformText } from "@/lib/platform-text";
import { sameSite } from "@/lib/same-site";
import { aiFor } from "@/server/ai";
import { getAccount, listStores } from "@/server/auth";
import { takeChatTurn, visitorKey } from "@/server/chat-turns";
import { guideTurn, type GuideReader } from "@/server/docs-guide";
import { docsGuideProfile, getDocsGuide } from "@/server/docs-guide-settings";
import { log } from "@/server/log";
import { budgetVisitor, takeBudget } from "@/server/request-budget";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const fail = (status: number, error: string) => Response.json({ error }, { status, headers: NO_STORE });

/** The longest body read. */
const BODY_MAX = 4_000;

/**
 * The docs guide (wave 14 unit E5, D444) as the docs' panel asks it. `GET ?lang=` is its profile: whether it answers now, who answers, its
 * greeting, how long a conversation is kept and what an AI does with it (`docsGuideProfile()`, cached). `POST` is a reader's message: from
 * the docs' own pages only (`sameSite()`), within its budget per reader and for the site (`docs_guide`, failing closed: each message asks the
 * platform's AI) and the platform chat's limits as its own (`takeChatTurn()` under `guide:`, 30 a reader per ten minutes and the guide's daily
 * limit), counted before any model is asked. A reader is never asked to sign in; one who is signed in here may be taken to the admin's pages.
 */
export async function GET(request: Request): Promise<Response> {
  await connection();
  const lang = new URL(request.url).searchParams.get("lang");
  return Response.json(await docsGuideProfile(isGuideLang(lang) ? lang : "en"), { headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  await connection();
  if (!sameSite(request)) return fail(403, "The guide takes messages from the docs' own pages only.");
  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > BODY_MAX) return fail(413, "That message is too long.");
    raw = JSON.parse(text);
  } catch {
    return fail(400, "The guide could not read that message.");
  }
  const input = guideTurnInput.safeParse(raw);
  if (!input.success) return fail(400, "The guide could not read that message.");
  const words = platformText(input.data.lang).docs.guide;
  const visitor = budgetVisitor(request.headers);
  if (!(await takeBudget(null, "docs_guide", visitor))) return fail(429, words.busy);
  const [guide, ai] = await Promise.all([getDocsGuide(), aiFor(null, { feature: "docs_guide" })]);
  if (!guide.enabled || !ai?.textModel) return fail(404, words.off);
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const turn = await takeChatTurn(null, visitorKey(address), guide.dailyLimit, "guide:");
  if (turn === "busy") return fail(429, words.busy);
  if (turn === "closed") return fail(429, words.closed);
  try {
    const reader: GuideReader = { lang: input.data.lang, page: input.data.page || null, admin: await signedIn(), visitor };
    const result = await guideTurn(input.data, guide, ai, reader, { sorry: words.sorry });
    if (result.ok) return Response.json(result.answer, { headers: NO_STORE });
    if (result.problem === "ai") return Response.json({ ...result.answer, error: words.sorry }, { status: 502, headers: NO_STORE });
    return fail(result.status, result.problem === "full" ? words.full : words.gone);
  } catch (error) {
    log("error", "docs_guide.turn_failed", {}, error);
    return fail(500, words.sorry);
  }
}

/** The signed-in person on this host, with their stores' addresses (for an admin page's link), or null: on the docs' own host nobody is. */
async function signedIn(): Promise<GuideReader["admin"]> {
  try {
    const account = await getAccount();
    if (!account) return null;
    return { stores: (await listStores(account)).map((store) => store.slug), platformAdmin: account.platformAdmin };
  } catch {
    // Without the sign-in service (a build without it, a session that cannot be read) the reader is as a visitor.
    return null;
  }
}
