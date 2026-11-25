import { sameSite } from "@/lib/same-site";
import { getAccount } from "@/server/auth";
import { checkPermission } from "@/server/permissions";
import { approvePluginSignIn, declinePluginSignIn, PLUGIN_CODE, PLUGIN_SIGN_IN_PAGE } from "@/server/plugin-sign-in";

/**
 * *Connect Figma* or *Do not connect* on the approving page (D898 F1): a plain form from the admin itself, by the person signed in now, who
 * must own the store chosen. Back to the page, which says how it ended.
 */
export async function POST(request: Request): Promise<Response> {
  if (!sameSite(request)) return new Response("Forbidden", { status: 403 });
  const account = await getAccount();
  if (!account) return new Response("Not found", { status: 404 });
  const form = await request.formData().catch(() => null);
  const code = String(form?.get("code") ?? "");
  const store = String(form?.get("store") ?? "");
  const back = (query: string) => Response.redirect(new URL(`${PLUGIN_SIGN_IN_PAGE}?${query}`, request.url), 303);
  if (!PLUGIN_CODE.test(code)) return back("problem=gone");
  if (form?.get("decision") === "decline") {
    await declinePluginSignIn(code);
    return back("done=declined");
  }
  const member = /^[a-z0-9-]{1,63}$/.test(store) ? await checkPermission(store, "owner") : null;
  if (!member || member.account.id !== account.id) return back(`code=${code}&problem=owner`);
  const outcome = await approvePluginSignIn(member, code);
  return outcome.ok ? back(`done=connected&store=${encodeURIComponent(member.store.slug)}`) : back(`code=${code}&problem=${outcome.problem}`);
}
