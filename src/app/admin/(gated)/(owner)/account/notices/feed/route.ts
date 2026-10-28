import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { sameSite } from "@/lib/same-site";
import { listNotices, markNoticesRead, type NoticePlace } from "@/server/assistant-notices";
import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { getAccount } from "@/server/auth";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * The person's AI manager notices (D350): their count and the newest, for the launcher's badge, the panel's list and the account's page, and
 * marking them read. A place is a store's address name, `platform` or `all`; only the person's own notices are ever read or changed, so a
 * store they cannot open has none of theirs to show.
 */
async function placeOf(value: string | null): Promise<NoticePlace | undefined> {
  if (!value || value === "all") return "all";
  if (value === "platform") return null;
  if (!/^[a-z0-9-]{1,63}$/.test(value)) return undefined;
  const [store] = await db().execute<{ id: string }>(sql`select id from commerce.stores where slug = ${value}`);
  return store ? String(store.id) : undefined;
}

export async function GET(request: NextRequest) {
  const account = await getAccount();
  if (!account) return NextResponse.json({ error: adminText(await actionAdminLang(), "support").problems.signInAgain }, { status: 401, headers: NO_STORE });
  const place = await placeOf(request.nextUrl.searchParams.get("place"));
  if (place === undefined) return NextResponse.json({ unread: 0, items: [] }, { headers: NO_STORE });
  const count = request.nextUrl.searchParams.get("count") === "1";
  const listed = await listNotices(account.id, place, count ? 1 : 30);
  return NextResponse.json(count ? { unread: listed.unread } : listed, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  if (!sameSite(request)) return new Response("Forbidden", { status: 403 });
  const account = await getAccount();
  if (!account) return NextResponse.json({ error: adminText(await actionAdminLang(), "support").problems.signInAgain }, { status: 401, headers: NO_STORE });
  const body = (await request.json().catch(() => null)) as { place?: unknown; ids?: unknown } | null;
  const place = await placeOf(typeof body?.place === "string" ? body.place : null);
  if (place === undefined) return NextResponse.json({ marked: 0 }, { headers: NO_STORE });
  const ids = Array.isArray(body?.ids) ? body.ids.filter((id): id is string => typeof id === "string").slice(0, 100) : "all";
  return NextResponse.json({ marked: await markNoticesRead(account.id, place, ids) }, { headers: NO_STORE });
}
