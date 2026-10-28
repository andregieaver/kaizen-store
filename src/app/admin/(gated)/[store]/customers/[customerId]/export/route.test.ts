import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const checkPermission = vi.fn();
const staffExport = vi.fn();
vi.mock("@/server/permissions", () => ({ checkPermission: (...a: unknown[]) => checkPermission(...a) }));
vi.mock("@/server/privacy-admin", () => ({ staffExport: (...a: unknown[]) => staffExport(...a) }));
// The route takes `sameSite()` through the chat routes' module; the check itself is the real one (`src/lib/same-site.ts`).
vi.mock("@/server/chat-route", async () => ({ sameSite: (await import("@/lib/same-site")).sameSite }));

import { POST } from "./route";

const CUSTOMER = "2b0f7c4e-8a51-4f4e-9d0a-3c1f6a7b8e90";
const REQUEST = "7d3e9a12-4c6b-4f8e-a1d2-5b6c7d8e9f01";

/** A POST of the customer page's form, from the admin's own host unless the headers say otherwise. */
const call = (headers: Record<string, string> = { origin: "http://x", host: "x" }, fields: Record<string, string> = {}, customerId = CUSTOMER) =>
  POST(
    new Request(`http://x/admin/demo/customers/${customerId}/export`, { method: "POST", headers, body: new URLSearchParams(fields) }) as never,
    { params: Promise.resolve({ store: "demo", customerId }) } as never,
  );

const file = { schema: "kaizen.customer-export", version: 1, subject: { kind: "customer" } };
const member = { store: { id: "s1", slug: "demo" }, account: { id: "a1" } };

beforeEach(() => {
  vi.clearAllMocks();
  checkPermission.mockResolvedValue(member);
  staffExport.mockResolvedValue({ ok: true, file, fileName: "demo-customer 2026/10/28.json", counts: {}, requestId: null });
});

describe("the staff download of a customer's data (D162, D371)", () => {
  it("serves the file as an attachment, never cached, for a member who may change customers", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    // The file name is reduced to safe characters, so nothing in it can break out of the header.
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="demo-customer_2026_10_28.json"');
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(await response.text())).toEqual(file);
    expect(checkPermission).toHaveBeenCalledWith("demo", "customers:write");
    expect(staffExport).toHaveBeenCalledTimes(1);
    expect(staffExport.mock.calls[0]).toEqual([{ storeId: "s1", accountId: "a1", requestId: null }, CUSTOMER]);
  });

  it("is a 404 for a member without customers:write (or no member at all) and makes nothing, whatever the request", async () => {
    checkPermission.mockResolvedValue(null);
    const response = await call();
    expect(response.status).toBe(404);
    expect(response.headers.get("content-disposition")).toBeNull();
    // A request from another site is refused the same way: the store says nothing to someone who may not export.
    expect((await call({ origin: "https://evil.example", host: "x" })).status).toBe(404);
    expect(staffExport).not.toHaveBeenCalled();
  });

  it("refuses a request from another site, or one the browser marks cross-site, and makes nothing", async () => {
    const other = await call({ origin: "https://evil.example", host: "x" });
    expect(other.status).toBe(403);
    expect(other.headers.get("content-disposition")).toBeNull();
    expect((await call({ "sec-fetch-site": "cross-site", host: "x" })).status).toBe(403);
    expect((await call({ origin: "not a url", host: "x" })).status).toBe(403);
    expect(staffExport).not.toHaveBeenCalled();
    // Without an origin, a same-origin fetch (or an old browser that sends neither) is let through.
    expect((await call({ "sec-fetch-site": "same-origin", host: "x" })).status).toBe(200);
    expect(staffExport).toHaveBeenCalledTimes(1);
  });

  it("ties the file to a privacy request named in the form, and ignores one that is not an id", async () => {
    await call(undefined, { request: REQUEST });
    expect(staffExport.mock.calls[0][0]).toEqual({ storeId: "s1", accountId: "a1", requestId: REQUEST });
    await call(undefined, { request: "'; drop table x; --" });
    expect(staffExport.mock.calls[1][0]).toEqual({ storeId: "s1", accountId: "a1", requestId: null });
  });

  it("sends a refusal back to the page it came from with a code, never a file", async () => {
    staffExport.mockResolvedValueOnce({ ok: false, problem: "too_large" });
    const large = await call();
    expect(large.status).toBe(303);
    expect(large.headers.get("location")).toBe(`http://x/admin/demo/customers/${CUSTOMER}?export=too_large`);
    expect(large.headers.get("content-disposition")).toBeNull();
    // From a privacy request's page, back to that page.
    staffExport.mockResolvedValueOnce({ ok: false, problem: "not_found" });
    expect((await call(undefined, { request: REQUEST })).headers.get("location")).toBe(`http://x/admin/demo/privacy/${REQUEST}?export=not_found`);
  });

  it("answers a key that is not an id as not found, without looking", async () => {
    const response = await call(undefined, {}, "not-an-id");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://x/admin/demo/customers/not-an-id?export=not_found");
    expect(staffExport).not.toHaveBeenCalled();
  });
});
