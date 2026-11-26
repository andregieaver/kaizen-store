import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_USE_COOKIE, choiceFromForm, cookieValueOf } from "@/lib/admin-signals";
import { sameSite } from "@/lib/same-site";
import { chooseAdminSignals } from "@/server/admin-signals";
import { getAccount } from "@/server/auth";

/**
 * A store owner's own choice about heatmaps and recordings of how they use the admin (D895 phase 3b): kept as a new row (the record of
 * consent), and told to their browser by a cookie on `/admin` so the collectors load only for them. A plain form's post (no server action),
 * same-site only; it answers with a redirect back to an admin page, saying it was saved.
 */
export async function POST(request: NextRequest) {
  const account = await getAccount();
  if (!account) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  const form = await request.formData();
  const from = String(form.get("from") ?? "");
  const back = /^\/admin(\/[A-Za-z0-9._~-]+)*\/?$/.test(from) ? from : "/admin/account";
  const no = form.get("intent") === "no";
  const choice = no ? choiceFromForm(false, false) : choiceFromForm(form.get("heatmaps") === "on", form.get("recordings") === "on");
  const saved = await chooseAdminSignals(account.id, choice);
  const response = NextResponse.redirect(new URL(`${back}${saved ? "?adminUse=saved" : ""}`, request.url), 303);
  if (saved) {
    response.cookies.set(ADMIN_USE_COOKIE, cookieValueOf(choice), { path: "/admin", sameSite: "lax", secure: true, maxAge: 365 * 86_400 });
  }
  return response;
}
