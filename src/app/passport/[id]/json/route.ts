import { connection } from "next/server";

import { recycledShare } from "@/lib/product-passport";
import { publicPassport } from "@/server/product-passports";

/** A published product passport as data (D554): the same facts as its page, for machines that read passports. A plain 404 otherwise. */
export async function GET(_request: Request, { params }: RouteContext<"/passport/[id]/json">) {
  await connection();
  const passport = await publicPassport((await params).id);
  if (!passport) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const { passport: data, ...facts } = passport;
  return Response.json(
    { schema: "kaizenaflow.passport/1", ...facts, ...data, recycledShare: recycledShare(data) },
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=300", "Access-Control-Allow-Origin": "*" } },
  );
}
