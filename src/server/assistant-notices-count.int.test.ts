import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const sent = vi.hoisted(() => ({ n: 0 }));

vi.mock("@/db/client", async (original) => {
  const real = await original<typeof import("@/db/client")>();
  return {
    ...real,
    db: () =>
      new Proxy(real.db(), {
        get(target, property, receiver) {
          if (property === "execute")
            return (query: never) => {
              sent.n += 1;
              return target.execute(query);
            };
          return Reflect.get(target, property, receiver);
        },
      }),
  };
});

const { closeDb, db } = await import("@/db/client");
const { makeStore } = await import("./trust-fixtures");
const notices = await import("./assistant-notices");

/** The notice badge's count (bloat review step 0.17): with the route's account read, 2 statements (4 before: the account, the store by slug, a list of one, the count). Step 1.9's counter replaces this wrapper. */
let store: Awaited<ReturnType<typeof makeStore>>;

beforeAll(async () => {
  store = await makeStore("notice-count");
  await notices.addNotice({ accountId: store.account.id, storeId: store.id, notice: "page_built", ref: "count-1", path: "pages/abc", facts: { title: "About us" } });
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.assistant_notices where account_id = ${store.account.id}::uuid`);
  await closeDb();
});

describe("the notice badge", () => {
  it("the badge's count is one statement", async () => {
    sent.n = 0;
    expect(await notices.unreadNotices(store.account.id, store.id)).toBe(1);
    expect(sent.n).toBe(1);
  });
});
