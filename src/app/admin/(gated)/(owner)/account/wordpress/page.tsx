import type { Metadata } from "next";
import { connection } from "next/server";

import { primaryButton, secondaryButton } from "@/components/admin/work/work-parts";
import { WORDPRESS_PLUGIN_FILE, WORDPRESS_PLUGIN_VERSION } from "@/lib/wordpress-plugin";
import { requireAccount } from "@/server/auth";
import { connectionsOf } from "@/server/wordpress";

import { revokeConnectionAction } from "./actions";

export const metadata: Metadata = { title: "WordPress" };

const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") : "never");

/**
 * The WordPress sites connected to the account's stores (D169, `docs/wordpress-plugin.md`): the plugin to download, and each site that
 * was approved, when it last read, and a way to disconnect it. A site reads the public catalogue of the stores the account belongs to,
 * and nothing else.
 */
export default async function WordpressPage() {
  await connection();
  const account = await requireAccount();
  const sites = await connectionsOf(account.id);
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">WordPress</h1>
        <p className="max-w-3xl text-sm text-muted">
          Show products from your stores on a WordPress site, as a grid or a carousel, with a shortcode. Install the plugin on the site, choose
          Connect, and approve here. The site can read the products, prices and pictures your stores show shoppers, for the stores you belong to,
          and nothing else: no orders, customers or settings, and it cannot change anything.
        </p>
      </div>

      <section aria-labelledby="plugin-heading" className="flex max-w-3xl flex-col gap-3 rounded-lg border border-border bg-background p-5">
        <h2 id="plugin-heading" className="font-medium">
          The plugin
        </h2>
        <ol className="list-decimal pl-5 text-sm text-muted">
          <li>Download the plugin (version {WORDPRESS_PLUGIN_VERSION}).</li>
          <li>In WordPress, open Plugins, Add New Plugin, Upload Plugin, choose the file and activate it.</li>
          <li>Open Kaizen in the WordPress menu, choose Connect to Kaizen, and approve the connection on the page that opens here.</li>
        </ol>
        <div>
          <a href={WORDPRESS_PLUGIN_FILE} download className={primaryButton}>
            Download the plugin
          </a>
        </div>
      </section>

      <section aria-labelledby="sites-heading" className="flex max-w-3xl flex-col gap-3">
        <h2 id="sites-heading" className="font-medium">
          Connected sites
        </h2>
        {sites.length === 0 ? (
          <p className="rounded-lg border border-border bg-background p-4 text-sm text-muted">No site is connected.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {sites.map((site) => (
              <li key={site.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background p-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">{site.siteName}</p>
                  <p className="truncate text-sm text-muted">{site.siteUrl}</p>
                  <p className="text-xs text-muted">
                    Connected {when(site.connectedAt)}. Last read {when(site.lastUsedAt)}.
                  </p>
                </div>
                <form action={revokeConnectionAction.bind(null, site.id)}>
                  <button type="submit" className={secondaryButton}>
                    Disconnect
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-muted">
          Disconnecting ends the site's access at once. Its shortcodes stop showing products as soon as the site's saved lists run out (within ten
          minutes), until it is connected again. The site reads as you, so it sees the stores you belong to now, and loses a store when you do.
        </p>
      </section>
    </div>
  );
}
