import Link from "next/link";

import { buttonClass, FocusFrame, FocusHeading } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { type AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { normaliseAppScopes, powersOf } from "@/lib/apps";
import { clientHost, STORES_READ, type AuthorizeRequest } from "@/lib/oauth";
import { scopeLabel } from "@/lib/oauth-words";
import type { Account } from "@/server/auth";
import { appOfClient } from "@/server/developer-apps";
import { installable, installStores } from "@/server/oauth-authorize";
import type { OAuthClient } from "@/server/oauth-clients";

import { decideInstallAction } from "./actions";

/**
 * The consent screen for an app for many stores (D441, unit D): the app, its host and whether Kaizena Flow verified it, what it asks for in
 * words (each scope, then its powers), its homepage, privacy policy and support, and one store to install it on. A store is offered only
 * where the person may give everything the app asks for, and a private app only on its developer's own stores; the others are shown with
 * why. No level to choose: an app gets what it asked for, never beyond the person's role at each call.
 */
export async function AppInstall({
  lang,
  account,
  aal,
  client,
  request,
  hidden,
}: {
  lang: AdminLang;
  account: Account;
  aal: "aal1" | "aal2";
  client: OAuthClient;
  request: AuthorizeRequest;
  hidden: Record<string, string>;
}) {
  const w = adminText(lang, "oauth");
  const scopeWords = adminText(lang, "notifications").apiTokens.scopeWords;
  const app = await appOfClient(client.id);
  if (!app) {
    return (
      <FocusFrame lang={lang}>
        <FocusHeading title={w.consent.cannot} />
        <p className="text-body text-ink">{w.consent.reasons.client}</p>
      </FocusFrame>
    );
  }
  const stores = await installStores(account, aal, app);
  const offered = stores.filter(installable);
  const scopes = normaliseAppScopes(app.scopes);
  const asks = scopes.filter((s) => s !== STORES_READ && !powersOf([s]).length);
  const powers = powersOf(scopes);
  const host = clientHost(client, request.redirectUri);
  return (
    <FocusFrame lang={lang} width="wide">
      <div className="flex items-start gap-4">
        {app.logoUrl && (
          // The app's own logo, from its own HTTPS address: no referrer is sent with it (the page's policy).
          // eslint-disable-next-line @next/next/no-img-element
          <img src={app.logoUrl} alt="" width={48} height={48} referrerPolicy="no-referrer" className="size-12 shrink-0 rounded-tile object-contain" />
        )}
        <div className="flex flex-col gap-1">
          <FocusHeading title={fillWords(w.consent.app.heading, { app: app.name })} />
          <p className="text-sm text-ink-2">
            {fillWords(w.consent.from, { host })} ·{" "}
            <span className={app.verified ? "text-ink" : "font-medium text-danger-text"}>{app.verified ? w.consent.verified : w.consent.notVerified}</span>
          </p>
        </div>
      </div>
      <p className="text-body text-ink">{fillWords(w.consent.app.intro, { app: app.name })}</p>
      {app.description && <p className="text-sm text-ink-2 whitespace-pre-line">{app.description}</p>}
      <section aria-labelledby="app-asks" className="flex flex-col gap-2">
        <h2 id="app-asks" className="text-body-strong text-ink">
          {w.consent.app.asks}
        </h2>
        <ul className="list-disc pl-5 text-sm text-ink">
          {asks.map((scope) => (
            <li key={scope}>{scopeLabel(w, scope)}</li>
          ))}
        </ul>
        {powers.length > 0 && (
          <>
            <h2 className="text-body-strong text-ink">{w.consent.app.powers}</h2>
            <ul className="list-disc pl-5 text-sm text-ink">
              {powers.map((power) => (
                <li key={power}>{scopeWords[power] ?? power}</li>
              ))}
            </ul>
          </>
        )}
      </section>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {app.homepageUrl && (
          <a href={app.homepageUrl} rel="noreferrer nofollow" className="underline">
            {w.consent.app.homepage}
          </a>
        )}
        {app.privacyUrl && (
          <a href={app.privacyUrl} rel="noreferrer nofollow" className="underline">
            {w.consent.app.privacy}
          </a>
        )}
        {app.supportEmail && <span className="text-ink-2">{fillWords(w.consent.app.support, { email: app.supportEmail })}</span>}
      </p>
      <form action={decideInstallAction} className="flex flex-col gap-4">
        {Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        {stores.length === 0 || offered.length === 0 ? (
          <p className="text-body text-ink">{w.consent.app.noStores}</p>
        ) : null}
        {stores.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-body-strong text-ink">{w.consent.app.store}</legend>
            <p className="text-sm text-muted">{w.consent.app.storeHint}</p>
            {stores.map((store) => {
              const ok = installable(store);
              const why = store.notDevelopers ? w.consent.app.notDevelopers : store.needsTwoStep ? w.consent.twoStep : store.missing.length > 0 ? w.consent.app.missing : null;
              return (
                <label key={store.id} className={`flex items-start gap-3 rounded-tile border border-edge p-3 ${ok ? "" : "opacity-70"}`}>
                  <input type="radio" name="store" value={store.id} disabled={!ok} defaultChecked={ok && offered[0]?.id === store.id} className="mt-1 size-4" />
                  <span className="flex flex-col">
                    <span className="text-body text-ink">{store.name}</span>
                    {why && <span className="text-sm text-muted">{why}</span>}
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}
        <div className="flex flex-wrap gap-3">
          {offered.length > 0 && (
            <button type="submit" name="decision" value="approve" className={buttonClass("main", "header")}>
              {w.consent.app.install}
            </button>
          )}
          <button type="submit" name="decision" value="deny" formNoValidate className={buttonClass("secondary", "header")}>
            {w.consent.cancel}
          </button>
        </div>
      </form>
      <p className="text-xs text-muted">
        {w.consent.app.later}{" "}
        <Link href="/admin/account/connected" className="underline">
          {w.consent.connected}
        </Link>
        .
      </p>
    </FocusFrame>
  );
}
