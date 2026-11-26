import "server-only";

import { adminLangOf } from "@/lib/admin-lang";
import { renderEmail } from "@/lib/email-layout";
import type { TeamRole } from "@/lib/platform-access";
import { siteUrl } from "@/lib/site";
import { inviteRoleName, signInTo, TEAM_INVITE_KINDS, teamInviteEmail } from "@/lib/team-invite-email";

import type { Account } from "./auth";
import { sendEmail } from "./email";
import { log } from "./log";

/**
 * Tells someone they were added to a team (D907), best effort: the addition stands whatever the email does. Sent once per addition (its
 * idempotency key carries the account and the minute), in the inviter's admin language.
 */

const inviterOf = (actor: Pick<Account, "name" | "email">): string | null => actor.name?.trim() || actor.email || null;

/** Added to Kaizena Flow's own team (Platform → Team): a lawyer opens Legal reviews, any other role the platform admin. */
export async function sendPlatformTeamInvite(actor: Account, to: { id: string; email: string }, role: TeamRole): Promise<void> {
  const lang = adminLangOf(actor.adminLocale);
  const path = role === "legal" ? "/admin/legal" : "/admin/platform";
  await send(to, TEAM_INVITE_KINDS.platform, null, {
    lang,
    inviter: inviterOf(actor),
    place: "Kaizena Flow",
    role: inviteRoleName(lang, role),
    url: signInTo(siteUrl(), path),
    platform: true,
  });
}

/** Added to a store's team (Settings → Staff): opens the store's admin. */
export async function sendStoreTeamInvite(
  actor: Account,
  store: { id: string; slug: string; name: string },
  to: { id: string; email: string },
  role: { kind: "owner" | "admin"; name: string | null },
): Promise<void> {
  const lang = adminLangOf(actor.adminLocale);
  await send(to, TEAM_INVITE_KINDS.store, store.id, {
    lang,
    inviter: inviterOf(actor),
    place: store.name,
    role: inviteRoleName(lang, role.kind, role.name),
    url: signInTo(siteUrl(), `/admin/${store.slug}`),
    platform: false,
  });
}

async function send(to: { id: string; email: string }, kind: string, storeId: string | null, invite: Parameters<typeof teamInviteEmail>[0]): Promise<void> {
  try {
    await sendEmail({
      storeId,
      kind,
      to: to.email,
      email: renderEmail(teamInviteEmail(invite)),
      fromName: "Kaizena Flow",
      idempotencyKey: `team-invite:${storeId ?? "platform"}:${to.id}:${new Date().toISOString().slice(0, 16)}`,
    });
  } catch (error) {
    log("error", "team.invite_email_failed", { kind }, error);
  }
}
