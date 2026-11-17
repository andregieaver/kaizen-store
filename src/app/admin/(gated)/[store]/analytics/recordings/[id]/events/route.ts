import { connection, NextResponse } from "next/server";

import { checkPermission } from "@/server/permissions";
import { serveRecordingEvents } from "@/server/recordings-read";

/**
 * One recording's events for its player (D656 step 11): the owner's alone, as watching recordings is. A refused member gets a 404, as
 * for any page they cannot open. The viewing is in the activity log before anything is sent; the events are sanitised and never cached.
 * They go as gzip bytes typed `application/gzip`, which the player unpacks: Next drops a route's own `Content-Encoding` (16.4.6,
 * `FORBIDDEN_HEADERS` in `send-response.js`), so a body labelled JSON would reach the browser still packed, or packed twice.
 */
export async function GET(_request: Request, { params }: RouteContext<"/admin/[store]/analytics/recordings/[id]/events">) {
  await connection();
  const { store: slug, id } = await params;
  const member = await checkPermission(slug, "owner");
  if (!member) return new NextResponse("Not found", { status: 404 });
  const answer = await serveRecordingEvents(member, id);
  if (answer.status !== 200) return new NextResponse(null, { status: answer.status, headers: { "Cache-Control": "private, no-store" } });
  return new NextResponse(answer.body as BodyInit, {
    headers: { "Content-Type": "application/gzip", "Cache-Control": "private, no-store" },
  });
}
