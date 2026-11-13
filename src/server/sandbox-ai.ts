import "server-only";

import { SANDBOX_WORDS } from "@/lib/admin-words/sandbox";
import type { AiFeature } from "@/lib/ai-usage";
import { sameSite } from "@/lib/same-site";

import { actionAdminLang } from "./admin-request-lang";
import { changePageWithAi } from "./page-change-ai";
import { editLibraryPicture } from "./picture-editor";
import { makeSitePicture } from "./picture-maker";
import { sandboxAi, sandboxFor, type Sandbox } from "./sandbox";

/**
 * The sandbox's AI requests (D457 S3, `docs/builder-sandbox.md` 4.5): *Make with AI*, *Remove background* and *Change with AI*, as the
 * store's own routes (`picture-route.ts`, `page-change-route.ts`) answer them, opened by the sandbox's pass instead of a member's access,
 * and on the sandbox's AI (`sandboxAi()`: its allowance and its budget). When the allowance is spent the answer says so, with *Keep this
 * store* beside it in the bar. Routes, not server actions, so a model that takes a minute has its own time limit.
 */

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const notFound = () => new Response("Not found", { status: 404 });

type Asked = { sandbox: Sandbox; body: unknown };

/** The sandbox the pass opens and the request's body, or the answer that refuses it: another site, no pass, or a sandbox that ended. */
async function asked(request: Request, sandboxId: string): Promise<Asked | Response> {
  if (!sameSite(request)) return new Response("Forbidden", { status: 403 });
  const sandbox = await sandboxFor(sandboxId);
  if (!sandbox) return notFound();
  return { sandbox, body: await request.json().catch(() => null) };
}

/** The connection for one feature, or the answer that the sandbox's AI is used up. */
async function connection(sandbox: Sandbox, feature: AiFeature) {
  const ai = await sandboxAi(sandbox, feature);
  if (ai) return ai;
  return json({ ok: false, problem: SANDBOX_WORDS[await actionAdminLang()].refused.aiSpent }, 400);
}

export async function sandboxPictureRequest(request: Request, sandboxId: string): Promise<Response> {
  const ask = await asked(request, sandboxId);
  if (ask instanceof Response) return ask;
  const ai = await connection(ask.sandbox, "page_pictures");
  if (ai instanceof Response) return ai;
  // The builder's pictures only: a sandbox has no product editor.
  const body = ask.body && typeof ask.body === "object" ? { ...ask.body, place: undefined } : ask.body;
  const result = await makeSitePicture({ store: ask.sandbox.store, accountId: ask.sandbox.account.id }, body, { connection: ai });
  return json(result, result.ok ? 200 : 400);
}

export async function sandboxEditRequest(request: Request, sandboxId: string): Promise<Response> {
  const ask = await asked(request, sandboxId);
  if (ask instanceof Response) return ask;
  const ai = await connection(ask.sandbox, "picture_edit");
  if (ai instanceof Response) return ai;
  const result = await editLibraryPicture({ store: ask.sandbox.store, accountId: ask.sandbox.account.id }, ask.body, { connection: ai });
  return json(result, result.ok ? 200 : 400);
}

type ChangeBody = { type?: unknown; content?: unknown; description?: unknown } | null;

export async function sandboxChangeRequest(request: Request, sandboxId: string): Promise<Response> {
  const ask = await asked(request, sandboxId);
  if (ask instanceof Response) return ask;
  const body = ask.body as ChangeBody;
  // *Change with AI* is offered on pages and articles, as in a store.
  if (body?.type !== "page" && body?.type !== "article") return notFound();
  const ai = await connection(ask.sandbox, "page_change");
  if (ai instanceof Response) return ai;
  const { sandbox } = ask;
  const result = await changePageWithAi({ storeId: sandbox.store.id, storeSlug: sandbox.store.slug, account: sandbox.account }, body.content, body.description, {
    connection: ai,
  });
  return json(result, result.ok ? 200 : 400);
}
