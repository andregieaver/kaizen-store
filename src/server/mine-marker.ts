import "server-only";

import { cookies } from "next/headers";

const COOKIE_DAYS = 365; // as the wishlist's cookie (src/server/wishlists.ts)

/** The marker that tells the page its visitor may have a cart, saved products or an account here (not httpOnly: the page's script reads it; only ever '1'). */
export const mineCookieName = (storeId: string) => `kaizen_mine_${storeId}`;

export async function markMine(storeId: string): Promise<void> {
  const jar = await cookies();
  jar.set(mineCookieName(storeId), "1", {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_DAYS * 24 * 60 * 60,
  });
}
