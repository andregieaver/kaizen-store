import { connection, NextResponse } from "next/server";

import { presetChoice } from "@/lib/design-variations";
import { THEME_SLUG, themeTryPath } from "@/lib/theme-store";
import { getAccount, getAssurance, heldDestination } from "@/server/auth";

/**
 * *Try it in your store* on a theme's page (`docs/theme-phase-3.md` step 2). The page is cached and the same for everyone, so it cannot
 * know who is signed in; this does: someone signed in goes to the owner's page that lists their stores, someone held at the second step to
 * finish it, and anyone else to sign in, each coming back to that page afterwards (`next`, checked by `safeNext()` where it is read).
 */
const HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, { params }: RouteContext<"/themes/[slug]/try">) {
  await connection();
  const { slug } = await params;
  if (!THEME_SLUG.test(slug)) return new Response("Not found", { status: 404, headers: HEADERS });
  // The preset chosen on the theme's page (`docs/theme-showcase-phase-1.md`), in its shape; the page checks the theme has it.
  const target = themeTryPath(slug, presetChoice(new URL(request.url).searchParams.get("preset")));
  let destination = target;
  if (!(await getAccount())) {
    const held = await getAssurance();
    destination = (held && heldDestination(held.assurance, target)) || `/admin/sign-in?next=${encodeURIComponent(target)}`;
  }
  return NextResponse.redirect(new URL(destination, request.url), { status: 303, headers: HEADERS });
}
