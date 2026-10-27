import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { signUnlock, unlockCookieName } from "@/lib/unlock-pass";

import { makeStore, ownerOf, type Fixture } from "./invoice-test-fixture";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
// The request's cookies, as each case sets them.
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined), set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));

process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const { setPrivateMode, setPrivatePassword, signEveryoneOut, openToEveryone, privateState, privatePasswordMatches, lockedOut, mintUnlock } = await import("./private-mode");
const { privateGate, forgetStoreFacts } = await import("./redirect-resolve");
const { listPublicStores, storeRobots } = await import("./seo");
const { getStore } = await import("./stores");

type Row = Record<string, unknown>;

/**
 * Private mode (wave 7 unit E, D339, `docs/wave-7-storefront.md` E): the writers keep and audit the state and the password (a scrypt hash), the
 * proxy's gate shows the landing page for every page but what was already sold, a pass for the password ends with a new version, and a private
 * store is listed nowhere a crawler reads. The test database's stores start public (`test/integration-setup.ts`); this one is made private here.
 */

let fx: Fixture;

beforeAll(async () => {
  fx = await makeStore("private-mode");
  await db().execute(sql`update commerce.stores set setup_completed_at = now() where id = ${fx.storeId}::uuid`);
}, 120_000);

afterAll(async () => {
  await closeDb();
});

const audits = async (action: string) =>
  (await db().execute<Row>(sql`select details from commerce.audit_log where store_id = ${fx.storeId}::uuid and action = ${action} order by created_at`)).map((r) => r.details);

describe("the writers", () => {
  it("switch private mode on and off, audited each time and never twice for the same state", async () => {
    const owner = await ownerOf(fx);
    expect(await setPrivateMode(owner, true)).toEqual({ ok: true });
    expect(await setPrivateMode(owner, true)).toEqual({ ok: true });
    expect((await privateState(fx.storeId))?.private).toBe(true);
    expect(await audits("store.private_mode")).toEqual([{ on: true }]);
    // A member who may not change the settings cannot.
    expect(await setPrivateMode({ ...owner, role: "read_only" as never, permissions: [] } as never, false)).toMatchObject({ ok: false });
  });

  it("keep the password as a scrypt hash only, refuse a short one, and raise the version with each change", async () => {
    const owner = await ownerOf(fx);
    const before = (await privateState(fx.storeId))!.version;
    expect(await setPrivatePassword(owner, "abc")).toEqual({ ok: false, problem: "short" });
    expect(await setPrivatePassword(owner, "open sesame")).toEqual({ ok: true });
    const state = (await privateState(fx.storeId))!;
    expect(state.password).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(state.password).not.toContain("open sesame");
    expect(state.version).toBe(before + 1);
    expect(await privatePasswordMatches(state.password, "open sesame")).toBe(true);
    expect(await privatePasswordMatches(state.password, "open sesame ")).toBe(false);
    expect(await audits("store.private_password")).toEqual([{ set: true }]);
    expect(await signEveryoneOut(owner)).toEqual({ ok: true });
    expect((await privateState(fx.storeId))!.version).toBe(before + 2);
  });
});

describe("the gate", () => {
  it("shows the landing page for the store's pages, keeps the order's and My account's open, and nothing for a public store", async () => {
    forgetStoreFacts(fx.slug);
    const market = (await getStore(fx.slug))!.markets[0].slug;
    const gate = await privateGate(`/s/${fx.slug}/${market}/p/anything`, null);
    expect(gate).toMatchObject({ storeId: fx.storeId, landing: `/s/${fx.slug}/private/${market}` });
    expect(await privateGate(`/s/${fx.slug}/${market}/order/123`, null)).toBeNull();
    expect(await privateGate(`/s/${fx.slug}/${market}/account`, null)).toBeNull();
    expect(await privateGate(`/s/${fx.slug}/private/${market}`, null)).toBeNull();
    // On the store's own host, the landing page is at the root.
    expect(await privateGate(`/${market}/p/anything`, fx.slug)).toMatchObject({ landing: `/private/${market}` });
  });

  it("lets in a visitor with a pass for the current version or a staff pass, and nobody else", async () => {
    const store = (await getStore(fx.slug))!;
    const { version } = (await privateState(fx.storeId))!;
    jar.clear();
    expect(await lockedOut(store)).toBe(true);
    jar.set(unlockCookieName(fx.storeId), mintUnlock("password", store, version)!);
    expect(await lockedOut(store)).toBe(false);
    jar.set(unlockCookieName(fx.storeId), mintUnlock("password", store, version - 1)!);
    expect(await lockedOut(store)).toBe(true);
    jar.set(unlockCookieName(fx.storeId), mintUnlock("staff", store, 0)!);
    expect(await lockedOut(store)).toBe(false);
    // Signed by another server's secret: nothing.
    jar.set(unlockCookieName(fx.storeId), signUnlock(Buffer.alloc(32, 9), { kind: "staff", storeId: fx.storeId, store: fx.slug, version: 0 }));
    expect(await lockedOut(store)).toBe(true);
    jar.clear();
  });
});

describe("crawlers", () => {
  it("find a private store in no list, and its robots.txt shuts everything", async () => {
    const listed = (await listPublicStores()).find((s) => s.slug === fx.slug);
    expect(listed?.indexable).toBe(false);
    expect(listed?.private).toBe(true);
    const store = (await getStore(fx.slug))!;
    expect(await storeRobots(store)).toMatch(/User-agent: \*[\s\S]*Disallow: \/s\/[a-z0-9-]+\/\n|Disallow: \/\n/);
  });
});

describe("opening the store", () => {
  it("makes it public, audited, and the gate lets everyone through", async () => {
    await openToEveryone(fx.ownerId, { id: fx.storeId, slug: fx.slug });
    expect((await privateState(fx.storeId))?.private).toBe(false);
    expect((await audits("store.private_mode")).at(-1)).toEqual({ on: false, via: "opened" });
    forgetStoreFacts(fx.slug);
    const market = (await getStore(fx.slug))!.markets[0].slug;
    expect(await privateGate(`/s/${fx.slug}/${market}/p/anything`, null)).toBeNull();
  });
});
