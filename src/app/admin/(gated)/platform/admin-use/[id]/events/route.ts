import { connection, NextResponse } from "next/server";

import { serveAdminRecordingEvents } from "@/server/admin-use";
import { getAccount, platformCan } from "@/server/auth";

/**
 * One admin recording's events for the platform's player (D895 phase 3b): Kaizena Flow's team only; anyone else gets a 404. The viewing is
 * in the activity log before anything is sent; the events are sanitised, never cached, and go as gzip bytes the player unpacks (as the
 * stores' events route explains).
 */
export async function GET(_request: Request, { params }: RouteContext<"/admin/platform/admin-use/[id]/events">) {
  await connection();
  const { id } = await params;
  const account = await getAccount();
  if (!account || !platformCan(account, "settings", "read")) return new NextResponse("Not found", { status: 404 });
  const answer = await serveAdminRecordingEvents(account.id, id);
  if (answer.status !== 200) return new NextResponse(null, { status: answer.status, headers: { "Cache-Control": "private, no-store" } });
  return new NextResponse(answer.body as BodyInit, { headers: { "Content-Type": "application/gzip", "Cache-Control": "private, no-store" } });
}
