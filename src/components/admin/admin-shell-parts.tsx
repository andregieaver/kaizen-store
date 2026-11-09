import { cache } from "react";

import { AdminColorSwitch } from "@/components/admin/admin-colors";
import { SignOutForm } from "@/components/admin/admin-trail";
import { AccountMenu, AdminSwitcher, MenuLink, MenuRow } from "@/components/admin/admin-menus";
import { MenuNotices } from "@/components/admin/ai-notices";
import { Avatar } from "@/components/avatar";
import { platformRoleOf } from "@/lib/platform-access";
import { listStores, type Account } from "@/server/auth";
import { avatarFor } from "@/server/avatars";
import { kaizenLifeAppUrl } from "@/server/kaizen-life-accounts";
import { countPendingRequests } from "@/server/platform";

import { AdminLanguageSwitch } from "@/components/admin/admin-text";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

import { adminLangAction, colorModeAction } from "@/app/admin/(gated)/(owner)/account/actions";
import { signOut } from "@/app/admin/(gated)/actions";

/** The stores an account works in, once per request (the switcher and the pages both ask). */
export const storesOf = cache((account: Account) => listStores(account));

/** Requests waiting for Kaizen's team, once per request. */
const waitingFor = cache(() => countPendingRequests());

/** The level switcher (D107) with what the person may reach, read on the server. */
export async function LevelSwitcher({ account, level, label, currentSlug }: { account: Account; level: "platform" | "control" | "store" | "hosting"; label: string; currentSlug?: string }) {
  // Everyone on the platform's team reaches the platform (D510).
  const team = platformRoleOf(account) !== null;
  const [stores, waiting] = await Promise.all([storesOf(account), team ? waitingFor() : 0]);
  return (
    <AdminSwitcher
      level={level}
      label={label}
      stores={stores}
      currentSlug={currentSlug}
      owner={stores.some((store) => store.role === "owner")}
      platform={team ? { waiting } : null}
    />
  );
}

/**
 * The account menu (D107): who is signed in, their account, the colours and signing out; and the way back to Kaizen Life for an
 * account linked to it (docs/life-work-summary.md 3.6).
 */
export async function AdminAccountMenu({ account, role }: { account: Account; role?: string }) {
  // In the account's language (D312 A0).
  const w = adminText(adminLangOf(account.adminLocale), "common").accountMenu;
  const avatar = avatarFor(account);
  const life = await kaizenLifeAppUrl(account.id);
  return (
    <AccountMenu avatar={<Avatar avatar={avatar} size={32} />} initials={avatar.initials} name={account.name} email={account.email}>
      <MenuLink href="/admin/account">
        {w.yourAccount}
        {role ? <span className="ml-auto text-xs text-muted">{role}</span> : null}
      </MenuLink>
      <MenuNotices label={adminText(adminLangOf(account.adminLocale), "assistant").notices.menu} href="/admin/account/notices" />
      <MenuLink href="/admin/account/kaizen-support">{w.contactSupport}</MenuLink>
      {life ? <MenuLink href={life}>{w.kaizenLife} ↗</MenuLink> : null}
      <MenuRow label={w.colours}>
        <AdminColorSwitch save={colorModeAction} labels={{ toDark: w.toDark, toLight: w.toLight }} />
      </MenuRow>
      <MenuRow label={w.language}>
        <AdminLanguageSwitch save={adminLangAction} />
      </MenuRow>
      <div className="mt-1 border-t border-line px-3 pt-2 pb-1 text-sm">
        <SignOutForm action={signOut} label={w.signOut} />
      </div>
    </AccountMenu>
  );
}
