import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Membership } from "./auth";
import { auditOf, csvBytes, depsWith, fakeStorage, importThrough, membersOf, seedProducts, euOperator } from "./data-test-support";
import { makeStore, type Fixture } from "./invoice-test-fixture";

/**
 * The export and import routes as a browser calls them (D165, `docs/wave-2-data.md` 5.2): who gets a file, a 404 or a 403, that only POST is
 * exported, that a job of another store is a 404, and the real storage adapter (`dataStorage()`, against a stand-in for Supabase's client) for a
 * signed download. Analytics export routes belong to the analytics export's own tests.
 */

const env = vi.hoisted(() => {
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  return { files: new Map<string, Uint8Array>(), signed: [] as { bucket: string; path: string; seconds: number; download: unknown }[], limits: { direct: 2000 } };
});

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("@/lib/data-limits", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/data-limits")>();
  return Object.defineProperty({ ...original }, "DIRECT_EXPORT_MAX_ROWS", { get: () => env.limits.direct, enumerable: true });
});
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    storage: {
      from: (bucket: string) => ({
        createSignedUploadUrl: async (path: string) => ({ data: { token: `t-${path.length}` }, error: null }),
        upload: async (path: string, bytes: Uint8Array) => {
          env.files.set(`${bucket}/${path}`, bytes);
          return { error: null };
        },
        download: async (path: string) => {
          const got = env.files.get(`${bucket}/${path}`);
          return got ? { data: new Blob([got as BlobPart]), error: null } : { data: null, error: { message: "not found" } };
        },
        remove: async (paths: string[]) => {
          for (const p of paths) env.files.delete(`${bucket}/${p}`);
          return { error: null };
        },
        createSignedUrl: async (path: string, seconds: number, options: { download: unknown }) => {
          env.signed.push({ bucket, path, seconds, download: options.download });
          return { data: { signedUrl: `https://example.supabase.co/storage/v1/sign/${bucket}/${path}?token=x` }, error: null };
        },
      }),
    },
  }),
}));

const who = vi.hoisted(() => ({ current: null as Membership | null }));
vi.mock("@/server/auth", async (original) => {
  const real = await original<typeof import("./auth")>();
  return {
    ...real,
    getMembership: async (slug: string): Promise<Membership | null> => (who.current && who.current.store.slug === slug ? who.current : null),
    requireMember: async (slug: string): Promise<Membership> => {
      if (!who.current || who.current.store.slug !== slug) throw new Error("NEXT_NOT_FOUND");
      return who.current;
    },
  };
});

const productsFile = await import("@/app/admin/(gated)/[store]/products/export/file/route");
const ordersFile = await import("@/app/admin/(gated)/[store]/orders/export/file/route");
const customersFile = await import("@/app/admin/(gated)/[store]/customers/export/file/route");
const productTick = await import("@/app/admin/(gated)/[store]/products/export/[jobId]/tick/route");
const orderTick = await import("@/app/admin/(gated)/[store]/orders/export/[jobId]/tick/route");
const customerTick = await import("@/app/admin/(gated)/[store]/customers/export/[jobId]/tick/route");
const importTick = await import("@/app/admin/(gated)/[store]/products/import/[jobId]/tick/route");
const importProblems = await import("@/app/admin/(gated)/[store]/products/import/[jobId]/problems/route");

type Row = Record<string, unknown>;

let fx: Fixture;
let other: Fixture;
let members: Awaited<ReturnType<typeof membersOf>>;
let strangers: Awaited<ReturnType<typeof membersOf>>;

beforeAll(async () => {
  fx = await makeStore("dperm");
  other = await makeStore("dperm2");
  members = await membersOf(fx);
  strangers = await membersOf(other);
  await euOperator(fx);
  await seedProducts(fx, 3, { prefix: "perm" });
});

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  env.limits.direct = 2000;
  env.files.clear();
  env.signed.length = 0;
  who.current = members.owner;
  await db().execute(sql`update commerce.data_jobs set status = 'cancelled', claimed_until = null where store_id in (${fx.storeId}::uuid, ${other.storeId}::uuid) and status in ('queued', 'running', 'checking', 'uploaded', 'checked')`);
});

const post = (path: string, fields: Record<string, string> = {}, headers: Record<string, string> = {}): NextRequest => {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return new NextRequest(`http://localhost${path}`, { method: "POST", body, headers: { host: "localhost", origin: "http://localhost", ...headers } });
};

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) }) as never;

const exportOf = (path: string, slug = fx.slug) => ({ path: `/admin/${slug}/${path}` });

describe("the file routes", () => {
  it("gives the owner a CSV of each kind, never cached", async () => {
    const products = await productsFile.POST(post(exportOf("products/export/file").path), ctx({ store: fx.slug }));
    expect(products.status).toBe(200);
    expect(products.headers.get("content-type")).toContain("text/csv");
    expect(products.headers.get("cache-control")).toBe("no-store");
    expect(products.headers.get("content-disposition")).toMatch(/^attachment; filename="[A-Za-z0-9._-]+"$/);
    expect(await products.text()).toContain("handle");
    const orders = await ordersFile.POST(post(exportOf("orders/export/file").path, { mode: "range", from: "2020-01-01", to: "2030-01-01" }), ctx({ store: fx.slug }));
    expect(orders.status).toBe(200);
    expect(await orders.text()).toContain("order_number");
    const customers = await customersFile.POST(post(exportOf("customers/export/file").path), ctx({ store: fx.slug }));
    expect(customers.status).toBe(200);
    expect(await customers.text()).toContain("email");
  });

  it("is a 404 for a person who is not a member of the store, and for a member of another store", async () => {
    who.current = null;
    for (const route of [productsFile, ordersFile, customersFile]) {
      expect((await route.POST(post("/x"), ctx({ store: fx.slug }))).status).toBe(404);
    }
    who.current = strangers.owner;
    for (const route of [productsFile, ordersFile, customersFile]) {
      expect((await route.POST(post("/x"), ctx({ store: fx.slug }))).status).toBe(404);
    }
  });

  it("gives an admin the product file only: the order and customer files hold personal data and are the owner's", async () => {
    const exported = (await auditOf(fx.storeId, "order.exported")).length + (await auditOf(fx.storeId, "customer.exported")).length;
    who.current = members.admin;
    expect((await productsFile.POST(post("/x"), ctx({ store: fx.slug }))).status).toBe(200);
    expect((await ordersFile.POST(post("/x"), ctx({ store: fx.slug }))).status).toBe(404);
    expect((await customersFile.POST(post("/x"), ctx({ store: fx.slug }))).status).toBe(404);
    expect((await auditOf(fx.storeId, "order.exported")).length + (await auditOf(fx.storeId, "customer.exported")).length).toBe(exported);
  });

  it("refuses another site with a 403 before anything is made", async () => {
    const before = (await auditOf(fx.storeId, "products.export_made")).length;
    const res = await productsFile.POST(post("/x", {}, { origin: "https://evil.example" }), ctx({ store: fx.slug }));
    expect(res.status).toBe(403);
    expect((await auditOf(fx.storeId, "products.export_made")).length).toBe(before);
    const none = await productsFile.POST(post("/x", {}, { origin: "", "sec-fetch-site": "cross-site" }), ctx({ store: fx.slug }));
    expect(none.status).toBe(403);
  });

  it("exports only POST", () => {
    for (const route of [productsFile, ordersFile, customersFile, productTick, orderTick, customerTick, importTick, importProblems]) {
      expect(Object.keys(route).filter((k) => ["GET", "PUT", "PATCH", "DELETE", "HEAD"].includes(k))).toEqual([]);
      expect(typeof route.POST).toBe("function");
    }
  });

  it("sends a refused request back to the page with a code and no text of its own", async () => {
    const res = await ordersFile.POST(post("/x", { mode: "range", from: "2030-01-02", to: "2020-01-01" }), ctx({ store: fx.slug }));
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe(`/admin/${fx.slug}/orders/export`);
    expect([...location.searchParams.keys()]).toEqual(["problem"]);
    expect(location.searchParams.get("problem")).toMatch(/^[a-z_]+$/);
  });
});

describe("a job through the routes, with the storage adapter", () => {
  it("is made, run by the page's ticks, and downloaded by a signed address of 60 seconds that is logged first", async () => {
    env.limits.direct = -1;
    const made = await productsFile.POST(post("/x"), ctx({ store: fx.slug }));
    expect(made.status).toBe(303);
    const jobId = new URL(made.headers.get("location")!).searchParams.get("job")!;
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);
    let state: { status: string; files: { index: number; name: string; path?: unknown }[] } = { status: "queued", files: [] };
    for (let i = 0; i < 20 && state.status !== "done"; i += 1) {
      const tick = await productTick.POST(post("/x"), ctx({ store: fx.slug, jobId }));
      expect(tick.status).toBe(200);
      state = await tick.json();
    }
    expect(state.status).toBe("done");
    // The page is told a name, never a path.
    expect(JSON.stringify(state)).not.toContain(fx.storeId);
    expect(state.files[0].path).toBeUndefined();
    expect([...env.files.keys()].some((k) => k.startsWith("exports/") && k.includes(jobId))).toBe(true);
    const down = await productsFile.POST(post("/x", { intent: "download", job: jobId, part: "0" }), ctx({ store: fx.slug }));
    expect(down.status).toBe(303);
    expect(down.headers.get("location")).toContain("/storage/v1/sign/exports/");
    expect(env.signed.at(-1)?.seconds).toBe(60);
    expect(env.signed.at(-1)?.bucket).toBe("exports");
    const logged = await auditOf(fx.storeId, "products.export_downloaded");
    expect(logged.length).toBe(1);
    expect(JSON.stringify(logged[0])).not.toContain("@");
    // A part that does not exist, or a job id that is not one, is a 404.
    expect((await productsFile.POST(post("/x", { intent: "download", job: jobId, part: "7" }), ctx({ store: fx.slug }))).status).toBe(404);
    expect((await productsFile.POST(post("/x", { intent: "download", job: "../x", part: "0" }), ctx({ store: fx.slug }))).status).toBe(404);
    // An admin cannot take an order file's part, and another store cannot take this one.
    who.current = strangers.owner;
    expect((await productsFile.POST(post("/x", { intent: "download", job: jobId, part: "0" }), ctx({ store: other.slug }))).status).toBe(404);
  });

  it("is a 404 for the tick of a job that is another store's, one that is not a job, and a kind the member may not use", async () => {
    env.limits.direct = -1;
    const made = await productsFile.POST(post("/x"), ctx({ store: fx.slug }));
    const jobId = new URL(made.headers.get("location")!).searchParams.get("job")!;
    who.current = strangers.owner;
    expect((await productTick.POST(post("/x"), ctx({ store: other.slug, jobId }))).status).toBe(404);
    who.current = members.owner;
    expect((await productTick.POST(post("/x"), ctx({ store: fx.slug, jobId: "nope" }))).status).toBe(404);
    // A page ticks only its own kind of job, even for the owner; an admin is refused at the door of the order and customer pages.
    expect((await orderTick.POST(post("/x"), ctx({ store: fx.slug, jobId }))).status).toBe(404);
    expect((await importTick.POST(post("/x"), ctx({ store: fx.slug, jobId }))).status).toBe(404);
    who.current = members.admin;
    expect((await orderTick.POST(post("/x"), ctx({ store: fx.slug, jobId }))).status).toBe(404);
    expect((await customerTick.POST(post("/x"), ctx({ store: fx.slug, jobId }))).status).toBe(404);
    expect((await importTick.POST(post("/x"), ctx({ store: fx.slug, jobId }))).status).toBe(404);
    who.current = members.owner;
    expect((await productTick.POST(post("/x", {}, { origin: "https://evil.example" }), ctx({ store: fx.slug, jobId }))).status).toBe(403);
  });

  it("serves the order and customer jobs to the owner, and the order's tick is not an admin's", async () => {
    env.limits.direct = -1;
    const order = await ordersFile.POST(post("/x", { mode: "range", from: "2020-01-01", to: "2030-01-01" }), ctx({ store: fx.slug }));
    const orderJob = new URL(order.headers.get("location")!).searchParams.get("job")!;
    const tick = await orderTick.POST(post("/x"), ctx({ store: fx.slug, jobId: orderJob }));
    expect(tick.status).toBe(200);
    expect((await tick.json()).kind).toBe("order_export");
    const customer = await customersFile.POST(post("/x"), ctx({ store: fx.slug }));
    const customerJob = new URL(customer.headers.get("location")!).searchParams.get("job")!;
    expect((await customerTick.POST(post("/x"), ctx({ store: fx.slug, jobId: customerJob }))).status).toBe(200);
    who.current = members.admin;
    expect((await orderTick.POST(post("/x"), ctx({ store: fx.slug, jobId: orderJob }))).status).toBe(404);
  });
});

describe("the import's routes", () => {
  it("gives the problems of an import as a CSV to a member who may write products, and nobody else", async () => {
    const storage = fakeStorage();
    const run = await importThrough(members.owner, storage, csvBytes([["handle", "title", "price_basis", "sku"], ["bad-one", "Bad one", "nonsense", "BAD-1"]]), {}, { apply: false, deps: depsWith(storage) });
    const res = await importProblems.POST(post("/x"), ctx({ store: fx.slug, jobId: run.jobId }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.text()).split("\r\n")[0]).toBe("rows,handle,severity,code,column,problem");
    who.current = strangers.owner;
    expect((await importProblems.POST(post("/x"), ctx({ store: other.slug, jobId: run.jobId }))).status).toBe(404);
    who.current = members.owner;
    expect((await importProblems.POST(post("/x", {}, { origin: "https://evil.example" }), ctx({ store: fx.slug, jobId: run.jobId }))).status).toBe(403);
    expect((await importProblems.POST(post("/x"), ctx({ store: fx.slug, jobId: "nope" }))).status).toBe(404);
    const [job] = await db().execute<Row>(sql`select status from commerce.data_jobs where id = ${run.jobId}::uuid`);
    expect(["checked", "cancelled"]).toContain(String(job.status));
    await db().execute(sql`update commerce.data_jobs set status = 'cancelled' where id = ${run.jobId}::uuid and status = 'checked'`);
  });
});
