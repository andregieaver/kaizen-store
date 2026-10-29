/**
 * What a browser's report of the site-wide Report-Only policy (D389, PSI SEC-05) is kept as: the directive it broke, where the blocked
 * thing came from (an origin, or a keyword such as `inline` or `eval`) and which part of the site it was on (`admin` or `site`), never
 * the page's address or the blocked address in full, either of which can carry a token. Pure; `/api/csp-report` logs what it returns.
 * Both report formats are read: `report-uri`'s `{ "csp-report": { … } }` and the Reporting API's list of `{ type: "csp-violation", body }`.
 */

export type CspViolation = { directive: string; blocked: string; area: "admin" | "site" };

/** At most this many violations are read from one request. */
export const CSP_REPORTS_MAX = 10;

const KEYWORDS = new Set(["inline", "eval", "wasm-eval", "data", "blob", "self", "trusted-types-policy", "trusted-types-sink"]);

/** The blocked address as kept: a keyword, an origin, or `other`. */
export function blockedOrigin(value: unknown): string {
  if (typeof value !== "string" || value === "") return "other";
  if (KEYWORDS.has(value)) return value;
  if (value.startsWith("data:")) return "data";
  if (value.startsWith("blob:")) return "blob";
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "wss:" || url.protocol === "ws:" ? url.origin : "other";
  } catch {
    return "other";
  }
}

function areaOf(documentUrl: unknown): CspViolation["area"] {
  if (typeof documentUrl !== "string") return "site";
  try {
    return new URL(documentUrl).pathname.startsWith("/admin") ? "admin" : "site";
  } catch {
    return "site";
  }
}

const DIRECTIVE = /^[a-z-]{3,40}$/;

function violation(directive: unknown, blocked: unknown, documentUrl: unknown): CspViolation | null {
  const name = typeof directive === "string" ? directive.split(" ")[0] : "";
  if (!DIRECTIVE.test(name)) return null;
  return { directive: name, blocked: blockedOrigin(blocked), area: areaOf(documentUrl) };
}

/** The violations a report body holds, read as kept; anything else in it is dropped. */
export function cspViolations(body: unknown): CspViolation[] {
  const found: CspViolation[] = [];
  const items = Array.isArray(body) ? body : [body];
  for (const item of items.slice(0, CSP_REPORTS_MAX)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const legacy = record["csp-report"];
    if (legacy && typeof legacy === "object") {
      const r = legacy as Record<string, unknown>;
      const one = violation(r["effective-directive"] ?? r["violated-directive"], r["blocked-uri"], r["document-uri"]);
      if (one) found.push(one);
      continue;
    }
    if (record.type === "csp-violation" && record.body && typeof record.body === "object") {
      const r = record.body as Record<string, unknown>;
      const one = violation(r.effectiveDirective, r.blockedURL, r.documentURL ?? record.url);
      if (one) found.push(one);
    }
  }
  return found;
}
