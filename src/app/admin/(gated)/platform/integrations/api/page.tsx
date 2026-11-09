import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { AdminTextScope } from "@/components/admin/admin-text";
import { MakeApiToken, RevokeApiToken } from "@/components/admin/api-tokens";
import { Card, List, ListRow, PageHeader, RowActions, RowLead } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { PLATFORM_API_OPERATIONS, PLATFORM_API_SCOPES } from "@/lib/platform-api";
import { siteUrl } from "@/lib/site";
import { platformCan, requirePlatformReader } from "@/server/auth";
import { listPlatformTokens } from "@/server/platform-api-tokens";

import { makePlatformTokenAction, revokePlatformTokenAction } from "./actions";

export const metadata: Metadata = { title: "API" };

/**
 * Kaizena Flow's own API (C4 step 4, D517): a store's Apps and API (D355) for the platform. A platform owner makes a token with the scopes
 * it needs, sees it once and revokes it; every role on the team sees the tokens in use (their names and first characters only) and the routes.
 */
export default async function PlatformApiPage() {
  await connection();
  const admin = await requirePlatformReader();
  const lang = adminLangOf(admin.adminLocale);
  const w = adminText(lang, "notifications").apiTokens;
  const own = adminText(lang, "platform");
  const owner = platformCan(admin, "settings");
  const tokens = await listPlatformTokens();
  const when = (iso: string) => new Date(iso).toLocaleString(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });
  const base = `${siteUrl()}/api/platform/v1`;

  return (
    <AdminTextScope texts={adminTexts(lang, ["notifications"])}>
      <div className="flex flex-col gap-6">
        <div>
          <Link href="/admin/platform/integrations" className="text-sm underline">
            {own.integrations.title}
          </Link>
          <PageHeader title={own.api.title} description={<>{own.api.description}</>} />
        </div>
        {owner ? (
          <Card title={w.make} description={w.makeHint}>
            <p className="mb-4 text-sm text-muted">{own.api.actsAs}</p>
            <MakeApiToken scopes={[...PLATFORM_API_SCOPES]} powers={[]} make={makePlatformTokenAction} scopeWords={own.api.scopeWords} />
          </Card>
        ) : (
          <p className="text-sm text-ink-2">{own.api.ownerOnly}</p>
        )}
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
                        <code className="font-mono">{token.prefix}…</code> · {token.lastUsedAt ? fillWords(w.lastUsed, { when: when(token.lastUsedAt) }) : w.neverUsed} · {token.scopes.join(", ")}
                      </>
                    }
                  />
                  {owner && (
                    <RowActions>
                      <RevokeApiToken name={token.name} revoke={revokePlatformTokenAction.bind(null, token.id)} />
                    </RowActions>
                  )}
                </ListRow>
              ))}
            </List>
          )}
        </Card>
        <Card title={w.howTitle}>
          <div className="flex flex-col gap-3 text-sm text-ink-2">
            <p>{fillWords(own.api.how, { base })}</p>
            <h3 className="text-body-strong text-ink">{w.routesTitle}</h3>
            <ul className="flex flex-col gap-1">
              {PLATFORM_API_OPERATIONS.map((operation) => (
                <li key={operation.path}>
                  <code className="font-mono">GET {operation.path}</code> · {operation.scope}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>
    </AdminTextScope>
  );
}
