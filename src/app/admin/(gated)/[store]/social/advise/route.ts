import { NextResponse, type NextRequest } from "next/server";

import { sameSite } from "@/lib/same-site";
import { checkPermission } from "@/server/permissions";
import { writeSocialAdvice } from "@/server/social-advice";

/**
 * Asks the social media adviser for a new answer (D870 S1.4), for a member who may change marketing: a route, not a server action, so it
 * adds no entry to every route's server-reference manifest. Answers `writeSocialAdvice()`'s result as JSON.
 */
export const maxDuration = 120;

export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/social/advise">) {
  const member = await checkPermission((await params).store, "marketing:write", "social");
  if (!member) return NextResponse.json({ ok: false, problem: "Not found." }, { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  return NextResponse.json(await writeSocialAdvice(member));
}
