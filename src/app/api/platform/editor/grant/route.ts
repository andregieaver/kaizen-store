import { connection, NextResponse } from "next/server";

import { backPath } from "@/lib/edit-link";
import { isStoreSlug, storeOrigin } from "@/lib/paths";
import { getAccount, getAssurance, heldDestination } from "@/server/auth";
import { mintPass } from "@/server/edit-pass";
import { checkPermission } from "@/server/permissions";

/**
 * Where the "Edit text" button of a store's own domain starts (D193): there the admin's sign-in cannot be seen (P7), so the browser comes
 * here, to the admin, as a link to follow, and is sent back with a short-lived token that says who it is for
 * (`src/lib/edit-grant.ts`). It asks for the same as the page builder's "Edit page": a signed-in member whose role can change the
 * store's website. The store's host is the one the server knows for the store, never one the link names, and the token travels in the
 * address of that one redirect, valid for ninety seconds and only for the exchange on the store's host (`enter`).
 */

const HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

const text = (message: string, status: number) => new Response(message, { status, headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(request: Request) {
  await connection();
  const params = new URL(request.url).searchParams;
  const store = params.get("store") ?? "";
  const to = backPath(params.get("to"));
  if (!isStoreSlug(store) || !to) return text("That link is not right.", 400);
  const origin = storeOrigin(store);
  if (!origin) return text("This store's pages are on the same address as the admin, so they are edited with its sign-in.", 404);

  // Not signed in, or held at the second step: to the page that finishes that, and back to the page to press the button again.
  if (!(await getAccount())) {
    const held = await getAssurance();
    const destination = held ? heldDestination(held.assurance) : null;
    return NextResponse.redirect(new URL(destination ?? "/admin/sign-in", request.url), { status: 303, headers: HEADERS });
  }
  const member = await checkPermission(store, "website:write");
  if (!member) return text("You cannot change the pages of this store.", 403);
  const pass = mintPass("enter", member);
  if (!pass) return text("Editing on the site is not set up on this server.", 503);

  const target = new URL("/api/platform/editor/enter", origin);
  target.searchParams.set("pass", pass);
  target.searchParams.set("to", to);
  return NextResponse.redirect(target, { status: 303, headers: HEADERS });
}
