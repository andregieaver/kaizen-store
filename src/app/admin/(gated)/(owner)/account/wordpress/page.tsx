import type { Metadata } from "next";
import { connection } from "next/server";

import { primaryButton, secondaryButton } from "@/components/admin/work/work-parts";
import { WORDPRESS_PLUGIN_FILE, WORDPRESS_PLUGIN_VERSION } from "@/lib/wordpress-plugin";
import { requireAccount } from "@/server/auth";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { connectionsOf } from "@/server/wordpress";
import { Card, CARD_CLASS, PageHeader } from "@/components/admin/ui";

import { revokeConnectionAction } from "./actions";

export const metadata: Metadata = { title: "WordPress" };

const when = (iso: string | null, never: string) => (iso ? iso.slice(0, 16).replace("T", " ") : never);

/**
 * The WordPress sites connected to the account's stores (D169, `docs/wordpress-plugin.md`): the plugin to download, and each site that
 * was approved, when it last read, and a way to disconnect it. A site reads the public catalogue of the stores the account belongs to,
 * and nothing else.
 */
export default async function WordpressPage() {
  await connection();
  const account = await requireAccount();
  const sites = await connectionsOf(account.id);
  const w = adminText(adminLangOf(account.adminLocale), "bookings").wordpress;
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="WordPress"
        description={w.intro}
      />

      <Card title={w.plugin} className="flex max-w-3xl flex-col gap-3" compact>
        <ol className="list-decimal pl-5 text-sm text-muted">
          <li>{fillWords(w.step1, { version: WORDPRESS_PLUGIN_VERSION })}</li>
          <li>{w.step2}</li>
          <li>{w.step3}</li>
        </ol>
        <div>
          <a href={WORDPRESS_PLUGIN_FILE} download className={primaryButton}>
            {w.download}
          </a>
        </div>
      </Card>

      <section aria-labelledby="sites-heading" className="flex max-w-3xl flex-col gap-3">
        <h2 id="sites-heading" className="text-title text-ink">
          {w.sites}
        </h2>
        {sites.length === 0 ? (
          <p className={`p-4 text-sm text-muted ${CARD_CLASS}`}>{w.noSites}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {sites.map((site) => (
              <li key={site.id} className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-line bg-card p-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">{site.siteName}</p>
                  <p className="truncate text-sm text-muted">{site.siteUrl}</p>
                  <p className="text-xs text-muted">
                    {fillWords(w.connected, { at: when(site.connectedAt, w.never), read: when(site.lastUsedAt, w.never) })}
                  </p>
                </div>
                <form action={revokeConnectionAction.bind(null, site.id)}>
                  <button type="submit" className={secondaryButton}>
                    {w.disconnect}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-muted">
          {w.disconnectHint}
        </p>
      </section>
    </div>
  );
}
