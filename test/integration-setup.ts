import postgres from "postgres";

/**
 * Before the integration tests: the stores they make stand for stores that are open to everyone, as they were before private mode (D339,
 * decision 5: a new store is private until it opens). So in this test database a new store starts public and stores still in setup are opened
 * to visitors; `private-mode.int.test.ts` switches it on itself, and `src/db/commerce.test.ts` holds the rule on the real default.
 */
export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`alter table commerce.stores alter column private_mode set default false`;
    await sql`update commerce.stores set private_mode = false where private_mode`;
  } finally {
    await sql.end();
  }
}
