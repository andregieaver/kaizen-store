import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The shopper's label route (wave 3, D239, `docs/wave-3-exchanges.md` 2.4 and 6.2): what it answers for each thing `returnLabel()` says. The fetch from the
 * carrier is the server's (held against a faked carrier in `return-labels.int.test.ts`); here, that the bytes go out as an inline PDF that nothing keeps, and
 * that the refusals are a plain 404, a page saying to wait an hour, and a page saying to try again, in the market's language, never the carrier's answer.
 */
vi.mock("server-only", () => ({}));
const answer = vi.hoisted(() => ({ value: null as unknown, calls: [] as [string, string][] }));
vi.mock("@/server/return-labels", () => ({
  returnLabel: async (storeId: string, token: string) => {
    answer.calls.push([storeId, token]);
    return answer.value;
  },
}));
vi.mock("@/server/shop", () => ({
  resolveAfterSaleShop: async (slug: string, market: string) =>
    slug === "demo" ? { store: { id: "s1", slug: "demo" }, market: { slug: market, lang: market === "no" ? "nb" : "en", locale: "nb-NO" } } : null,
}));

import { t } from "@/lib/i18n";

import { GET } from "./route";

const TOKEN = "a".repeat(64);
const call = (store = "demo", market = "no", token = TOKEN) => GET(new Request("https://shop.test/x"), { params: Promise.resolve({ store, market, token }) } as never);

beforeEach(() => {
  answer.calls = [];
});

describe("the return label route", () => {
  it("answers the label as an inline PDF that is not stored, indexed or passed on", async () => {
    answer.value = { ok: true, pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46]), filename: "return-1042-R1.pdf" };
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('inline; filename="return-1042-R1.pdf"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    expect(answer.calls).toEqual([["s1", TOKEN]]);
  });

  it("is a plain 404 for another store, an unknown token or a return with no booked label", async () => {
    expect((await call("other")).status).toBe(404);
    expect(answer.calls).toEqual([]);
    answer.value = { ok: false, status: 404, reason: "not_found" };
    const res = await call();
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("says in the market's language to wait an hour after too many tries, and to try again when the carrier fails", async () => {
    answer.value = { ok: false, status: 429, reason: "limit" };
    const limited = await call();
    expect(limited.status).toBe(429);
    const limitedText = await limited.text();
    expect(limitedText).toContain(t("nb").returnLabel.tooMany);
    expect(limitedText).toContain('lang="nb"');
    answer.value = { ok: false, status: 503, reason: "carrier" };
    const down = await call("demo", "no-en");
    expect(down.status).toBe(503);
    expect(down.headers.get("content-type")).toContain("text/html");
    expect(await down.text()).toContain(t("en").returnLabel.unavailable);
  });
});
