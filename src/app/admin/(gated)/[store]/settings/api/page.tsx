import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AdminTextScope } from "@/components/admin/admin-text";
import { MakeApiToken, RevokeApiToken } from "@/components/admin/api-tokens";
import { buttonClass, Card, List, ListRow, PageHeader, RowActions, RowLead } from "@/components/admin/ui";
import { adminDate } from "@/lib/admin-date";
import { countWords, fillWords } from "@/lib/admin-fill";
import { PhoneRow, PhoneRows } from "@/components/admin/phone-row";
import { API_POWERS, API_SCOPES, isApiPower } from "@/lib/admin-api";
import { API_ROUTES } from "@/lib/admin-api-routes";
import { adminLangOf } from "@/lib/admin-lang";
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
import { QuietActionForm } from "@/components/admin/quiet-action-form";
import { STOREFRONT_ROUTES } from "@/lib/storefront-api";
import { areaTexts } from "@/lib/admin-area";
import { NOTIFICATIONS_WORDS } from "@/lib/admin-words/notifications";
import { NOTIFICATIONS_TOKENS_WORDS } from "@/lib/admin-words/notifications-tokens";
import { OAUTH_WORDS } from "@/lib/admin-words/oauth";
import { SCREENS_WORDS } from "@/lib/admin-words/screens";
import { listStorefrontTokens } from "@/server/storefront-api";

export const metadata: Metadata = { title: "Apps and API" };

/** A row's one action, which answers by what it does (code review 1.15, D829). */
function RowAction({ action, kind, children }: { action: (formData: FormData) => Promise<unknown>; kind: "danger" | "secondary"; children: ReactNode }) {
  return (
    <RowActions>
      <QuietActionForm action={action}>
        <button type="submit" className={buttonClass(kind, "dense")}>
          {children}
        </button>
      </QuietActionForm>
    </RowActions>
  );
}

/** Settings → Apps and API (D355): the Admin API's tokens, made and revoked by owners, and how to call it. */
export default async function ApiTokensPage({ params }: PageProps<"/admin/[store]/settings/api">) {
  const member = await requireOwnerRole((await params).store);
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = NOTIFICATIONS_WORDS[lang].apiTokens;
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
  const ow = OAUTH_WORDS[lang];
  const powerWords = w.scopeWords;
  const aw = NOTIFICATIONS_WORDS[lang].customApps;
  const sw = NOTIFICATIONS_WORDS[lang].storefrontTokens;
  const routeWords = SCREENS_WORDS[lang].storefrontRoutes;
  const when = (iso: string) => adminDate(store, iso, "dayTime", lang);
  const base = `${siteUrl()}/api/admin/v1`;
  // Round 27 (D700): on a phone what reaches the store is rows first, then making a token, then the rest as rows.
  const row = { change: w.phoneOpen, done: w.phoneClose, flat: true } as const;

  return (
    <AdminTextScope texts={areaTexts(lang, { notificationsTokens: NOTIFICATIONS_TOKENS_WORDS })}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={w.title}
          description={
            <>
              <span className="max-sm:hidden">{w.description}</span>
              <span className="sm:hidden">{w.phoneLead}</span>
            </>
          }
        />
        <PhoneRows>
        {/* Apps for many stores installed on this store (D441): each works as the person who installed it; Remove ends it at once. */}
        {installed.length > 0 && (
          <PhoneRow title={ow.store.apps.title} sub={countWords(installed.length, w.installedSub)} {...row}>
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
                              <QuietActionForm action={approveInstallationScopesAction.bind(null, store.slug, grant.id)} className="mt-2">
                                <button type="submit" className={buttonClass("main", "dense")}>
                                  {ow.store.apps.approve}
                                </button>
                              </QuietActionForm>
                            ) : (
                              <p className="mt-2 text-sm text-ink-2">{fillWords(ow.store.apps.installerCant, { person: grant.person.name ?? grant.person.email })}</p>
                            )}
                          </details>
                        )}
                      </>
                    }
                  />
                  <RowAction action={removeInstallationAction.bind(null, store.slug, grant.id)} kind="danger">
                    {ow.store.apps.remove}
                  </RowAction>
                </ListRow>
              ))}
            </List>
          </Card>
          </PhoneRow>
        )}
        {/* AI assistants and apps connected through Kaizena Flow's authorization server (D439): every grant that reaches the store. */}
        <PhoneRow title={ow.store.title} sub={grants.length > 0 ? countWords(grants.length, w.reachingSub) : w.noneReaching} {...row}>
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
                  <RowAction action={cutGrantAction.bind(null, store.slug, grant.id)} kind="danger">
                    {ow.store.cut}
                  </RowAction>
                </ListRow>
              ))}
            </List>
          )}
        </Card>
        </PhoneRow>
        {/* What an owner cut off stays cut off, whoever connects it again, until an owner lets it in again (D439 review). */}
        {cutoffs.length > 0 && (
          <PhoneRow title={ow.store.cutTitle} sub={countWords(cutoffs.length, w.cutSub)} {...row}>
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
                  <RowAction action={liftCutoffAction.bind(null, store.slug, cut.id)} kind="secondary">
                    {ow.store.letIn}
                  </RowAction>
                </ListRow>
              ))}
            </List>
          </Card>
          </PhoneRow>
        )}
        <PhoneRow title={w.inUse} sub={tokens.length > 0 ? countWords(tokens.length, w.tokensSub) : w.noneShort} {...row}>
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
        </PhoneRow>
        </PhoneRows>
        <Card title={w.make} description={w.makeHint}>
          <MakeApiToken kinds scopes={API_SCOPES.filter((scope) => !isApiPower(scope))} powers={[...API_POWERS]} make={makeApiTokenAction.bind(null, store.slug)} />
          <p className="mt-4 text-xs text-muted">{w.actsAs}</p>
        </Card>
        <PhoneRows>
        <PhoneRow title={sw.title} sub={storefrontTokens.length > 0 ? countWords(storefrontTokens.length, w.tokensSub) : w.storefrontSub} {...row}>
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
        </PhoneRow>
        <PhoneRow title={aw.title} sub={apps.length > 0 ? String(apps.length) : w.appsSub} {...row}>
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
        </PhoneRow>
        <PhoneRow title={w.referenceTitle} sub={w.referenceSub} {...row}>
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
        </PhoneRow>
        </PhoneRows>
      </div>
    </AdminTextScope>
  );
}
