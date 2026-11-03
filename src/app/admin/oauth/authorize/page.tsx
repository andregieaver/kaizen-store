import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { OAuthConsentForm } from "@/components/admin/oauth-consent";
import { FocusFrame, FocusHeading } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { oauthEn } from "@/lib/admin-messages/oauth.en";
import { adminText } from "@/lib/admin-text";
import { ACCESS_LEVELS, clientHost, levelScopes, STORES_READ } from "@/lib/oauth";
import { requestAdminLang } from "@/server/admin-request-lang";
import { getAccount, getAssurance, heldDestination } from "@/server/auth";
import { authorizeQuery, connectable, consentStores, heldAcross, readAuthorization } from "@/server/oauth-authorize";

import { decideAuthorizationAction } from "./actions";
import { scopeLabel } from "@/lib/oauth-words";

/** The tab's title stays fixed (in English): a title read from the request would stream the page's metadata, `noindex` with it, out of `<head>`. */
export const metadata: Metadata = { title: oauthEn.consent.title, referrer: "same-origin" };

/**
 * Kaizena Flow's consent screen (wave 14 unit B, D439, B4), where `/oauth/authorize` lands: an AI assistant or app asks a person to connect
 * their stores. The request is checked before anything is shown (`readAuthorization()`: a client and redirect URI we know, PKCE S256, a
 * state, our resource); a person not signed in signs in first and comes back (a platform admin at the second step, as everywhere). Homer
 * sees the client, its host and whether Kaizena Flow verified it, the stores ticked and one choice; Lisa's *Choose permissions* is one
 * step away. Never framed (`frame-ancestors 'none'`, `oauthRouteHeaders()`). In the account's language, or the browser's before sign-in.
 */
export default function AuthorizePage({ searchParams }: PageProps<"/admin/oauth/authorize">) {
  return (
    <Suspense fallback={<FocusFrame />}>
      <Authorize searchParams={searchParams} />
    </Suspense>
  );
}

async function Authorize({ searchParams }: { searchParams: PageProps<"/admin/oauth/authorize">["searchParams"] }) {
  const query = await searchParams;
  const lang = await requestAdminLang();
  const w = adminText(lang, "oauth");
  const found = await readAuthorization(query);
  if (found.kind === "redirect") redirect(found.to);
  if (found.kind === "show") {
    return (
      <FocusFrame lang={lang}>
        <FocusHeading title={w.consent.cannot} />
        <p className="text-body text-ink">{w.consent.reasons[found.reason]}</p>
        {found.reason === "request" ? (
          // A client Kaizena Flow does not vouch for is not sent anywhere on its own (no open redirect): the person may follow a plain link.
          <>
            <p className="text-sm text-muted">{found.description}</p>
            <p className="text-sm text-muted">
              {w.consent.goBackTo}{" "}
              <a href={found.origin} rel="noreferrer nofollow" className="underline">
                {found.origin}
              </a>
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">{w.consent.goBack}</p>
        )}
      </FocusFrame>
    );
  }
  const back = `/admin/oauth/authorize?${authorizeQuery(query)}`;
  const account = await getAccount();
  if (!account) {
    const held = await getAssurance();
    redirect((held ? heldDestination(held.assurance, back) : null) ?? `/admin/sign-in?next=${encodeURIComponent(back)}`);
  }
  const session = await getAssurance();
  // The scopes the client asked for are not offered as such: the person's level and role decide what is given (RFC 6749 3.3).
  const { client, request } = found;
  const stores = await consentStores(account, session?.session.level ?? "aal1", client.id);
  // The host the person is shown: the metadata document's, else where the code would go, never a site a registration only claims; and,
  // when the code goes to another host than the document's, that host too (D439 review).
  const host = clientHost(client, request.redirectUri);
  const returnHost = new URL(request.redirectUri).host;
  const held = heldAcross(stores.filter(connectable));
  const levels = Object.fromEntries(ACCESS_LEVELS.map((level) => [level, levelScopes(level, held).filter((s) => s !== STORES_READ)])) as Record<(typeof ACCESS_LEVELS)[number], string[]>;
  const hidden = Object.fromEntries(new URLSearchParams(authorizeQuery(query)).entries());
  return (
    <FocusFrame lang={lang} width="wide">
      <div className="flex items-start gap-4">
        {client.logoUrl && (
          // The client's own logo, from its own HTTPS address: no referrer is sent with it (the page's policy).
          // eslint-disable-next-line @next/next/no-img-element
          <img src={client.logoUrl} alt="" width={48} height={48} referrerPolicy="no-referrer" className="size-12 shrink-0 rounded-tile object-contain" />
        )}
        <div className="flex flex-col gap-1">
          <FocusHeading title={fillWords(w.consent.heading, { client: client.name })} />
          <p className="text-sm text-ink-2">
            {fillWords(w.consent.from, { host })} ·{" "}
            <span className={client.verified ? "text-ink" : "font-medium text-danger-text"}>{client.verified ? w.consent.verified : w.consent.notVerified}</span>
          </p>
          {returnHost !== host && <p className="text-sm text-ink-2">{fillWords(w.consent.returnsTo, { host: returnHost })}</p>}
        </div>
      </div>
      {query.problem === "stores" && (
        <p role="alert" className="text-body text-danger-text">
          {w.consent.pickStore}
        </p>
      )}
      {stores.length === 0 ? (
        <>
          <p className="text-body text-ink">{w.consent.noStores}</p>
          <form action={decideAuthorizationAction}>
            {Object.entries(hidden).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <button type="submit" name="decision" value="deny" className="min-h-11 rounded-pill border border-edge px-5 text-sm font-medium">
              {w.consent.cancel}
            </button>
          </form>
        </>
      ) : (
        <OAuthConsentForm
          action={decideAuthorizationAction}
          hidden={hidden}
          stores={stores.map((s) => ({ id: s.id, name: s.name, unavailable: s.cutOff ? w.consent.cutOff : s.needsTwoStep ? w.consent.twoStep : null }))}
          scopes={levels.change.map((key) => ({ key, label: scopeLabel(w, key) }))}
          levelScopes={levels}
          words={{ ...w.consent, what: w.consent.what, levels: w.consent.levels }}
        />
      )}
      <p className="text-xs text-muted">
        {w.consent.later}{" "}
        <Link href="/admin/account/connected" className="underline">
          {w.consent.connected}
        </Link>
        .
      </p>
    </FocusFrame>
  );
}
