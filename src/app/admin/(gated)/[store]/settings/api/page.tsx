import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { MakeApiToken, RevokeApiToken } from "@/components/admin/api-tokens";
import { Card, List, ListRow, PageHeader, RowActions, RowLead } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { API_ROUTES, API_SCOPES } from "@/lib/admin-api";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { siteUrl } from "@/lib/site";
import { listApiTokens } from "@/server/api-tokens";
import { requireOwnerRole } from "@/server/permissions";

import {
  addCustomAppAction,
  makeApiTokenAction,
  makeStorefrontTokenAction,
  relistCustomAppAction,
  removeCustomAppAction,
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
  const [tokens, storefrontTokens, apps] = await Promise.all([listApiTokens(store.id), listStorefrontTokens(store.id), listCustomApps(store.id)]);
  const aw = adminText(lang, "notifications").customApps;
  const sw = adminText(lang, "notifications").storefrontTokens;
  const when = (iso: string) => new Date(iso).toLocaleString(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone || "Europe/Oslo" });
  const base = `${siteUrl()}/api/admin/v1`;

  return (
    <AdminTextScope texts={adminTexts(lang, ["notifications"])}>
      <div className="flex flex-col gap-6">
        <PageHeader title={w.title} description={<>{w.description}</>} />
        <Card title={w.make} description={w.makeHint}>
          <p className="mb-4 text-sm text-muted">{w.actsAs}</p>
          <MakeApiToken scopes={[...API_SCOPES]} make={makeApiTokenAction.bind(null, store.slug)} />
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
                  <span className="block text-muted">{route.text}</span>
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
          </div>
        </Card>
      </div>
    </AdminTextScope>
  );
}
