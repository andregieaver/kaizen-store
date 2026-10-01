import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";
import { connection, NextResponse } from "next/server";

import { assignAll } from "@/lib/experiment-assign";
import { COOKIE_DAYS, dataCookieName, decodeAssignments, encodeAssignments, MARKER_COOKIE } from "@/lib/experiments";
import { abRequest, quiet } from "@/server/ab-request";
import { acceptedStatistics, runningExperiments } from "@/server/experiments";

/**
 * Gives a browser its versions of the stores' running tests (D148). Called by the page after the visitor has accepted
 * statistics cookies, and again when a new test has started. Without that consent nothing is drawn and no cookie is set.
 * A visitor's answers never change; a test the visitor is not part of is remembered as such, so it is not asked again.
 */
export async function POST(request: Request) {
  await connection();
  const ctx = await abRequest(request);
  if (ctx instanceof Response) return ctx;
  const { storeId, body, device } = ctx;
  if (!(await acceptedStatistics(storeId))) return quiet();
  const jar = await cookies();
  const existing = decodeAssignments(jar.get(dataCookieName(storeId))?.value);
  const running = await runningExperiments(storeId);
  if (running.length === 0 && (!existing || Object.keys(existing.versions).length === 0)) return quiet();
  const market = typeof body.market === "string" && /^[a-z0-9-]{2,24}$/.test(body.market) ? body.market : "";
  const { assignments, changed } = assignAll(
    running.map((t) => ({ id: t.id, trafficShare: t.trafficShare, audience: t.audience, variants: t.variants.map((v) => ({ key: v.key, share: v.share })) })),
    existing,
    { market, device, returning: existing !== null },
    randomUUID,
  );
  if (changed) {
    const options = { httpOnly: false, sameSite: "lax" as const, path: "/", maxAge: COOKIE_DAYS * 86_400, secure: process.env.NODE_ENV === "production" };
    jar.set(dataCookieName(storeId), encodeAssignments(assignments), options);
    jar.set(MARKER_COOKIE, "1", options);
  }
  return NextResponse.json({ versions: assignments.versions }, { headers: { "Cache-Control": "no-store" } });
}
