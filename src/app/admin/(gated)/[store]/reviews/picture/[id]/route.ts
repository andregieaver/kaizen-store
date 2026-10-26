import { z } from "zod";

import { checkPermission } from "@/server/permissions";
import { pictureForStaff } from "@/server/review-picture-store";

/**
 * A review's picture for the store's staff (D301 G4, `docs/wave-5-marketing.md` 9.7), or its small copy with `?size=480`: whatever its review's
 * state, so a waiting review is checked with its pictures; members who may read products, never cached.
 */
export async function GET(request: Request, { params }: RouteContext<"/admin/[store]/reviews/picture/[id]">): Promise<Response> {
  const { store: slug, id } = await params;
  const member = await checkPermission(slug, "products:read");
  if (!member || !z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const file = await pictureForStaff(member.store.id, id, new URL(request.url).searchParams.get("size") === "480");
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(file.bytes as unknown as BodyInit, {
    headers: { "Content-Type": file.type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" },
  });
}
