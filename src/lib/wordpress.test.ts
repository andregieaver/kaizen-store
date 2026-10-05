import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { approvalLocation, challengeOf, hashSecret, looksLikeCode, looksLikeToken, readApproval, returnAddress, siteLabel, siteOrigin, verifierMatches, viewIsComplete, viewQuery } from "./wordpress";

const secret = () => randomBytes(32).toString("base64url");
const UUID = "123e4567-e89b-12d3-a456-426614174000";
const UUID2 = "223e4567-e89b-12d3-a456-426614174000";

describe("siteOrigin", () => {
  it("takes an https site's origin and drops the rest", () => {
    expect(siteOrigin("https://example.com/blog/?a=1#x")).toBe("https://example.com");
    expect(siteOrigin("https://shop.example.com:8443")).toBe("https://shop.example.com:8443");
  });
  it("allows plain http only on a developer's own host", () => {
    expect(siteOrigin("http://localhost:8080")).toBe("http://localhost:8080");
    expect(siteOrigin("http://127.0.0.1")).toBe("http://127.0.0.1");
    expect(siteOrigin("http://mysite.test")).toBe("http://mysite.test");
    expect(siteOrigin("http://example.com")).toBeNull();
  });
  it("refuses credentials, other schemes and junk", () => {
    for (const value of ["https://user:pw@example.com", "ftp://example.com", "javascript:alert(1)", "example.com", "", null, 5, `https://${"a".repeat(300)}.com`]) {
      expect(siteOrigin(value), String(value)).toBeNull();
    }
  });
});

describe("returnAddress", () => {
  it("keeps an address on the same site and drops its fragment", () => {
    const url = returnAddress("https://example.com", "https://example.com/wp-admin/admin.php?page=kaizen#top");
    expect(url?.toString()).toBe("https://example.com/wp-admin/admin.php?page=kaizen");
  });
  it("refuses another origin, another port, a look-alike host and credentials", () => {
    for (const value of ["https://evil.com/", "https://example.com:444/", "https://example.com.evil.com/", "https://example.com@evil.com/", "http://example.com/", "//evil.com", "not a url"]) {
      expect(returnAddress("https://example.com", value), value).toBeNull();
    }
  });
});

describe("approval request", () => {
  const good = { site: "https://example.com", return: "https://example.com/wp-admin/admin.php?page=kaizen", state: secret(), challenge: challengeOf(secret()), name: "My <b>Shop</b>" };
  it("is read, with a plain name", () => {
    const read = readApproval(good);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.request.name).toBe("My b Shop /b");
  });
  it("is refused for each thing missing or wrong", () => {
    for (const bad of [{ ...good, site: "http://example.com" }, { ...good, return: "https://other.com/" }, { ...good, state: "short" }, { ...good, challenge: "x" }, {}]) {
      expect(readApproval(bad).ok).toBe(false);
    }
  });
  it("sends the answer back in the return address's query, keeping what it had", () => {
    const read = readApproval(good);
    if (!read.ok) throw new Error("not read");
    const url = new URL(approvalLocation(read.request, { code: "kzwc_abc" }));
    expect(url.origin + url.pathname).toBe("https://example.com/wp-admin/admin.php");
    expect(url.searchParams.get("page")).toBe("kaizen");
    expect(url.searchParams.get("kaizen_code")).toBe("kzwc_abc");
    expect(url.searchParams.get("kaizen_state")).toBe(good.state);
    const denied = new URL(approvalLocation(read.request, { error: "denied" }));
    expect(denied.searchParams.get("kaizen_error")).toBe("denied");
    expect(denied.searchParams.has("kaizen_code")).toBe(false);
  });
});

describe("secrets", () => {
  it("proves the verifier a challenge came from, and nothing else", () => {
    const verifier = secret();
    expect(verifierMatches(verifier, challengeOf(verifier))).toBe(true);
    expect(verifierMatches(secret(), challengeOf(verifier))).toBe(false);
    expect(verifierMatches("short", challengeOf(verifier))).toBe(false);
  });
  it("hashes the same way every time and never returns the secret", () => {
    expect(hashSecret("abc")).toBe(hashSecret("abc"));
    expect(hashSecret("abc")).toHaveLength(64);
    expect(hashSecret("abc")).not.toContain("abc");
  });
  it("knows the shape of a token and a code before any lookup", () => {
    const body = randomBytes(32).toString("base64url");
    expect(looksLikeToken(`kzwp_${body}`)).toBe(true);
    expect(looksLikeToken(`kzwc_${body}`)).toBe(false);
    expect(looksLikeCode(`kzwc_${body}`)).toBe(true);
    expect(looksLikeToken("kzwp_short")).toBe(false);
    expect(looksLikeToken(`kzwp_${body}'; drop table`)).toBe(false);
  });
});

describe("siteLabel", () => {
  it("is plain, trimmed and short, with a fallback", () => {
    expect(siteLabel("  A\n\tshop  ", "x")).toBe("A shop");
    expect(siteLabel("", "example.com")).toBe("example.com");
    expect(siteLabel("a".repeat(500), "x")).toHaveLength(120);
  });
});

describe("viewQuery", () => {
  const parse = (query: Record<string, string>) => viewQuery.parse(query);
  it("defaults to the newest twelve of the whole store", () => {
    expect(parse({})).toMatchObject({ source: "all", sort: "newest", limit: 12, categories: [], tags: [], ids: [] });
  });
  it("keeps only what the source uses", () => {
    const view = parse({ source: "category", categories: UUID, tags: UUID2, ids: UUID2 });
    expect(view).toMatchObject({ categories: [UUID], tags: [], ids: [] });
    expect(parse({ source: "tag", categories: UUID, tags: `${UUID},${UUID2}` }).tags).toEqual([UUID, UUID2]);
  });
  it("keeps hand-picked products in the order they were picked", () => {
    const view = parse({ source: "products", ids: `${UUID2},${UUID}`, sort: "title" });
    expect(view.ids).toEqual([UUID2, UUID]);
    expect(view.sort).toBe("given");
  });
  it("does not let `given` order a view that has nothing given", () => {
    expect(parse({ sort: "given" }).sort).toBe("newest");
  });
  it("refuses a bad limit, sort, source, id or market", () => {
    for (const bad of [{ limit: "0" }, { limit: "49" }, { limit: "x" }, { sort: "random" }, { source: "all; drop" }, { source: "products", ids: "not-an-id" }, { market: "no/../x" }]) {
      expect(viewQuery.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
  it("knows an empty choice from a complete one", () => {
    expect(viewIsComplete(parse({}))).toBe(true);
    expect(viewIsComplete(parse({ source: "category" }))).toBe(false);
    expect(viewIsComplete(parse({ source: "tag", tags: UUID }))).toBe(true);
    expect(viewIsComplete(parse({ source: "products" }))).toBe(false);
  });
});
