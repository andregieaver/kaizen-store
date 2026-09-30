import { NextResponse } from "next/server";

import { normalizeReferralCode, referralSignUpPath } from "@/lib/referrals";
import { recordReferralVisit } from "@/server/referrals";

/**
 * A store owner's referral link (D131): counts the visit (by day and code, nothing about the visitor is kept, no cookie is
 * set) and leads to the sign-up form with the code in the address, where it is kept in the form and, only once the
 * visitor has allowed marketing cookies, in a cookie. A code that is not a real one, or is blocked, leads to the plain
 * sign-up form, the same for everyone.
 */
export async function GET(request: Request, { params }: RouteContext<"/r/[code]">) {
  const { code } = await params;
  const clean = normalizeReferralCode(code);
  let real = false;
  try {
    real = await recordReferralVisit(clean);
  } catch {
    // The counter is not worth failing a visitor's way to the form: go on with the code, which is checked again at sign-up.
    real = clean !== null;
  }
  const response = NextResponse.redirect(new URL(referralSignUpPath(real ? clean : null), request.url), 307);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
