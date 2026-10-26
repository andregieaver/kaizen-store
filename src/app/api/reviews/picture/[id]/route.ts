import { connection } from "next/server";
import { z } from "zod";

import { getCustomer } from "@/server/customers";
import { pictureForVisitor } from "@/server/review-picture-store";

/**
 * A review's picture (D301 G4, `docs/wave-5-marketing.md` 9.7), or its small copy with `?size=480`: to everyone while its review is published and
 * the picture not hidden (cached briefly, so a hidden picture goes within minutes), else only to its signed-in author (never cached). Anything
 * else is a plain 404, the same whether or not the picture exists.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/reviews/picture/[id]">): Promise<Response> {
  await connection();
  const { id } = await params;
  const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!z.uuid().safeParse(id).success) return notFound();
  const small = new URL(request.url).searchParams.get("size") === "480";
  const file = await pictureForVisitor(id, small, async (storeId, buyerKey) => {
    const customer = await getCustomer(storeId);
    return Boolean(customer && buyerKey === `c:${customer.id}`);
  });
  if (!file) return notFound();
  return new Response(file.bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": file.type,
      "Cache-Control": file.shown ? "public, max-age=300, s-maxage=300" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
