import postgres from "postgres";

import type { StoreHosts } from "./paths";

/**
 * The stores' active custom domains (P8), read once when a deployment is
 * built: `next.config.ts` routes them and hands them to the code as
 * `NEXT_PUBLIC_STORE_HOSTS`. Only where stores have hosts (P7). Fails the
 * build rather than leave stores' domains unrouted.
 */
export async function readStoreHosts(): Promise<StoreHosts> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is needed to build the stores' domains.");
  const sql = postgres(url, { max: 1, onnotice: () => {}, prepare: false });
  try {
    const rows = await sql<{ slug: string; hostname: string; is_primary: boolean }[]>`
      select s.slug, d.hostname, d.is_primary
      from commerce.store_domains d
      join commerce.stores s on s.id = d.store_id
      where d.status = 'active'
      order by s.slug, d.hostname
    `;
    const hosts: StoreHosts = {};
    for (const row of rows) {
      const store = (hosts[row.slug] ??= { primary: null, hosts: [] });
      store.hosts.push(row.hostname);
      if (row.is_primary) store.primary = row.hostname;
    }
    return hosts;
  } finally {
    await sql.end();
  }
}
