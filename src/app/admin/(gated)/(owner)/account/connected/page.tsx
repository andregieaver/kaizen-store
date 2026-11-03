import type { Metadata } from "next";
import { connection } from "next/server";

import { Card, CARD_CLASS, PageHeader, buttonClass } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { resourceUrl } from "@/lib/oauth";
import { siteUrl } from "@/lib/site";
import { requireAccount } from "@/server/auth";
import { grantsOfAccount } from "@/server/oauth";

import { disconnectGrantAction } from "./actions";

export const metadata: Metadata = { title: "Connected apps and assistants" };

/**
 * Account → Connected apps and assistants (wave 14 unit B, D439, B7): each AI assistant or app the person let work with their stores, the
 * stores it reaches, its access level and when it was last used, with *Disconnect*, which ends it at once. Everyone's own page, owners and
 * staff alike: a grant acts as the person who made it.
 */
export default async function ConnectedAppsPage() {
  await connection();
  const account = await requireAccount();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "oauth");
  const grants = await grantsOfAccount(account.id);
  const when = (iso: string) => new Date(iso).toLocaleString(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={w.connected.title} description={w.connected.description} />
      {grants.length === 0 ? (
        <p className={`max-w-3xl p-4 text-sm text-muted ${CARD_CLASS}`}>{fillWords(w.connected.none, { address: resourceUrl(siteUrl(), "mcp") })}</p>
      ) : (
        <ul className="flex max-w-3xl flex-col gap-3">
          {grants.map((grant) => (
            <li key={grant.id}>
              <Card compact>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{grant.client.name}</p>
                    <p className="text-sm text-muted">
                      {fillWords(w.consent.from, { host: grant.client.host })} · {grant.client.verified ? w.consent.verified : w.consent.notVerified}
                    </p>
                    <p className="text-sm text-ink-2">{fillWords(w.connected.stores, { stores: grant.stores.map((s) => s.name).join(", ") })}</p>
                    <p className="text-sm text-ink-2">{fillWords(w.connected.level, { level: w.consent.levels[grant.access] })}</p>
                    <p className="text-xs text-muted">
                      {fillWords(w.connected.since, { when: when(grant.createdAt) })} ·{" "}
                      {grant.lastUsedAt ? fillWords(w.connected.lastUsed, { when: when(grant.lastUsedAt) }) : w.connected.neverUsed}
                    </p>
                  </div>
                  <form action={disconnectGrantAction.bind(null, grant.id)}>
                    <button type="submit" className={buttonClass("danger")}>
                      {w.connected.disconnect}
                    </button>
                  </form>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
