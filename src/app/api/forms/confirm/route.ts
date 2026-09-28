import { connection } from "next/server";

import { confirmSignup } from "@/server/forms";

/**
 * The link in a newsletter sign-up's confirmation email (D93): confirms it
 * once, emails it to the form's recipients, and returns the visitor to the
 * page it was sent from, which says how it went.
 */
export async function GET(request: Request) {
  await connection();
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const { location } = await confirmSignup(token);
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
