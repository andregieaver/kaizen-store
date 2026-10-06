import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { PERMISSION_KEYS } from "@/lib/permissions";

import { addMember, fakeAuthState, fakeSupabase, linkAuthUser, makeAccount, makeStore } from "./trust-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
const auth = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => auth.client }));

const p = await import("./permissions");
const roles = await import("./store-roles");

type Row = Record<string, unknown>;

/**
 * The guards every store admin page, action and route asks (wave 1, 1f, docs/wave-1-trust.md 2.7.1): the owner holds everything, an admin with no
 * role the default set, a member with a role that role's keys, and nobody the owner-only keys. A page answers a 404 (so a hidden page cannot be told
 * from a missing one), an action a refusal; a member held at their second step is sent to set it up.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
let ownerSub: string;
const people = new Map<string, string>();

const signInAs = (sub: string | null, overrides: Parameters<typeof fakeAuthState>[0] = {}) => {
  auth.client = fakeSupabase(fakeAuthState({ sub, ...overrides }));
};

async function person(label: string, role: "owner" | "admin", extra: Parameters<typeof addMember>[3] = {}) {
  const account = await makeAccount(label);
  const sub = await linkAuthUser(account.id);
  await addMember(store.id, account.id, role, extra);
  people.set(label, sub);
  return { account, sub };
}

beforeAll(async () => {
  store = await makeStore("guards");
  ownerSub = await linkAuthUser(store.account.id);
  await roles.ensureStoreRoles(store.id);
});

beforeEach(() => {
  signInAs(ownerSub);
});

afterAll(async () => {
  await closeDb();
});

const pageGuard = (key: Parameters<typeof p.requirePermission>[1]) => p.requirePermission(store.slug, key);

describe("the owner", () => {
  it("holds every key, the owner-only ones included", async () => {
    for (const key of PERMISSION_KEYS) expect((await pageGuard(key)).role).toBe("owner");
    expect(await p.checkPermission(store.slug, "staff:write")).not.toBeNull();
    expect((await p.requireOwnerRole(store.slug)).store.slug).toBe(store.slug);
    expect(await p.checkOwnerRole(store.slug)).not.toBeNull();
  });
});

describe("an admin with no role", () => {
  it("holds the default set: every read and change of the working areas, and a look at the team and the plan", async () => {
    const { sub } = await person("plain-admin", "admin");
    signInAs(sub);
    for (const area of ["orders", "products", "customers", "marketing", "analytics", "website", "bookings", "settings"]) {
      expect((await pageGuard(`${area}:write` as never)).role).toBe("admin");
    }
    expect(await pageGuard("staff:read")).toBeTruthy();
    expect(await pageGuard("billing:read")).toBeTruthy();
  });

  it("is refused what only the owner holds: the owner key, the team's and the plan's changes", async () => {
    signInAs(people.get("plain-admin")!);
    for (const key of ["owner", "staff:write", "billing:write"] as const) {
      await expect(pageGuard(key)).rejects.toThrow("NEXT_NOT_FOUND");
      expect(await p.checkPermission(store.slug, key)).toBeNull();
    }
    await expect(p.requireOwnerRole(store.slug)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await p.checkOwnerRole(store.slug)).toBeNull();
  });

  it("may use the pages that need membership only", async () => {
    signInAs(people.get("plain-admin")!);
    expect((await p.requireMemberAny(store.slug)).role).toBe("admin");
    expect(await p.checkMemberAny(store.slug)).not.toBeNull();
  });
});

describe("a member with a role", () => {
  let clerkSub: string;
  beforeAll(async () => {
    const [orders] = await db().execute<Row>(sql`select id from commerce.store_roles where store_id = ${store.id}::uuid and template = 'orders'`);
    clerkSub = (await person("clerk", "admin", { roleId: String(orders.id) })).sub;
  });

  it("holds the keys of the role: the orders template changes orders and looks at customers and products", async () => {
    signInAs(clerkSub);
    expect((await pageGuard("orders:write")).roleName).toBe("Orders");
    expect(await pageGuard("customers:read")).toBeTruthy();
    expect(await pageGuard("products:read")).toBeTruthy();
  });

  it("is refused every other area with a 404 on a page and a null in an action, and cannot change what the role only lets them see", async () => {
    signInAs(clerkSub);
    for (const key of ["marketing:read", "website:write", "settings:read", "analytics:read", "customers:write", "products:write", "staff:read", "billing:read", "owner"] as const) {
      await expect(pageGuard(key)).rejects.toThrow("NEXT_NOT_FOUND");
      expect(await p.checkPermission(store.slug, key)).toBeNull();
    }
    // Membership only is still theirs.
    expect(await p.requireMemberAny(store.slug)).toBeTruthy();
  });

  it("takes the role's keys as they are now: a change to the role reaches the member at once", async () => {
    signInAs(clerkSub);
    const [orders] = await db().execute<Row>(sql`select id from commerce.store_roles where store_id = ${store.id}::uuid and template = 'orders'`);
    await db().execute(sql`update commerce.store_roles set permissions = array['orders:read'] where id = ${String(orders.id)}::uuid`);
    try {
      await expect(pageGuard("orders:write")).rejects.toThrow("NEXT_NOT_FOUND");
      expect(await pageGuard("orders:read")).toBeTruthy();
    } finally {
      await db().execute(sql`update commerce.store_roles set permissions = array['orders:read', 'orders:write', 'customers:read', 'products:read', 'bookings:read'] where id = ${String(orders.id)}::uuid`);
    }
  });
});

describe("the page builder's guards: a kind of page is worked on in its own area, and what the builder calls on the side by any of the builder's areas", () => {
  it("gives a kind of page the key of its place: website pages to the website, product layouts to products, an A/B test's versions to marketing", async () => {
    const [content] = await db().execute<Row>(sql`select id from commerce.store_roles where store_id = ${store.id}::uuid and template = 'content'`);
    const [productsRole] = await db().execute<Row>(sql`select id from commerce.store_roles where store_id = ${store.id}::uuid and template = 'products'`);
    const writer = await person("content-writer", "admin", { roleId: String(content.id) });
    const merchant = await person("merchant", "admin", { roleId: String(productsRole.id) });

    signInAs(writer.sub);
    for (const type of ["page", "article", "header", "footer"]) expect(await p.checkPageTypeAccess(store.slug, type, "write")).not.toBeNull();
    for (const type of ["product_layout", "variant"]) expect(await p.checkPageTypeAccess(store.slug, type, "write")).toBeNull();
    // Reading a product layout is theirs too (the content role looks at products), changing it is not.
    await expect(p.requirePageTypeAccess(store.slug, "product_layout", "write")).rejects.toThrow("NEXT_NOT_FOUND");

    signInAs(merchant.sub);
    expect(await p.checkPageTypeAccess(store.slug, "product_layout", "write")).not.toBeNull();
    expect(await p.checkPageTypeAccess(store.slug, "page", "write")).toBeNull();
    await expect(p.requirePageTypeAccess(store.slug, "page", "read")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("refuses a kind that is none, for everyone but with the same answer as a missing page", async () => {
    signInAs(ownerSub);
    expect(await p.checkPageTypeAccess(store.slug, "nonsense", "write")).toBeNull();
    expect(await p.checkPageTypeAccess(store.slug, undefined, "read")).toBeNull();
    await expect(p.requirePageTypeAccess(store.slug, "nonsense", "read")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("lets a member through when any of the keys is theirs, and no one else", async () => {
    const writer = people.get("content-writer")!;
    const merchant = people.get("merchant")!;
    signInAs(writer);
    expect(await p.checkAnyPermission(store.slug, ["products:write", "website:write"])).not.toBeNull();
    expect(await p.checkAnyPermission(store.slug, ["products:write", "marketing:write"])).toBeNull();
    signInAs(merchant);
    expect(await p.checkAnyPermission(store.slug, ["products:write", "website:write"])).not.toBeNull();
    await expect(p.requireAnyPermission(store.slug, ["website:write", "marketing:write"])).rejects.toThrow("NEXT_NOT_FOUND");
    signInAs(null);
    expect(await p.checkAnyPermission(store.slug, ["products:write"])).toBeNull();
  });
});

describe("collaborators", () => {
  it("never reach the team or the plan, whatever their role holds, and lose everything at the expiry", async () => {
    const { account, sub } = await person("agency", "admin", { kind: "collaborator", expiresAt: new Date(Date.now() + 3_600_000) });
    signInAs(sub);
    expect(await pageGuard("orders:write")).toBeTruthy();
    for (const key of ["staff:read", "billing:read", "owner"] as const) await expect(pageGuard(key)).rejects.toThrow("NEXT_NOT_FOUND");
    await db().execute(sql`update commerce.store_members set expires_at = now() - interval '1 second' where store_id = ${store.id}::uuid and account_id = ${account.id}::uuid`);
    await expect(pageGuard("orders:read")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await p.checkMemberAny(store.slug)).toBeNull();
  });
});

describe("who is not let in at all", () => {
  it("sends nobody signed in to sign in, and gives a stranger and a member of another store a 404", async () => {
    signInAs(null);
    await expect(pageGuard("orders:read")).rejects.toThrow("REDIRECT:/admin/sign-in");
    expect(await p.checkPermission(store.slug, "orders:read")).toBeNull();
    const stranger = await makeAccount("stranger");
    signInAs(await linkAuthUser(stranger.id));
    await expect(pageGuard("orders:read")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(p.requireMemberAny(store.slug)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await p.checkMemberAny(store.slug)).toBeNull();
    const other = await makeStore("guards-other");
    signInAs(await linkAuthUser(other.account.id));
    await expect(pageGuard("orders:read")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("holds a member at their second step: the page sends them to set it up, an action gets no membership", async () => {
    await db().execute(sql`update commerce.stores set require_two_step = true where id = ${store.id}::uuid`);
    try {
      signInAs(ownerSub);
      await expect(pageGuard("orders:read")).rejects.toThrow("REDIRECT:/admin/sign-in/two-step/set-up");
      expect(await p.checkPermission(store.slug, "orders:read")).toBeNull();
      expect(await p.checkMemberAny(store.slug)).toBeNull();
      signInAs(ownerSub, { aal: "aal2", factors: [{ id: "f", status: "verified", factor_type: "totp" }] });
      expect(await pageGuard("orders:read")).toBeTruthy();
    } finally {
      await db().execute(sql`update commerce.stores set require_two_step = false where id = ${store.id}::uuid`);
    }
  });

  it("holds an enrolled member who has not passed their second step, whatever else they hold", async () => {
    signInAs(ownerSub, { factors: [{ id: "f", status: "verified", factor_type: "totp" }] });
    await expect(pageGuard("orders:read")).rejects.toThrow("REDIRECT:/admin/sign-in/two-step");
    expect(await p.checkPermission(store.slug, "orders:read")).toBeNull();
  });

  it("lets the members of a closed store read and handle what was sold, and answers everything else, and everyone else, with a 404 (D171)", async () => {
    const closed = await makeStore("guards-closed");
    await db().execute(sql`update commerce.stores set status = 'closed' where id = ${closed.id}::uuid`);
    signInAs(await linkAuthUser(closed.account.id));
    await expect(p.requirePermission(closed.slug, "orders:read")).resolves.toBeTruthy();
    await expect(p.requirePermission(closed.slug, "products:read")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(p.requirePermission(closed.slug, "settings:write")).rejects.toThrow("NEXT_NOT_FOUND");
    signInAs(ownerSub);
    await expect(p.requirePermission(closed.slug, "orders:read")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("what the guards promise the scan test", () => {
  it("names ten guards and the wrappers that call one", () => {
    expect([...p.GUARDS].sort()).toEqual([
      "checkAnyPermission",
      "checkMemberAny",
      "checkOwnerRole",
      "checkPageTypeAccess",
      "checkPermission",
      "requireAnyPermission",
      "requireMemberAny",
      "requireOwnerRole",
      "requirePageTypeAccess",
      "requirePermission",
    ]);
    expect(Object.keys(p.DELEGATED_GUARDS).sort()).toEqual([
      "StoreEditPageView",
      "StoreNewPageView",
      "StorePageTermsView",
      "StorePagesListView",
      "StorePreviewPageView",
      "abortRequest",
      "analyticsContext",
      "currentRequest",
      "startRequest",
      "statusRequest",
      "tickRequest",
    ]);
    expect(p.NO_ACCESS).toBe("You do not have access to this.");
  });
});
