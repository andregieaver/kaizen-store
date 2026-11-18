import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const resolveShop = vi.fn();
const shopperExport = vi.fn();
vi.mock("@/server/shop", () => ({ resolveShop: (...a: unknown[]) => resolveShop(...a) }));
vi.mock("@/server/privacy-shopper", () => ({ shopperExport: (...a: unknown[]) => shopperExport(...a) }));

import { POST } from "./route";

const call = (headers: Record<string, string> = { origin: "http://x", host: "x" }) =>
  POST(new Request("http://x/s/demo/no/account/privacy/export", { method: "POST", headers }), {
    params: Promise.resolve({ store: "demo", market: "no" }),
  } as never);

const file = { schema: "kaizen.customer-export", version: 1, subject: { kind: "account" } };

beforeEach(() => {
  vi.clearAllMocks();
  resolveShop.mockResolvedValue({ store: { id: "s1", slug: "demo" }, market: { slug: "no" } });
  shopperExport.mockResolvedValue({ ok: true, file, fileName: "demo-my-data-2026-10-04.json", counts: {}, requestId: null });
});

describe("the shopper's own data route (D162)", () => {
  it("serves the file as an attachment, never cached, never indexed, from the signed-in session of this store", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="demo-my-data-2026-10-04.json"');
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(JSON.parse(await response.text())).toEqual(file);
    expect(shopperExport).toHaveBeenCalledTimes(1);
    expect(shopperExport.mock.calls[0][0]).toBe("s1");
  });

  it("refuses a request from another site and makes nothing", async () => {
    const response = await call({ origin: "https://evil.example", host: "x" });
    expect(response.status).toBe(403);
    expect(shopperExport).not.toHaveBeenCalled();
  });

  it("is a 404 for a shop that does not exist", async () => {
    resolveShop.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(404);
    expect(shopperExport).not.toHaveBeenCalled();
  });

  it("sends a stale session back to confirm it is them, with no file", async () => {
    shopperExport.mockResolvedValueOnce({ ok: false, problem: "stale" });
    const response = await call();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/s/demo/no/account/privacy?problem=stale");
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("sends a signed-out visitor to My account, and says plainly when the file is too large or could not be made", async () => {
    shopperExport.mockResolvedValueOnce({ ok: false, problem: "signed_out" });
    expect((await call()).headers.get("location")).toBe("/s/demo/no/account");
    shopperExport.mockResolvedValueOnce({ ok: false, problem: "too_large" });
    expect((await call()).headers.get("location")).toBe("/s/demo/no/account/privacy?problem=too_large");
    shopperExport.mockResolvedValueOnce({ ok: false, problem: "not_found" });
    expect((await call()).headers.get("location")).toBe("/s/demo/no/account/privacy?problem=failed");
  });

  it("sends an account past its hourly limit back with a plain sentence and makes nothing", async () => {
    shopperExport.mockResolvedValueOnce({ ok: false, problem: "busy" });
    const response = await call();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/s/demo/no/account/privacy?problem=busy");
    expect(response.headers.get("content-disposition")).toBeNull();
  });
});
