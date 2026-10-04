import "server-only";

import { z } from "zod";

import { ITERATIONS } from "@/lib/replicate";

import { checkPermission } from "./permissions";
import { sameSite } from "./chat-route";
import { abortReplication, currentReplication, replicationStatus, startReplication, tickReplication, type ReplicaOwner } from "./replicate";

/**
 * The page replicator's requests (D150) from the store's AI studio: a member of the store starts a job, asks how it is
 * going, nudges it along one tick at a time, or stops it. Requests that change anything must come from the admin itself.
 */

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const notFound = () => new Response("Not found", { status: 404 });

/** A member who may use the studio: reading a job needs `website:read`, starting, nudging or stopping one `website:write`. */
async function ownerOf(request: Request, storeSlug: string, access: "read" | "write" = "write"): Promise<ReplicaOwner | null> {
  const member = await checkPermission(storeSlug, access === "read" ? "website:read" : "website:write");
  if (!member) return null;
  return { storeId: member.store.id, storeSlug: member.store.slug, account: member.account, origin: new URL(request.url).origin };
}

const startInput = z.object({
  url: z.string().max(2000),
  iterations: z.number().int().min(ITERATIONS.min).max(ITERATIONS.max),
  confirmed: z.boolean(),
});

export async function startRequest(request: Request, storeSlug: string): Promise<Response> {
  if (!sameSite(request)) return new Response("Forbidden", { status: 403 });
  const owner = await ownerOf(request, storeSlug);
  if (!owner) return notFound();
  const input = startInput.safeParse(await request.json().catch(() => null));
  if (!input.success) return json({ ok: false, problem: "The request could not be read." }, 400);
  const result = await startReplication(owner, input.data.url, input.data.iterations, input.data.confirmed);
  return json(result, result.ok ? 200 : 400);
}

export async function currentRequest(request: Request, storeSlug: string): Promise<Response> {
  const owner = await ownerOf(request, storeSlug, "read");
  if (!owner) return notFound();
  return json({ job: await currentReplication(owner) });
}

const idOk = (id: string) => /^[0-9a-f-]{36}$/.test(id);

export async function statusRequest(request: Request, storeSlug: string, id: string): Promise<Response> {
  const owner = idOk(id) ? await ownerOf(request, storeSlug, "read") : null;
  if (!owner) return notFound();
  const job = await replicationStatus(owner, id);
  return job ? json({ job }) : notFound();
}

export async function tickRequest(request: Request, storeSlug: string, id: string): Promise<Response> {
  if (!sameSite(request)) return new Response("Forbidden", { status: 403 });
  const owner = idOk(id) ? await ownerOf(request, storeSlug) : null;
  if (!owner) return notFound();
  const job = await tickReplication(owner, id);
  return job ? json({ job }) : notFound();
}

export async function abortRequest(request: Request, storeSlug: string, id: string): Promise<Response> {
  if (!sameSite(request)) return new Response("Forbidden", { status: 403 });
  const owner = idOk(id) ? await ownerOf(request, storeSlug) : null;
  if (!owner) return notFound();
  const job = await abortReplication(owner, id);
  return job ? json({ job }) : notFound();
}
