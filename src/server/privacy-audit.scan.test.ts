import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { areaOfAction } from "@/lib/audit";

/**
 * What an audit entry may hold (D162, `docs/wave-1g-gdpr.md` 4.10): ids, counts, kinds, dates, the actor; never an email, a name, an address, a phone
 * or free text. The activity log is shown to staff and kept for 24 months, so a person's data in it would outlive their erasure. This scan reads
 * every `audit()` call of the privacy and retention modules (and the customer actions) and fails for a detail named like personal data, and for an
 * action that has no area; the integration tests read the written rows for the values.
 */

const SERVER = join(process.cwd(), "src", "server");
const FILES = readdirSync(SERVER).filter((f) => /^(privacy-(?!fixture)[a-z-]+|retention|customers|customer-admin)\.ts$/.test(f));

/** Every audit call: its action (a literal in the privacy, customer or retention families) and the object literal of its details. */
function auditCalls(source: string): { action: string; details: string }[] {
  const out: { action: string; details: string }[] = [];
  for (const m of source.matchAll(/audit\(\s*[^,]+,\s*[^,]+,\s*"((?:customer|privacy|retention)\.[a-z_.]+)"\s*,\s*\{/g)) {
    // The object literal: balance the braces from the opening one.
    let depth = 1;
    let i = m.index! + m[0].length;
    const start = i;
    while (i < source.length && depth > 0) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") depth--;
      i++;
    }
    out.push({ action: m[1], details: source.slice(start, i - 1) });
  }
  return out;
}

const PERSONAL_KEY = /(?:^|[\s,{])(email|name|address|phone|note|message|subject|company|label)\s*[:,}]/;
const PERSONAL_VALUE = /\.(?:email|name|phone|address)\b(?!\s*:)/;

describe("the activity log never holds a person's data", () => {
  it("finds the audit calls of the privacy modules (so the scan is not empty)", () => {
    const calls = FILES.flatMap((f) => auditCalls(readFileSync(join(SERVER, f), "utf8")));
    const actions = new Set(calls.map((c) => c.action));
    for (const a of ["customer.data_exported", "customer.erased", "privacy.request_logged", "privacy.request_extended", "privacy.request_refused", "retention.run", "privacy.retention_applied"]) {
      expect(actions.has(a), a).toBe(true);
    }
  });

  it("writes only ids, counts, kinds and dates in the details of every such entry", () => {
    const bad: string[] = [];
    for (const f of FILES) {
      for (const call of auditCalls(readFileSync(join(SERVER, f), "utf8"))) {
        if (PERSONAL_KEY.test(call.details) || PERSONAL_VALUE.test(call.details)) bad.push(`${f}: ${call.action}: ${call.details.replace(/\s+/g, " ").slice(0, 120)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("gives every action an area of the admin (customers for a person's, platform for the schedule)", () => {
    for (const f of FILES) {
      for (const call of auditCalls(readFileSync(join(SERVER, f), "utf8"))) {
        const area = areaOfAction(call.action);
        expect(area, call.action).toBeTruthy();
        expect(area, call.action).toBe(call.action.startsWith("retention.") ? "platform" : "customers");
      }
    }
  });

  it("sees a detail that names a person (the scan can fail)", () => {
    expect(PERSONAL_KEY.test("{ email: subject.email }")).toBe(true);
    expect(PERSONAL_KEY.test("{ customer: id, counts }")).toBe(false);
    expect(PERSONAL_VALUE.test("{ who: customer.email }")).toBe(true);
  });
});
