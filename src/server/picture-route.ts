import "server-only";

import { sameSite } from "@/lib/same-site";

import { getAccount } from "./auth";
import { checkPermission } from "./permissions";
import { makeSitePicture } from "./picture-maker";
import { getStore } from "./stores";

/**
 * The page builder's *Make with AI* requests (D283): a store's from a member who may change its website (`website:write`), Kaizena Flow's own
 * from a platform admin, each from the admin itself. A route, not a server action, so a picture model that takes a minute has its own time
 * limit wherever the builder is open.
 */

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const notFound = () => new Response("Not found", { status: 404 });

async function made(request: Request, store: Awaited<ReturnType<typeof getStore>>, accountId: string): Promise<Response> {
  const result = await makeSitePicture({ store, accountId }, await request.json().catch(() => null));
  return json(result, result.ok ? 200 : 400);
}

export async function storePictureRequest(request: Request, storeSlug: string): Promise<Response> {
  if (!sameSite(request)) return new Response("Forbidden", { status: 403 });
  const member = await checkPermission(storeSlug, "website:write");
  const store = member ? await getStore(member.store.slug) : null;
  if (!member || !store) return notFound();
  return made(request, store, member.account.id);
}

export async function platformPictureRequest(request: Request): Promise<Response> {
  if (!sameSite(request)) return new Response("Forbidden", { status: 403 });
  const account = await getAccount();
  if (!account?.platformAdmin) return notFound();
  return made(request, null, account.id);
}
