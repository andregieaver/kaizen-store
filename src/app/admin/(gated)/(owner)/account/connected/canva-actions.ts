"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { CANVA_STATE_COOKIE, CANVA_STATE_MINUTES, CANVA_STATE_PATH } from "@/lib/canva";
import { WEBSITE_WORDS } from "@/lib/admin-words/website";
import { actionAdminLang } from "@/server/admin-request-lang";
import { requireAccount } from "@/server/auth";
import { disconnectCanva, startCanvaConnect } from "@/server/canva";

/**
 * A person's own Canva (D898): connected and disconnected by the person alone, from the media library, the store's Integrations or
 * Account → Connected apps. `back` is the admin page to come back to (checked by `safeBack()`); what the connection may then do in a store
 * is the media library's own permission.
 */
export async function connectCanvaAction(back: string): Promise<{ ok: false; problem: string }> {
  const account = await requireAccount();
  const start = startCanvaConnect(account.id, back);
  if (!start.ok) return { ok: false, problem: WEBSITE_WORDS[await actionAdminLang()].media.canva.problems.off };
  (await cookies()).set(CANVA_STATE_COOKIE, start.cookie, { httpOnly: true, secure: true, sameSite: "lax", path: CANVA_STATE_PATH, maxAge: CANVA_STATE_MINUTES * 60 });
  redirect(start.url);
}

export async function disconnectCanvaAction(): Promise<void> {
  const account = await requireAccount();
  await disconnectCanva(account.id);
  refresh();
}
