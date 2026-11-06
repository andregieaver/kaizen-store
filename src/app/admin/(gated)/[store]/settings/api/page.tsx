import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { MakeApiToken, RevokeApiToken } from "@/components/admin/api-tokens";
import { buttonClass, Card, List, ListRow, PageHeader, RowActions, RowLead } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { API_POWERS, API_SCOPES, isApiPower } from "@/lib/admin-api";
import { API_ROUTES } from "@/lib/admin-api-routes";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { scopeLabel } from "@/lib/oauth-words";
import { siteUrl } from "@/lib/site";
import { listApiTokens } from "@/server/api-tokens";
import { grantsReachingStore, installationAsks, storeCutoffs } from "@/server/oauth";
import { requireOwnerRole } from "@/server/permissions";

import {
  addCustomAppAction,
  approveInstallationScopesAction,
  cutGrantAction,
  liftCutoffAction,
  makeApiTokenAction,
  makeStorefrontTokenAction,
  relistCustomAppAction,
  removeCustomAppAction,
  removeInstallationAction,
  revokeApiTokenAction,
  revokeStorefrontTokenAction,
  switchAppToolAction,
} from "./actions";
import { AddCustomApp, CustomAppCard } from "@/components/admin/custom-apps";
import { listCustomApps } from "@/server/custom-apps";
import { MakeStorefrontToken, RevokeStorefrontToken } from "@/components/admin/storefront-tokens";
import { STOREFRONT_ROUTES } from "@/lib/storefront-api";
import { listStorefrontTokens } from "@/server/storefront-api";

export const metadata: Metadata = { title: "Apps and API" };

/** Settings → Apps and API (D355): the Admin API's tokens, made and revoked by owners, and how to call it. */
export default async function ApiTokensPage({ params }: PageProps<"/admin/[store]/settings/api">) {
  const member = await requireOwnerRole((await params).store);
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "notifications").apiTokens;
  const [tokens, storefrontTokens, apps, reaching, cutoffs, asks] = await Promise.all([
    listApiTokens(store.id),
    listStorefrontTokens(store.id),
    listCustomApps(store.id),
    grantsReachingStore(store.id),
    storeCutoffs(store.id),
    installationAsks(store),
  ]);
  // Apps for many stores installed here (D441) are listed apart from the AI assistants and apps connected over MCP (D439).
  const installed = reaching.filter((grant) => grant.resource === "admin");
  const grants = reaching.filter((grant) => grant.resource === "mcp");
  const ow = adminText(lang, "oauth");
  const powerWords = w.scopeWords;
  const aw = adminText(lang, "notifications").customApps;
  const sw = adminText(lang, "notifications").storefrontTokens;
  const routeWords = adminText(lang, "screens").storefrontRoutes;
  const when = (iso: string) => new Date(iso).toLocaleString(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone || "Europe/Oslo" });
  const base = `${siteUrl()}/api/admin/v1`;

  return (
    <AdminTextScope texts={adminTexts(lang, ["notifications"])}>
      <div className="flex flex-col gap-6">
        <PageHeader title={w.title} description={<>{w.description}</>} />
        {/* Apps for many stores installed on this store (D441): each works as the person who installed it; Remove ends it at once. */}
        {installed.length > 0 && (
          <Card title={ow.store.apps.title} description={ow.store.apps.description}>
            <List label={ow.store.apps.title}>
              {installed.map((grant) => (
                <ListRow key={grant.id}>
                  <RowLead
                    title={grant.client.name}
                    sub={
                      <>
                        {grant.client.host} · {grant.client.verified ? ow.consent.verified : ow.consent.notVerified} ·{" "}
                        {fillWords(ow.store.apps.by, { person: grant.person.name ?? grant.person.email, when: when(grant.createdAt) })} ·{" "}
                        {grant.lastUsedAt ? fillWords(ow.connected.lastUsed, { when: when(grant.lastUsedAt) }) : ow.connected.neverUsed}
                        {asks.has(grant.id) && (
                          // Its app asks for more than this installation holds (D441 D2): what, in words, and Give it this.
                          <details className="mt-2">
                            <summary className="cursor-pointer text-sm text-ink">
                              {ow.store.apps.asksMore} · {ow.store.apps.review}
                            </summary>
                            <p className="mt-2 text-sm text-ink-2">{ow.store.apps.asksIntro}</p>
                            <ul className="mt-1 list-disc pl-5 text-sm text-ink-2">
                              {asks.get(grant.id)!.more.map((scope) => (
                                <li key={scope}>{isApiPower(scope) ? (powerWords[scope as keyof typeof powerWords] ?? scope) : scopeLabel(ow, scope)}</li>
                              ))}
                            </ul>
                            {asks.get(grant.id)!.installerCan ? (
                              <form action={approveInstallationScopesAction.bind(null, store.slug, grant.id)} className="mt-2">
                                <button type="submit" className={buttonClass("main", "dense")}>
                                  {ow.store.apps.approve}
                                </button>
                              </form>
                            ) : (
                              <p className="mt-2 text-sm text-ink-2">{fillWords(ow.store.apps.installerCant, { person: grant.person.name ?? grant.person.email })}</p>
                            )}
                          </details>
                        )}
                      </>
                    }
                  />
                  <RowActions>
                    <form action={removeInstallationAction.bind(null, store.slug, grant.id)}>
                      <button type="submit" className={buttonClass("danger", "dense")}>
                        {ow.store.apps.remove}
                      </button>
                    </form>
                  </RowActions>
                </ListRow>
              ))}
            </List>
          </Card>
        )}
        {/* AI assistants and apps connected through Kaizena Flow's authorization server (D439): every grant that reaches the store. */}
        <Card title={ow.store.title} description={ow.store.description}>
          {grants.length === 0 ? (
            <p className="text-sm text-muted">{ow.store.none}</p>
          ) : (
            <List label={ow.store.title}>
              {grants.map((grant) => (
                <ListRow key={grant.id}>
                  <RowLead
                    title={grant.client.name}
                    sub={
                      <>
                        {grant.client.host} · {grant.client.verified ? ow.consent.verified : ow.consent.notVerified} ·{" "}
                        {fillWords(ow.store.by, { person: grant.person.name ?? grant.person.email })} · {ow.consent.levels[grant.access]} ·{" "}
                        {grant.lastUsedAt ? fillWords(ow.connected.lastUsed, { when: when(grant.lastUsedAt) }) : ow.connected.neverUsed}
                      </>
                    }
                  />
                  <RowActions>
                    <form action={cutGrantAction.bind(null, store.slug, grant.id)}>
                      <button type="submit" className={buttonClass("danger", "dense")}>
                        {ow.store.cut}
                      </button>
                    </form>
                  </RowActions>
                </ListRow>
              ))}
            </List>
          )}
        </Card>
        {/* What an owner cut off stays cut off, whoever connects it again, until an owner lets it in again (D439 review). */}
        {cutoffs.length > 0 && (
          <Card title={ow.store.cutTitle} description={ow.store.cutDescription}>
            <List label={ow.store.cutTitle}>
              {cutoffs.map((cut) => (
                <ListRow key={cut.id}>
                  <RowLead
                    title={cut.client.name}
                    sub={
                      <>
                        {cut.client.host} · {fillWords(ow.store.cutFor, { person: cut.person.name ?? cut.person.email, when: when(cut.createdAt) })}
                      </>
                    }
                  />
                  <RowActions>
                    <form action={liftCutoffAction.bind(null, store.slug, cut.id)}>
                      <button type="submit" className={buttonClass("secondary", "dense")}>
                        {ow.store.letIn}
                      </button>
                    </form>
                  </RowActions>
                </ListRow>
              ))}
            </List>
          </Card>
        )}
        <Card title={w.make} description={w.makeHint}>
          <p className="mb-4 text-sm text-muted">{w.actsAs}</p>
          <MakeApiToken scopes={API_SCOPES.filter((scope) => !isApiPower(scope))} powers={[...API_POWERS]} make={makeApiTokenAction.bind(null, store.slug)} />
        </Card>
        <Card title={w.inUse}>
          {tokens.length === 0 ? (
            <p className="text-sm text-muted">{w.none}</p>
          ) : (
            <List label={w.inUse}>
              {tokens.map((token) => (
                <ListRow key={token.id}>
                  <RowLead
                    title={token.name}
                    sub={
                      <>
                        <code className="font-mono">{token.prefix}…</code> · {token.lastUsedAt ? fillWords(w.lastUsed, { when: when(token.lastUsedAt) }) : w.neverUsed} ·{" "}
                        {token.scopes.join(", ")}
                      </>
                    }
                  />
                  <RowActions>
                    <RevokeApiToken name={token.name} revoke={revokeApiTokenAction.bind(null, store.slug, token.id)} />
                  </RowActions>
                </ListRow>
              ))}
            </List>
          )}
        </Card>
        <Card title={sw.title} description={sw.description}>
          <div className="flex flex-col gap-4">
            <MakeStorefrontToken markets={store.markets.map((m) => ({ slug: m.slug, name: m.name }))} make={makeStorefrontTokenAction.bind(null, store.slug)} />
            {storefrontTokens.length === 0 ? (
              <p className="text-sm text-muted">{sw.none}</p>
            ) : (
              <List label={sw.title}>
                {storefrontTokens.map((token) => (
                  <ListRow key={token.id}>
                    <RowLead
                      title={token.name}
                      sub={
                        <>
                          <code className="break-all font-mono">{token.token}</code> · {token.market} ·{" "}
                          {token.lastUsedAt ? fillWords(sw.lastUsed, { when: when(token.lastUsedAt) }) : sw.neverUsed}
                        </>
                      }
                    />
                    <RowActions>
                      <RevokeStorefrontToken name={token.name} revoke={revokeStorefrontTokenAction.bind(null, store.slug, token.id)} />
                    </RowActions>
                  </ListRow>
                ))}
              </List>
            )}
            <p className="text-sm text-ink-2">{fillWords(sw.how, { base: `${siteUrl()}/api/storefront/v1`, store: store.slug })}</p>
            <ul className="flex flex-col gap-2 text-xs">
              {STOREFRONT_ROUTES.map((route) => (
                <li key={`${route.method} ${route.path}`}>
                  <span className="font-mono">{`${route.method.padEnd(6, " ")} /api/storefront/v1/${store.slug}${route.path}`}</span>
                  <span className="block text-muted">{routeWords[route.what] ?? route.text}</span>
                </li>
              ))}
            </ul>
            <a href={`${siteUrl()}/api/storefront/v1/openapi.json`} className="self-start text-sm underline underline-offset-2">
              {sw.contract}
            </a>
          </div>
        </Card>
        <Card title={aw.title} description={aw.description}>
          <div className="flex flex-col gap-5">
            <p className="text-sm text-muted">{aw.note}</p>
            {apps.length === 0 ? (
              <p className="text-sm text-muted">{aw.none}</p>
            ) : (
              apps.map((app) => (
                <CustomAppCard
                  key={app.id}
                  app={{ id: app.id, name: app.name, endpointHint: app.endpointHint, tokenHint: app.tokenHint, tools: app.tools.map((t) => ({ name: t.name, description: t.description })), switched: app.switched, calls: app.calls, failed: app.failed, problem: app.problem }}
                  actions={{
                    switchTool: switchAppToolAction.bind(null, store.slug, app.id),
                    relist: relistCustomAppAction.bind(null, store.slug, app.id),
                    remove: removeCustomAppAction.bind(null, store.slug, app.id),
                  }}
                />
              ))
            )}
            <AddCustomApp add={addCustomAppAction.bind(null, store.slug)} />
          </div>
        </Card>
        <Card title={w.howTitle} compact>
          <div className="flex flex-col gap-3 text-sm text-ink-2">
            <p>{fillWords(w.how, { base })}</p>
            <h3 className="text-body-strong text-ink">{w.routesTitle}</h3>
            <ul className="flex flex-col gap-1 font-mono text-xs">
              {API_ROUTES.map((route) => (
                <li key={`${route.method} ${route.path}`}>
                  {`${route.method.padEnd(6, " ")} ${route.path}`} <span className="text-muted">{`(${route.scope})`}</span>
                </li>
              ))}
            </ul>
            <a href={`${base}/openapi.json`} className="self-start text-sm underline underline-offset-2">
              {w.contract}
            </a>
          </div>
        </Card>
      </div>
    </AdminTextScope>
  );
}
