// A store with a domain of its own (P8), for e2e/store-hosts.spec.ts. Routing
// to stores' domains is read when the site is built, so this runs before
// `pnpm build` in CI's `hosts` job:
//
//   DATABASE_URL=postgres://... node e2e/hosts-seed.mjs
import postgres from "postgres";

// Kept in step with e2e/store-hosts.spec.ts.
const CUSTOM_STORE = "kari-domene";
const CUSTOM_HOST = "butikk.kari.localhost";

{
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values ('kari-domene@example.com', 'Kari', 'Karis Domene') returning id`;
    await sql`select commerce.approve_access_request(${request.id}, ${CUSTOM_STORE}, 'Karis Domene', null)`;
    await sql`
      insert into commerce.store_domains (store_id, hostname, token, status, is_primary, activated_at)
      select id, ${CUSTOM_HOST}, 'e2e', 'active', true, now() from commerce.stores where slug = ${CUSTOM_STORE}`;
    console.log(`${CUSTOM_STORE} is at ${CUSTOM_HOST}`);
  } finally {
    await sql.end();
  }
}
