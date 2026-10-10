import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readGrant, signGrant } from "@/lib/edit-grant";

// Who is asking is each test's to set; the pass's own modules are the real ones.
const asked = vi.hoisted(() => ({
  account: null as unknown,
  held: null as unknown,
  member: null as unknown,
  checked: [] as unknown[][],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/server/auth", () => ({
  getAccount: async () => asked.account,
  getAssurance: async () => asked.held,
  heldDestination: () => "/admin/sign-in/two-step",
  passMembership: async () => null,
}));
vi.mock("@/server/permissions", () => ({
  checkPermission: async (...args: unknown[]) => {
    asked.checked.push(args);
    return asked.member;
  },
  checkPassPermission: async () => null,
}));

const grant = await import("./grant/route");
const enter = await import("./enter/route");
const leave = await import("./leave/route");

/**
 * The routes that give staff a pass for a store's own domain (D193): the admin's `grant` hands the browser to the store's host with a
 * token, the store's `enter` swaps it for a cookie, `leave` ends it. The refusals matter as much as the way through.
 */

const store = { id: "11111111-1111-4111-8111-111111111111", slug: "min-butikk" };
const person = { id: "22222222-2222-4222-8222-222222222222" };
const ADMIN = "https://kaizenstore.cloud";
const HOST = "min-butikk.kaizenstore.test";

const originalDomain = process.env.NEXT_PUBLIC_STORE_DOMAIN;
beforeEach(() => {
  process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
  process.env.NEXT_PUBLIC_STORE_DOMAIN = "kaizenstore.test";
});
afterEach(() => {
  process.env.NEXT_PUBLIC_STORE_DOMAIN = originalDomain;
  asked.account = null;
  asked.held = null;
  asked.member = null;
  asked.checked = [];
});

const secret = () => Buffer.from(process.env.SETTINGS_ENCRYPTION_KEY!, "base64");
const get = (route: { GET: (request: Request) => Promise<Response> }, url: string, headers: Record<string, string> = {}) => route.GET(new Request(url, { headers }));
const grantFor = (query: string) => get(grant, `${ADMIN}/api/platform/editor/grant?${query}`);
const enterOn = (host: string, pass: string, to = "/no/om-oss") =>
  get(enter, `https://${host}/api/platform/editor/enter?pass=${encodeURIComponent(pass)}&to=${encodeURIComponent(to)}`, { host });
const link = (over: Partial<{ kind: "enter" | "edit"; storeId: string; store: string; account: string }> = {}, now = Date.now()) =>
  signGrant(secret(), { kind: "enter", storeId: store.id, store: store.slug, account: person.id, ...over }, now);

describe("the admin's route that sends staff to a store's host", () => {
  it("sends a member who may change the website to the store's own host with a link token for them, and for them alone", async () => {
    asked.account = { id: person.id };
    asked.member = { store, account: person };
    const response = await grantFor(`store=${store.slug}&to=${encodeURIComponent("/no/om-oss?x=1")}`);
    expect(response.status).toBe(303);
    const target = new URL(response.headers.get("location")!);
    expect(`${target.origin}${target.pathname}`).toBe(`https://${HOST}/api/platform/editor/enter`);
    expect(target.searchParams.get("to")).toBe("/no/om-oss?x=1");
    const token = readGrant(secret(), target.searchParams.get("pass"), "enter");
    expect(token).toMatchObject({ kind: "enter", storeId: store.id, store: store.slug, account: person.id });
    // It asks what "Edit page" asks, of the store the link names.
    expect(asked.checked.at(-1)).toEqual([store.slug, "website:write"]);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("goes to sign in, or to the second step, when nobody is let in; nothing is given", async () => {
    asked.account = null;
    asked.held = null;
    const out = await grantFor(`store=${store.slug}&to=%2F`);
    expect(out.status).toBe(303);
    expect(new URL(out.headers.get("location")!).pathname).toBe("/admin/sign-in");
    asked.held = { account: person, assurance: { state: "challenge" } };
    const held = await grantFor(`store=${store.slug}&to=%2F`);
    expect(new URL(held.headers.get("location")!).pathname).toBe("/admin/sign-in/two-step");
    expect(asked.checked).toEqual([]);
  });

  it("refuses a member who may not change the website, and gives them nothing", async () => {
    asked.account = { id: person.id };
    asked.member = null;
    const response = await grantFor(`store=${store.slug}&to=%2F`);
    expect(response.status).toBe(403);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).not.toContain("pass=");
  });

  it("refuses a link that is not right: no store, not a store's name, another address or a way into the API to come back to", async () => {
    asked.account = { id: person.id };
    asked.member = { store, account: person };
    for (const query of [
      "to=%2F",
      "store=&to=%2F",
      `store=Not%20A%20Slug&to=%2F`,
      `store=${store.slug}`,
      `store=${store.slug}&to=https%3A%2F%2Fevil.example%2F`,
      `store=${store.slug}&to=%2F%2Fevil.example`,
      `store=${store.slug}&to=${encodeURIComponent("/api/platform/editor/text")}`,
    ]) {
      expect((await grantFor(query)).status, query).toBe(400);
    }
  });

  it("has nothing to give where stores share the admin's address, nor without the server's key", async () => {
    asked.account = { id: person.id };
    asked.member = { store, account: person };
    process.env.NEXT_PUBLIC_STORE_DOMAIN = "";
    expect((await grantFor(`store=${store.slug}&to=%2F`)).status).toBe(404);
    process.env.NEXT_PUBLIC_STORE_DOMAIN = "kaizenstore.test";
    process.env.SETTINGS_ENCRYPTION_KEY = "";
    expect((await grantFor(`store=${store.slug}&to=%2F`)).status).toBe(503);
  });
});

describe("the store's host taking the link", () => {
  it("swaps a good link for the pass, a cookie of that host closed to scripts, and sends the browser back to its page with the mark", async () => {
    const response = await enterOn(HOST, link());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`https://${HOST}/no/om-oss#kaizen-edit`);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^kaizen_edit=/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toContain("Path=/api/platform/editor");
    expect(cookie).toContain("Max-Age=1800");
    // The cookie holds a pass of the other kind, for the same person and store: the link itself is never kept.
    const value = /kaizen_edit=([^;]+)/.exec(cookie)![1];
    expect(readGrant(secret(), value, "edit")).toMatchObject({ kind: "edit", storeId: store.id, store: store.slug, account: person.id });
    expect(readGrant(secret(), value, "enter")).toBeNull();
  });

  it("gives nothing for a link that ran out, one of the wrong kind, one signed by another key or one that is not a token", async () => {
    for (const pass of [
      link({}, Date.now() - 10 * 60_000),
      link({ kind: "edit" }),
      signGrant(Buffer.alloc(32, 1), { kind: "enter", storeId: store.id, store: store.slug, account: person.id }),
      "",
      "garbage",
    ]) {
      const response = await enterOn(HOST, pass);
      expect(response.status).toBe(400);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  it("gives nothing on a host that is not the store's: another store's, the admin's, or any other", async () => {
    for (const host of ["annen-butikk.kaizenstore.test", "kaizenstore.cloud", "evil.example", ""]) {
      const response = await enterOn(host, link());
      expect(response.status, host).toBe(400);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  it("sends the browser only to a path of the store's own host", async () => {
    for (const to of ["//evil.example", "https://evil.example/", "/api/platform/editor/text", "no-slash", ""]) {
      const response = await enterOn(HOST, link(), to);
      expect(response.status, to).toBe(400);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });
});

describe("done editing", () => {
  it("ends the pass on the host that asks, and only the site's own pages may ask", async () => {
    const own = await leave.POST(new Request(`https://${HOST}/api/platform/editor/leave`, { method: "POST", headers: { host: HOST, origin: `https://${HOST}` } }));
    expect(own.status).toBe(200);
    const cookie = own.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^kaizen_edit=;/);
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("Path=/api/platform/editor");
    const foreign = await leave.POST(new Request(`https://${HOST}/api/platform/editor/leave`, { method: "POST", headers: { host: HOST, origin: "https://evil.example" } }));
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get("set-cookie")).toBeNull();
  });
});
