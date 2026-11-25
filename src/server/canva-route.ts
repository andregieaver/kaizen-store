import "server-only";

import { z } from "zod";

import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { CANVA_WORDS } from "@/lib/admin-words/canva";
import { sameSite } from "@/lib/same-site";

import { getAccount, platformCan, type Membership } from "./auth";
import { bringBackFromCanva, canvaEditStatus, importCanvaDesign, listCanvaDesigns, startCanvaEdit, type CanvaOwner, type CanvaProblem } from "./canva";
import { checkPermission } from "./permissions";

/**
 * The media library's Canva requests (D898): a store's from a member who may change its website (`website:write`), Kaizena Flow's own from
 * a platform admin, each from the admin itself (`sameSite()`). A route, not a server action, so an upload or an export that Canva takes a
 * while over has its own time limit. Each answer says what went wrong in the person's language.
 */

/** Every answer: never kept by a cache, 400 when it says what went wrong. */
const reply = (body: { ok: boolean; [key: string]: unknown }) => Response.json(body, { status: body.ok ? 200 : 400, headers: { "Cache-Control": "no-store" } });

const ask = z.discriminatedUnion("do", [
  // A library picture by its id; a picture field's by its address (C2), whose edit waits in the field's own tab.
  z.object({ do: z.literal("edit"), mediaId: z.string().max(100).optional(), url: z.string().max(1000).optional(), place: z.enum(["library", "field"]).optional() }),
  z.object({ do: z.literal("status"), editId: z.string().max(100) }),
  z.object({ do: z.literal("bring"), editId: z.string().max(100) }),
  z.object({ do: z.literal("designs"), query: z.string().max(255).optional(), continuation: z.string().max(2000).nullable().optional() }),
  z.object({ do: z.literal("import"), designId: z.string().max(100) }),
  // A social post's picture (C3): edited in Canva, or back to the picture drawn by code.
  z.object({ do: z.literal("edit-post"), postId: z.string().max(100) }),
  z.object({ do: z.literal("drawn-post"), postId: z.string().max(100) }),
]);

/** What a product's photos may ask (C2): edit one and bring it back, nothing of the library's own. */
const FIELD_ONLY = new Set(["edit", "status", "bring"]);
/** What a social post's card may ask (C3). */
const POST_ONLY = new Set(["edit-post", "drawn-post", "status", "bring"]);

/** The member and the address the request came to, for a post's picture drawn by code (C3). */
type PostContext = { member: Membership; origin: string };

async function answer(request: Request, owner: CanvaOwner, locale: string | null | undefined, only?: Set<string>, post?: PostContext): Promise<Response> {
  const words = CANVA_WORDS[adminLangOf(locale)].problems;
  const say = (problem: CanvaProblem | "failed", detail?: string) =>
    problem === "canva" ? (detail ? fillWords(words.canva, { detail }) : words.failed) : problem === "storage" && detail ? detail : words[problem];
  const parsed = ask.safeParse(await request.json().catch(() => null));
  if (!parsed.success || (only && !only.has(parsed.data.do))) return reply({ ok: false, problem: say("failed") });
  const input = parsed.data;
  if (input.do === "edit-post" || input.do === "drawn-post") {
    if (!post) return reply({ ok: false, problem: say("failed") });
    // Loaded only here, so the library's and the editors' Canva routes do not carry the post picture's drawing (next/og, fonts).
    const posts = await import("./canva-posts");
    const done = input.do === "edit-post" ? await posts.startPostEdit(post.member, input.postId, post.origin) : await posts.usePostDrawnPicture(post.member, input.postId);
    return reply(done.ok ? done : { ok: false, problem: say(done.problem, done.detail), reconnect: done.problem === "reconnect" || done.problem === "not_connected" });
  }
  const result =
    input.do === "edit"
      ? await startCanvaEdit(owner, { mediaId: input.mediaId, url: input.url }, {}, input.place ?? "library")
      : input.do === "status"
        ? await canvaEditStatus(owner, input.editId)
        : input.do === "bring"
          ? await bringBackFromCanva(owner, input.editId)
          : input.do === "designs"
            ? await listCanvaDesigns(owner, { query: input.query, continuation: input.continuation ?? null })
            : await importCanvaDesign(owner, input.designId);
  return reply(result.ok ? result : { ok: false, problem: say(result.problem, result.detail), reconnect: result.problem === "reconnect" || result.problem === "not_connected" });
}

export async function storeCanvaRequest(request: Request, storeSlug: string): Promise<Response> {
  if (!sameSite(request)) return new Response("Forbidden", { status: 403 });
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return new Response("Not found", { status: 404 });
  return answer(request, { storeId: member.store.id, storeSlug: member.store.slug, accountId: member.account.id }, member.account.adminLocale);
}

/** A product's photos (C2): a member who may change products (`products:write`), only for editing a photo in Canva and bringing it back. */
export async function storeProductCanvaRequest(request: Request, storeSlug: string): Promise<Response> {
  if (!sameSite(request)) return new Response("Forbidden", { status: 403 });
  const member = await checkPermission(storeSlug, "products:write");
  if (!member) return new Response("Not found", { status: 404 });
  return answer(request, { storeId: member.store.id, storeSlug: member.store.slug, accountId: member.account.id }, member.account.adminLocale, FIELD_ONLY);
}

/** A social post's picture (C3): a member who may change the store's marketing (`marketing:write`), only for the post's own edit. */
export async function storeSocialCanvaRequest(request: Request, storeSlug: string): Promise<Response> {
  if (!sameSite(request)) return new Response("Forbidden", { status: 403 });
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return new Response("Not found", { status: 404 });
  const owner = { storeId: member.store.id, storeSlug: member.store.slug, accountId: member.account.id };
  return answer(request, owner, member.account.adminLocale, POST_ONLY, { member, origin: new URL(request.url).origin });
}

export async function platformCanvaRequest(request: Request): Promise<Response> {
  if (!sameSite(request)) return new Response("Forbidden", { status: 403 });
  const account = await getAccount();
  if (!account || !platformCan(account, "website")) return new Response("Not found", { status: 404 });
  return answer(request, { storeId: null, storeSlug: null, accountId: account.id }, account.adminLocale);
}
