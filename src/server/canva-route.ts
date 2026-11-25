import "server-only";

import { z } from "zod";

import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { WEBSITE_WORDS } from "@/lib/admin-words/website";
import { sameSite } from "@/lib/same-site";

import { getAccount, platformCan } from "./auth";
import { bringBackFromCanva, importCanvaDesign, listCanvaDesigns, startCanvaEdit, type CanvaOwner, type CanvaProblem } from "./canva";
import { checkPermission } from "./permissions";

/**
 * The media library's Canva requests (D898): a store's from a member who may change its website (`website:write`), Kaizena Flow's own from
 * a platform admin, each from the admin itself (`sameSite()`). A route, not a server action, so an upload or an export that Canva takes a
 * while over has its own time limit. Each answer says what went wrong in the person's language.
 */

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const notFound = () => new Response("Not found", { status: 404 });

const ask = z.discriminatedUnion("do", [
  z.object({ do: z.literal("edit"), mediaId: z.string().max(100) }),
  z.object({ do: z.literal("bring"), editId: z.string().max(100) }),
  z.object({ do: z.literal("designs"), query: z.string().max(255).optional(), continuation: z.string().max(2000).nullable().optional() }),
  z.object({ do: z.literal("import"), designId: z.string().max(100) }),
]);

async function answer(request: Request, owner: CanvaOwner, locale: string | null | undefined): Promise<Response> {
  const words = WEBSITE_WORDS[adminLangOf(locale)].media.canva.problems;
  const say = (problem: CanvaProblem | "failed", detail?: string) =>
    problem === "canva" ? (detail ? fillWords(words.canva, { detail }) : words.failed) : problem === "storage" && detail ? detail : words[problem];
  const parsed = ask.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ ok: false, problem: say("failed") }, 400);
  const input = parsed.data;
  const result =
    input.do === "edit"
      ? await startCanvaEdit(owner, input.mediaId)
      : input.do === "bring"
        ? await bringBackFromCanva(owner, input.editId)
        : input.do === "designs"
          ? await listCanvaDesigns(owner, { query: input.query, continuation: input.continuation ?? null })
          : await importCanvaDesign(owner, input.designId);
  return result.ok ? json(result) : json({ ok: false, problem: say(result.problem, result.detail), reconnect: result.problem === "reconnect" || result.problem === "not_connected" }, 400);
}

export async function storeCanvaRequest(request: Request, storeSlug: string): Promise<Response> {
  if (!sameSite(request)) return new Response("Forbidden", { status: 403 });
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return notFound();
  return answer(request, { storeId: member.store.id, storeSlug: member.store.slug, accountId: member.account.id }, member.account.adminLocale);
}

export async function platformCanvaRequest(request: Request): Promise<Response> {
  if (!sameSite(request)) return new Response("Forbidden", { status: 403 });
  const account = await getAccount();
  if (!account || !platformCan(account, "website")) return notFound();
  return answer(request, { storeId: null, storeSlug: null, accountId: account.id }, account.adminLocale);
}
