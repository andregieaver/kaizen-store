import { VARIANT_KEYS } from "./experiments";

/**
 * Tests that change something every page of a store shows (D148, phase 3): its header, its footer, and the layout of its
 * product pages. They cannot be a route of their own, as a page's version is, so a visitor's versions travel in the market
 * part of the address the proxy rewrites to: `no` becomes `no~3fa9c1d2b_7b21aa90c`, one token per test the visitor is in
 * another version of (the test's first eight characters and the version's letter). The page's own routes are unchanged:
 * `resolveShop()` takes the tokens off, so the market is the real one, every link built from it is the real address and
 * the visitor's browser never sees the rewritten one. A visitor in the original gets no suffix, so everyone else, and the
 * original, are served from the same cached pages as before. Pure; the proxy, `resolveShop()` and the tests share it.
 */

export type TargetKind = "page" | "layout" | "header" | "footer";

/** The kind of test a page is the target of, from its type; null for a page that cannot be tested. */
export function targetKindOf(pageType: string): TargetKind | null {
  switch (pageType) {
    case "page":
      return "page";
    case "product_layout":
      return "layout";
    case "header":
      return "header";
    case "footer":
      return "footer";
    default:
      return null;
  }
}

/** The page type a kind of test is a test of. */
export const pageTypeOfKind = (kind: TargetKind): "page" | "product_layout" | "header" | "footer" => (kind === "layout" ? "product_layout" : kind);

/** A test's short name in an address: the first eight characters of its id. */
export const testToken = (experimentId: string): string => experimentId.replace(/-/g, "").slice(0, 8).toLowerCase();

const TOKEN = /^[0-9a-f]{8}([b-d])$/;
const SEPARATOR = "~";
const JOIN = "_";

const orderedKeys = (versions: Record<string, string>) => Object.keys(versions).sort();

/** `no` and the versions a visitor holds of site-wide tests (token → letter, the original left out) as the market part of a rewritten address. */
export function withSiteVersions(market: string, versions: Record<string, string>): string {
  const tokens = orderedKeys(versions)
    .filter((token) => /^[0-9a-f]{8}$/.test(token) && (VARIANT_KEYS as readonly string[]).includes(versions[token]) && versions[token] !== "a")
    .map((token) => `${token}${versions[token]}`);
  return tokens.length > 0 ? `${market}${SEPARATOR}${tokens.join(JOIN)}` : market;
}

/**
 * The market and the versions in a market param. A param that is not a market with well-formed tokens is returned whole,
 * as the market, so it finds nothing and the page is a 404, never a market with something odd taken off it.
 */
export function splitSiteVersions(param: string): { market: string; versions: Record<string, string> } {
  const at = param.indexOf(SEPARATOR);
  if (at < 0) return { market: param, versions: {} };
  const tokens = param.slice(at + 1).split(JOIN);
  const versions: Record<string, string> = {};
  for (const token of tokens) {
    const match = TOKEN.exec(token);
    if (!match) return { market: param, versions: {} };
    versions[token.slice(0, 8)] = match[1];
  }
  return tokens.length > 0 && tokens.length <= 6 ? { market: param.slice(0, at), versions } : { market: param, versions: {} };
}

/** What a kind of test is a test of, in the owner's words. */
export const KIND_WORDS: Record<TargetKind, { name: string; where: string }> = {
  page: { name: "Page", where: "at the page's address" },
  layout: { name: "Product layout", where: "on every product page that uses this layout" },
  header: { name: "Header", where: "on every page of the store" },
  footer: { name: "Footer", where: "on every page of the store" },
};

/** A test's target in a sentence or a table: a page by its address, anything else by what it is and its name. */
export const targetLabel = (kind: TargetKind, slug: string, title: string): string => (kind === "page" ? `/${slug}` : `${KIND_WORDS[kind].name}: ${title}`);
