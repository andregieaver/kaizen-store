import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { ROLE_TEMPLATES, type PermissionHolder } from "@/lib/permissions";

import { makeStore } from "./trust-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const ownerTools = await import("./owner-tools");
const assistant = await import("./owner-assistant");
const stores = await import("./stores");
const { findPages, pagesFor } = await import("@/lib/admin-map");

type Row = Record<string, unknown>;

/**
 * The AI manager's store tools held to a member's role (wave 1, 1f, docs/wave-1-trust.md 2.7.3). The assistant is the owner's alone in this wave,
 * so this is held with synthetic principals: a tool refuses what the role may not do before its handler runs, a gated change that the role may not
 * make is refused now and never kept for a yes, the model is offered only the tools and pages the role can use, and an owner is held to nothing.
 */

let ctxFor: (holder?: PermissionHolder) => Parameters<typeof ownerTools.runOwnerTool>[0];
let storeId: string;
let productHandle: string;

const template = (key: keyof typeof ROLE_TEMPLATES): PermissionHolder => ({ role: "admin", permissions: ROLE_TEMPLATES[key].permissions });
const owner: PermissionHolder = { role: "owner" };
const admin: PermissionHolder = { role: "admin" };

beforeAll(async () => {
  const made = await makeStore("toolperm");
  storeId = made.id;
  const store = (await stores.getStore(made.slug))!;
  const [product] = await db().execute<Row>(sql`select handle from commerce.products where store_id = ${storeId}::uuid and status = 'active' order by handle limit 1`);
  productHandle = String(product.handle);
  ctxFor = (holder) => ({ account: made.account, store, invalidate: () => {}, holder });
});

afterAll(async () => {
  await closeDb();
});

const refusal = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ownerTools.OwnerToolError);
  return (error as Error).message;
};

describe("runOwnerTool for a role", () => {
  it("runs what the role holds: the orders role looks at orders and customers", async () => {
    expect(await ownerTools.runOwnerTool(ctxFor(template("orders")), "list_orders", {})).toBeTruthy();
    expect(await ownerTools.runOwnerTool(ctxFor(template("orders")), "list_customers", {})).toBeTruthy();
  });

  it("refuses, in words, what the role lacks, before any handler runs: the area is named", async () => {
    expect(await refusal(ownerTools.runOwnerTool(ctxFor(template("orders")), "list_pages", {}))).toBe("I can't do that for you: your role has no access to website.");
    expect(await refusal(ownerTools.runOwnerTool(ctxFor(template("orders")), "analytics_overview", {}))).toBe("I can't do that for you: your role has no access to analytics.");
    expect(await refusal(ownerTools.runOwnerTool(ctxFor(template("products")), "list_campaigns", {}))).toBe("I can't do that for you: your role has no access to marketing.");
  });

  it("refuses a change to a role that can only look, and the owner's tools to everyone who is not the owner", async () => {
    expect(await refusal(ownerTools.runOwnerTool(ctxFor(template("read_only")), "set_stock", { product: productHandle, quantity: 3 }))).toBe(
      "I can't do that for you: your role has no access to products.",
    );
    expect(await refusal(ownerTools.runOwnerTool(ctxFor(admin), "ai_usage", {}))).toBe("I can't do that for you: only an owner can.");
    expect(await refusal(ownerTools.runOwnerTool(ctxFor(admin), "store_overview", {}))).toBe("I can't do that for you: only an owner can.");
  });

  it("lets the owner use everything, and a run with no member given is an owner's (the assistant's own, before roles)", async () => {
    expect(await ownerTools.runOwnerTool(ctxFor(owner), "store_overview", {})).toBeTruthy();
    expect(await ownerTools.runOwnerTool(ctxFor(undefined), "store_overview", {})).toBeTruthy();
    expect(await ownerTools.runOwnerTool(ctxFor(admin), "list_orders", {})).toBeTruthy();
  });

  it("answers a tool that is none the same way for everyone", async () => {
    for (const holder of [owner, admin, template("orders")]) {
      expect(await refusal(ownerTools.runOwnerTool(ctxFor(holder), "make_coffee", {}))).toBe("There is no tool called make_coffee.");
    }
  });
});

describe("a change that is kept for a yes", () => {
  it("is refused when the role may not make it, never kept for an approval", async () => {
    await expect(ownerTools.preflightOwnerTool(ctxFor(template("orders")), "archive_product", { product: productHandle })).rejects.toThrow(
      "I can't do that for you: your role has no access to products.",
    );
    await expect(ownerTools.preflightOwnerTool(ctxFor(template("read_only")), "refund_order", { order: "1", reason: "x" })).rejects.toThrow("no access to orders");
    // The role that holds the key goes on to the tool's own checks (here none for archiving), and the owner always does.
    await expect(ownerTools.preflightOwnerTool(ctxFor(template("products")), "archive_product", { product: productHandle })).resolves.toBeUndefined();
    await expect(ownerTools.preflightOwnerTool(ctxFor(owner), "archive_product", { product: productHandle })).resolves.toBeUndefined();
  });
});

describe("what the assistant offers a role", () => {
  it("builds the principal's holder from its role, kind and keys, and none when no role is given", () => {
    const account = { id: "a", email: "a@example.com", name: null, platformAdmin: false };
    expect(assistant.holderOfPrincipal({ role: "admin", kind: "collaborator", permissions: ["orders:read"] })).toEqual({ role: "admin", kind: "collaborator", permissions: ["orders:read"] });
    expect(assistant.holderOfPrincipal({ role: "owner" })).toMatchObject({ role: "owner" });
    expect(assistant.holderOfPrincipal({})).toBeUndefined();
    void account;
  });

  it("offers only the pages the role can open: the orders role is not shown the website, analytics or the owner's pages", async () => {
    const store = (await stores.getStore((await db().execute<Row>(sql`select slug from commerce.stores where id = ${storeId}::uuid`))[0].slug as string))!;
    const principal = (holder: PermissionHolder) => ({ account: { id: "x", email: "x@example.com", name: null, platformAdmin: false }, store, role: holder.role, kind: holder.kind, permissions: holder.permissions });
    const ids = (holder: PermissionHolder) => pagesFor("store", assistant.siteFlags(principal(holder))).map((page) => page.id);

    const orders = ids(template("orders"));
    expect(orders).toContain("orders");
    expect(orders).toContain("customers");
    for (const hidden of ["pages", "analytics", "campaigns", "settings.payments", "staff", "assistant"]) expect([hidden, orders.includes(hidden)]).toEqual([hidden, false]);

    const everything = ids(owner);
    for (const shown of ["orders", "pages", "analytics", "assistant", "staff"]) expect([shown, everything.includes(shown)]).toEqual([shown, true]);

    // A search for a page the role cannot open finds nothing of it.
    const found = findPages("store", "campaigns discounts", assistant.siteFlags(principal(template("orders")))).map((page) => page.id);
    expect(found).not.toContain("campaigns");
  });
});
