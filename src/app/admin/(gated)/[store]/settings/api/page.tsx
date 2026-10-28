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

import { makeApiTokenAction, revokeApiTokenAction } from "./actions";

export const metadata: Metadata = { title: "Apps and API" };

/** Settings → Apps and API (D355): the Admin API's tokens, made and revoked by owners, and how to call it. */
export default async function ApiTokensPage({ params }: PageProps<"/admin/[store]/settings/api">) {
  const member = await requireOwnerRole((await params).store);
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "notifications").apiTokens;
  const tokens = await listApiTokens(store.id);
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
