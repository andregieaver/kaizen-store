"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { requirePlatform } from "@/server/auth";
import { INSTAGRAM_COOKIE, INSTAGRAM_COOKIE_PATH, PLATFORM_INSTAGRAM, disconnectInstagram, instagramStart } from "@/server/instagram";

/** Kaizena Flow's own Instagram account (D560), for the feeds on its own site: off to Instagram, as a store's owner does. */
export async function connectPlatformInstagramAction(): Promise<void> {
  const admin = await requirePlatform("settings");
  const start = instagramStart(PLATFORM_INSTAGRAM, admin.id);
  if (!start) redirect("/admin/platform/instagram");
  (await cookies()).set(INSTAGRAM_COOKIE, start.cookie, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: INSTAGRAM_COOKIE_PATH, maxAge: 600 });
  redirect(start.url);
}

export async function disconnectPlatformInstagramAction(): Promise<void> {
  const admin = await requirePlatform("settings");
  await disconnectInstagram(admin.id, null);
  redirect("/admin/platform/instagram");
}
