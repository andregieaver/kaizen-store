import { NextResponse, type NextRequest } from "next/server";

import { adminLangOf } from "@/lib/admin-lang";
import { GUIDE_WORDS } from "@/lib/admin-words/guide";
import { guideEventOf, guideSettingsOf, placeAt, type GuidePlace } from "@/lib/guide";
import { platformRoleOf } from "@/lib/platform-access";
import { sameSite } from "@/lib/same-site";
import { getAccount, type Account } from "@/server/auth";
import { readGuide, recordGuide, saveGuideSettings, type GuideScope } from "@/server/guide";
import { platformGuidePlaces, storeGuidePlaces } from "@/server/guide-places";
import { checkMemberAny } from "@/server/permissions";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * Guide's record (D909), for `GuideProvider` once an admin screen is drawn, instead of anything in the screen's own document or a server
 * action (which Next queues with the router's own moves): GET reads the person's record at a level, the level's places and Guide's words,
 * and marks found the place the screen is in; POST records one event or keeps the person's choice. A level is a store's address name, for
 * a member of it, or `platform`, for its team; the person's own record is the only one ever read or changed.
 */
async function scopeOf(account: Account, place: string | null): Promise<{ scope: GuideScope; places: () => GuidePlace[] } | null> {
  const lang = adminLangOf(account.adminLocale);
  if (place === "platform") {
    return platformRoleOf(account) === null ? null : { scope: { accountId: account.id, storeId: null }, places: () => platformGuidePlaces(account, lang) };
  }
  if (!place || !/^[a-z0-9-]{1,63}$/.test(place)) return null;
  const member = await checkMemberAny(place);
  if (!member || member.account.id !== account.id) return null;
  return { scope: { accountId: account.id, storeId: member.store.id }, places: () => storeGuidePlaces(member, lang) };
}

export async function GET(request: NextRequest) {
  const account = await getAccount();
  if (!account) return NextResponse.json(null, { status: 401, headers: NO_STORE });
  const level = await scopeOf(account, request.nextUrl.searchParams.get("place"));
  if (!level) return NextResponse.json(null, { status: 404, headers: NO_STORE });
  const places = level.places();
  const read = await readGuide(level.scope);
  // The place the screen is in is found on this read, so a screen's first visit costs no second request.
  const path = request.nextUrl.searchParams.get("path") ?? "";
  const here = placeAt(places, path);
  const progress = here && !read.progress.found.includes(here.key) ? await recordGuide(level.scope, { type: "found", place: here.key }) : read.progress;
  return NextResponse.json({ progress, settings: read.settings, places, words: GUIDE_WORDS[adminLangOf(account.adminLocale)] }, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  if (!sameSite(request)) return new Response("Forbidden", { status: 403 });
  const account = await getAccount();
  if (!account) return NextResponse.json(null, { status: 401, headers: NO_STORE });
  const body = (await request.json().catch(() => null)) as { place?: unknown; event?: unknown; settings?: { level?: unknown; off?: unknown } } | null;
  if (body?.settings) {
    await saveGuideSettings(account.id, guideSettingsOf(body.settings.level, body.settings.off));
    return NextResponse.json({ saved: true }, { headers: NO_STORE });
  }
  const event = guideEventOf(body?.event);
  const level = await scopeOf(account, typeof body?.place === "string" ? body.place : null);
  if (!event || !level) return NextResponse.json(null, { status: 400, headers: NO_STORE });
  return NextResponse.json({ progress: await recordGuide(level.scope, event) }, { headers: NO_STORE });
}
