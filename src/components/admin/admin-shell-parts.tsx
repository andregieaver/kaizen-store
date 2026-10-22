import { cache } from "react";

import { AdminColorSwitch } from "@/components/admin/admin-colors";
import { SignOutForm } from "@/components/admin/admin-trail";
import { AccountMenu, AdminSwitcher, MenuLink, MenuRow } from "@/components/admin/admin-menus";
import { Avatar } from "@/components/avatar";
import { listStores, type Account } from "@/server/auth";
import { avatarFor } from "@/server/avatars";
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
  const [stores, waiting] = await Promise.all([storesOf(account), account.platformAdmin ? waitingFor() : 0]);
  return (
    <AdminSwitcher
      level={level}
      label={label}
      stores={stores}
      currentSlug={currentSlug}
      owner={stores.some((store) => store.role === "owner")}
      platform={account.platformAdmin ? { waiting } : null}
    />
  );
}

/** The account menu (D107): who is signed in, their account, the colours and signing out. */
export function AdminAccountMenu({ account, role }: { account: Account; role?: string }) {
  // In the account's language (D312 A0).
  const w = adminText(adminLangOf(account.adminLocale), "common").accountMenu;
  return (
    <AccountMenu avatar={<Avatar avatar={avatarFor(account)} size={32} />} name={account.name} email={account.email}>
      <MenuLink href="/admin/account">
        {w.yourAccount}
        {role ? <span className="ml-auto text-xs text-muted">{role}</span> : null}
      </MenuLink>
      <MenuLink href="/admin/account/kaizen-support">{w.contactSupport}</MenuLink>
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
