import "server-only";

import { adminLangOf, type AdminLang } from "@/lib/admin-lang";
import type { PlatformSiteMessages } from "@/lib/admin-messages/platform-site.en";
import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { requirePlatformAdmin } from "@/server/auth";

/**
 * The platform admin's language and the words of Kaizena Flow's website and themes pages (D312 A11), for a server page or part. The account
 * is read once per request (`getAccount()` is cached), so a part may ask again; a 404 for anyone else, as the pages already give.
 */
export async function platformSiteWords(): Promise<{ lang: AdminLang; w: PlatformSiteMessages }> {
  const admin = await requirePlatformAdmin();
  const lang = adminLangOf(admin.adminLocale);
  return { lang, w: adminText(lang, "platformSite") };
}

/** The areas a theme's or Kaizena Flow's own page hands its client parts: its own, and the shared builder's and theme editor's (A7). */
export const PLATFORM_SITE_AREAS = ["platformSite", "design", "builder", "blocks", "fields", "products", "website"] as const;

/** What a platform site or theme action answers, in the account's language (`actionAdminLang()`: English when no request is known). */
export async function platformActionWords(): Promise<PlatformSiteMessages["actions"]> {
  return adminText(await actionAdminLang(), "platformSite").actions;
}
