"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { INSTAGRAM_COOKIE, INSTAGRAM_COOKIE_PATH, disconnectInstagram, instagramStart } from "@/server/instagram";
import { checkPermission } from "@/server/permissions";

/** Off to Instagram to sign in and allow reading the account's posts (D559), back at `/api/integrations/instagram/callback`. */
export async function connectInstagramAction(storeSlug: string): Promise<void> {
  const member = await checkPermission(storeSlug, "settings:write");
  const start = member ? instagramStart(member.store.slug, member.account.id) : null;
  if (!start) redirect(`/admin/${storeSlug}/integrations/instagram`);
  (await cookies()).set(INSTAGRAM_COOKIE, start.cookie, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: INSTAGRAM_COOKIE_PATH, maxAge: 600 });
  redirect(start.url);
}

/** Disconnects the store's Instagram account (D559): its token and posts go, and feeds show nothing. */
export async function disconnectInstagramAction(storeSlug: string): Promise<void> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (member) await disconnectInstagram(member.account.id, member.store.id);
  redirect(`/admin/${storeSlug}/integrations/instagram`);
}
