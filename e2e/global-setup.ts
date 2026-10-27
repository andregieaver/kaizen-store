import { testDb } from "./db";

/**
 * Before any spec: the stores the specs make stand for stores that are open to everyone, as they were before private mode (D339, decision 5:
 * a new store is private until it opens). So in this test database a new store starts public, and stores still in setup are opened to
 * visitors; the private-mode specs switch it on themselves. The rule itself is held by `src/db/commerce.test.ts` and the integration tests.
 */
export default async function globalSetup(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  const sql = testDb();
  try {
    await sql`alter table commerce.stores alter column private_mode set default false`;
    await sql`update commerce.stores set private_mode = false where private_mode`;
  } finally {
    await sql.end();
  }
}
