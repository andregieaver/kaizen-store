import { connection } from "next/server";

import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { getAccount, type Account } from "@/server/auth";
import { checkPassPermission, checkPermission } from "@/server/permissions";

/**
 * Whether the visitor may edit the page they are on: Kaizen's pages (D42)
 * for platform admins, a store's pages (`?store=`, D54) for the members whose role can change the website.
 * Asked by the "Edit page" button only when the browser holds a session, so
 * pages themselves stay the same for everyone and cached. On a store's own
 * domain, where the admin's session cannot be seen (P7), the editing pass the
 * admin gave the browser answers instead (D193). An editor is also given the buttons' words in their admin language (D312), so the
 * page itself carries none of them.
 */
export async function GET(request: Request) {
  await connection();
  const store = new URL(request.url).searchParams.get("store");
  let account: Account | null = null;
  if (store) {
    account = ((await checkPermission(store, "website:write")) ?? (await checkPassPermission(store, "website:write")))?.account ?? null;
  } else {
    const signedIn = await getAccount();
    account = signedIn?.platformAdmin ? signedIn : null;
  }
  const editor = account !== null;
  const lang = adminLangOf(account?.adminLocale);
  const words = editor ? { lang: ADMIN_LANG_FACTS[lang].tag, ...adminText(lang, "website").liveEdit } : undefined;
  return Response.json({ editor, ...(words && { words }) }, { headers: { "Cache-Control": "private, no-store" } });
}
