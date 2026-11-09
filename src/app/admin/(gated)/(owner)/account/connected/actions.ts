"use server";

import { refresh } from "next/cache";

import { requireAccount } from "@/server/auth";
import { unlinkFromFlow } from "@/server/kaizen-life-accounts";
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
