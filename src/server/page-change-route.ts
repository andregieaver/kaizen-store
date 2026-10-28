import "server-only";

import { sameSite } from "@/lib/same-site";

import { getAccount } from "./auth";
import { changePageWithAi } from "./page-change-ai";
import { checkPageTypeAccess } from "./permissions";

/**
 * The page builder's *Change with AI* requests (D351): a store's from a member who may change that kind of page, Kaizena Flow's own from a
 * platform admin, each from the admin itself. A route, not a server action, so the model and a new section's writer have their own time limit.
 */

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const notFound = () => new Response("Not found", { status: 404 });

type Body = { type?: unknown; content?: unknown; description?: unknown } | null;

export async function storeChangeRequest(request: Request, storeSlug: string): Promise<Response> {
  if (!sameSite(request)) return new Response("Forbidden", { status: 403 });
  const body = (await request.json().catch(() => null)) as Body;
  const member = await checkPageTypeAccess(storeSlug, body?.type, "write");
  if (!member) return notFound();
  const result = await changePageWithAi({ storeId: member.store.id, storeSlug: member.store.slug, account: member.account }, body?.content, body?.description);
  return json(result, result.ok ? 200 : 400);
}

export async function platformChangeRequest(request: Request): Promise<Response> {
  if (!sameSite(request)) return new Response("Forbidden", { status: 403 });
  const account = await getAccount();
  if (!account?.platformAdmin) return notFound();
  const body = (await request.json().catch(() => null)) as Body;
  const result = await changePageWithAi({ storeId: null, storeSlug: null, account }, body?.content, body?.description);
  return json(result, result.ok ? 200 : 400);
}
