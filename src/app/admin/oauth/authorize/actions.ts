"use server";

import { redirect } from "next/navigation";

import { DEFAULT_LEVEL, grantScopes, isAccessLevel, redirectWith } from "@/lib/oauth";
import { siteUrl } from "@/lib/site";
import { getAccount, getAssurance, heldDestination } from "@/server/auth";
import { approveAuthorization, denyAuthorization } from "@/server/oauth";
import { AUTHORIZE_PARAMS, authorizeQuery, connectable, consentStores, heldAcross, readAuthorization } from "@/server/oauth-authorize";

/**
 * The person's answer on the consent screen (D439, B4). Everything the page checked is checked again from the form (the client, its
 * redirect URI, PKCE, state, resource), and the stores and permissions are held to what the person may connect now: the form can ask for
 * less, never more. A server action, so another site's page cannot submit it (Next.js compares the request's origin). Yes makes the grant
 * and a code; either way the person goes back to the client's redirect URI with `state` and `iss` (RFC 9207).
 */
export async function decideAuthorizationAction(formData: FormData): Promise<void> {
  const query = Object.fromEntries(AUTHORIZE_PARAMS.flatMap((key) => (typeof formData.get(key) === "string" ? [[key, String(formData.get(key))]] : [])));
  const back = `/admin/oauth/authorize?${authorizeQuery(query)}`;
  const found = await readAuthorization(query);
  if (found.kind === "redirect") redirect(found.to);
  if (found.kind === "show") redirect(back);
  const account = await getAccount();
  if (!account) {
    const held = await getAssurance();
    redirect((held ? heldDestination(held.assurance, back) : null) ?? `/admin/sign-in?next=${encodeURIComponent(back)}`);
  }
  const { client, request } = found;
  const iss = siteUrl();
  const level = formData.get("level");
  const access = isAccessLevel(level) ? level : DEFAULT_LEVEL;
  if (formData.get("decision") !== "approve") {
    await denyAuthorization(account, client, request.scopes);
    redirect(redirectWith(request.redirectUri, { error: "access_denied", error_description: "The person declined.", state: request.state, iss }));
  }
  const session = await getAssurance();
  const aal = session?.session.level ?? "aal1";
  const offered = (await consentStores(account, aal, client.id)).filter(connectable);
  const asked = new Set(formData.getAll("store").map(String));
  const chosen = offered.filter((s) => asked.has(s.id));
  if (chosen.length === 0) redirect(`${back}&problem=stores`);
  const scopes = grantScopes(access, heldAcross(chosen), formData.getAll("permission").map(String));
  const { code } = await approveAuthorization({ account, aal, client, request, storeIds: chosen.map((s) => s.id), scopes, access });
  redirect(redirectWith(request.redirectUri, { code, state: request.state, iss }));
}
