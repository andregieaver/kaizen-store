import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { sameSite } from "@/lib/same-site";
import { isFeatureId } from "@/lib/store-features";
import { COMMON_WORDS } from "@/lib/admin-words/common";
import { SETTINGS_WORDS } from "@/lib/admin-words/settings";
import { checkPermission } from "@/server/permissions";
import { setFeature } from "@/server/store-features";

/**
 * Switch it on, from the page a feature serves (round 14, D641): the "switched off" panel's plain form posts here, so the panel needs no
 * server action in the client code that draws it everywhere. Owners alone, as on Features; switching on needs no confirmation. Back to the
 * page it came from when that is the store's own admin, else to Features, which also says why when the switch was refused.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/settings/features/on">) {
  const { store: slug } = await params;
  // The page's own key; `setFeature()` itself refuses anyone but an owner, who then lands on Features.
  const member = await checkPermission(slug, "settings:write");
  if (!member) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  const form = await request.formData();
  const feature = form.get("feature");
  const back = String(form.get("back") ?? "");
  const features = `/admin/${slug}/settings/features`;
  if (!isFeatureId(feature)) return NextResponse.redirect(new URL(features, request.url), 303);
  const lang = adminLangOf(member.account.adminLocale);
  const words = { features: { s: SETTINGS_WORDS[lang].features, c: COMMON_WORDS[lang].features }, locale: ADMIN_LANG_FACTS[lang].locale };
  const result = await setFeature(member, feature, true, { words });
  const ownPage = back.startsWith(`/admin/${slug}/`) && !back.startsWith("//") && !back.includes("\\");
  return NextResponse.redirect(new URL(result.ok && ownPage ? back : features, request.url), 303);
}
