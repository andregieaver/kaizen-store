import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const resolveShop = vi.fn();
const findDocumentByToken = vi.fn();
const ensureDocumentPdf = vi.fn();
vi.mock("@/server/shop", () => ({ resolveAfterSaleShop: (...a: unknown[]) => resolveShop(...a) }));
vi.mock("@/server/invoices", () => ({ findDocumentByToken: (...a: unknown[]) => findDocumentByToken(...a) }));
vi.mock("@/server/invoice-pdf", () => ({ ensureDocumentPdf: (...a: unknown[]) => ensureDocumentPdf(...a) }));

import { GET } from "./route";

const TOKEN = `inv_${"a".repeat(43)}`;
const call = (token = TOKEN) =>
  GET(new Request(`http://x/s/demo/ie/account/documents/${token}/pdf`), { params: Promise.resolve({ store: "demo", market: "ie", token }) } as never);

beforeEach(() => {
  vi.clearAllMocks();
  resolveShop.mockResolvedValue({ store: { id: "s1", slug: "demo" }, market: { slug: "ie" } });
  findDocumentByToken.mockResolvedValue({ kind: "invoice", id: "i1" });
  ensureDocumentPdf.mockResolvedValue({ ok: true, bytes: new Uint8Array([37, 80, 68, 70, 45]), stored: true, fileName: "F/17" });
});

describe("the hosted document's PDF route (D159)", () => {
  it("serves the file as an attachment named after the document, never cached, never indexed", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="F-17.pdf"');
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70, 45]));
    expect(findDocumentByToken).toHaveBeenCalledWith("s1", TOKEN);
    expect(ensureDocumentPdf).toHaveBeenCalledWith("s1", "invoice", "i1");
  });

  it("answers one 404 for an unknown shop, a malformed token, another store's token and an anonymised document, and makes nothing", async () => {
    resolveShop.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(404);
    expect((await call("inv_short")).status).toBe(404);
    findDocumentByToken.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(404);
    ensureDocumentPdf.mockResolvedValueOnce({ ok: false, reason: "anonymised" });
    expect((await call()).status).toBe(404);
    ensureDocumentPdf.mockClear();
    findDocumentByToken.mockResolvedValueOnce(null);
    await call();
    expect(ensureDocumentPdf).not.toHaveBeenCalled();
  });

  it("sends the shopper to the hosted page's print view when the file cannot be made (the renderer failed, or another request is making it)", async () => {
    for (const reason of ["render_failed", "busy"]) {
      ensureDocumentPdf.mockResolvedValueOnce({ ok: false, reason });
      const response = await call();
      expect(response.status, reason).toBe(303);
      expect(response.headers.get("location"), reason).toBe(`/s/demo/ie/account/documents/${TOKEN}?print=1`);
      expect(response.headers.get("cache-control"), reason).toBe("no-store");
    }
  });
});
