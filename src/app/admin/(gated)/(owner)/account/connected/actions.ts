"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { CANVA_STATE_COOKIE, CANVA_STATE_MINUTES, CANVA_STATE_PATH } from "@/lib/canva";
import { CANVA_WORDS } from "@/lib/admin-words/canva";
import { actionAdminLang } from "@/server/admin-request-lang";
import { requireAccount } from "@/server/auth";
import { disconnectCanva, startCanvaConnect } from "@/server/canva";
import { switchAssistantsFromFlow, unlinkFromFlow } from "@/server/kaizen-life-accounts";
import { cancelToLife } from "@/server/kaizen-life-handoffs";
import { disconnectGrant } from "@/server/oauth";

/** *Disconnect* on Connected apps and assistants (D439): the person's own grant ends at once, with every token of it. */
export async function disconnectGrantAction(grantId: string): Promise<void> {
  const account = await requireAccount();
  await disconnectGrant(account, grantId);
  refresh();
}

/** *Unlink* Kaizen Life (docs/life-work-summary.md 3.3): undone at once here and in Kaizen Life, and never linked again by itself. */
export async function unlinkKaizenLifeAction(): Promise<void> {
  const account = await requireAccount();
  await unlinkFromFlow(account.id);
  refresh();
}

/**
 * *Let them work together* and *Stop* (docs/assistants-together.md): the person's assistants here and in Kaizen Life ask each other
 * things, over the account link. Switched on only here, at the assurance of this session; Kaizen Life's copy is written in the same call,
 * and a switch on it did not take is put back off and said so.
 */
export async function switchAssistantsAction(on: boolean): Promise<void> {
  const account = await requireAccount();
  const outcome = await switchAssistantsFromFlow(account, on);
  if (outcome.kind === "life") redirect("/admin/account/connected?assistants=failed");
  refresh();
}

/** *Take back* on Between your assistants (docs/assistants-together.md, step 3): a task handed to Kaizen Life that has not ended. */
export async function takeBackLifeTaskAction(id: string): Promise<void> {
  const account = await requireAccount();
  await cancelToLife(account.id, id);
  refresh();
}

/**
 * A person's own Canva (D898): connected and disconnected by the person alone, from a media library, a store's Integrations or this page.
 * `back` is the admin page to come back to (checked by `safeBack()`); what the connection may then do in a store is the media library's own
 * permission.
 */
export async function connectCanvaAction(back: string): Promise<{ ok: false; problem: string }> {
  const account = await requireAccount();
  const start = startCanvaConnect(account.id, back);
  if (!start.ok) return { ok: false, problem: CANVA_WORDS[await actionAdminLang()].problems.off };
  (await cookies()).set(CANVA_STATE_COOKIE, start.cookie, { httpOnly: true, secure: true, sameSite: "lax", path: CANVA_STATE_PATH, maxAge: CANVA_STATE_MINUTES * 60 });
  redirect(start.url);
}

/** *Disconnect* Canva: the refresh token revoked at Canva and the connection gone. */
export async function disconnectCanvaAction(): Promise<void> {
  const account = await requireAccount();
  await disconnectCanva(account.id);
  refresh();
}
