"use server";

import { isAdminLang } from "@/lib/admin-lang";
import { guideEventOf, guideSettingsOf, type GuideProgress, type GuideSettings } from "@/lib/guide";
import { isAdminView } from "@/lib/admin-view";
import { isColorChoice } from "@/lib/color-mode";
import { requireAccount, requirePlatformReader, saveAdminLang, saveAdminView, saveColorMode } from "@/server/auth";
import { readGuide, recordGuide, saveGuideSettings, type GuideScope } from "@/server/guide";
import { requireMemberAny } from "@/server/permissions";

// The admin shell's actions (its three from Your account, and Guide's three, D909), in a file of their own: every export of a "use server" file is listed in the
// server-reference manifest by every route that imports the file, and the shell and the store layout are on every admin route
// (bloat review step 2.24).

/** Keeps the account's language for the admin (D312 A0); the admin is drawn again in it. */
export async function adminLangAction(lang: unknown): Promise<void> {
  const account = await requireAccount();
  if (isAdminLang(lang)) await saveAdminLang(account.id, lang);
}

/** Keeps the account's light or dark for the admin (D99); the page has applied it already. */
export async function colorModeAction(choice: unknown): Promise<void> {
  const account = await requireAccount();
  if (isColorChoice(choice) && choice !== account.colorMode) await saveColorMode(account.id, choice);
}

/**
 * Keeps how much of the admin the account is shown (D454), at every level (D884); the page has switched already. The switch in each level's
 * top bar and phone menu and on Your account call it; nothing is drawn again, as the navigation follows the choice in the browser.
 */
export async function adminViewAction(view: unknown): Promise<void> {
  const account = await requireAccount();
  if (isAdminView(view) && view !== account.adminView) await saveAdminView(account.id, view);
}

/**
 * Guide's record of the person at a level (D909): a store by its slug, for any member of it (Guide is the person's own, so no key of
 * the store's is asked), or the platform (null), for its team.
 */
async function guideScopeOf(store: unknown): Promise<GuideScope> {
  if (store === null) return { accountId: (await requirePlatformReader()).id, storeId: null };
  if (typeof store !== "string") throw new Error("guide: no level");
  const member = await requireMemberAny(store);
  return { accountId: member.account.id, storeId: member.store.id };
}

/** What Guide has shown the person here, and their choice: read when Guide starts in the browser. */
export async function guideLoadAction(store: unknown): Promise<{ progress: GuideProgress; settings: GuideSettings }> {
  return readGuide(await guideScopeOf(store));
}

/** Records one event (a place found, a moment shown, done or put away); gives back the record as kept. */
export async function guideEventAction(store: unknown, event: unknown): Promise<GuideProgress | null> {
  const checked = guideEventOf(event);
  if (!checked) return null;
  return recordGuide(await guideScopeOf(store), checked);
}

/** Keeps how often Guide may speak up and the kinds switched off: the person's own, at every level. */
export async function guideSettingsAction(level: unknown, off: unknown): Promise<void> {
  const account = await requireAccount();
  await saveGuideSettings(account.id, guideSettingsOf(level, off));
}
