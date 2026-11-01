import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every area of `/api` is drawn in the threat model (PSI SEC-01): `docs/security.md` section 2.11 names each top-level folder of
 * `src/app/api` with the check a request meets first. A new folder fails here until its door is written down there.
 */
const root = path.resolve(__dirname, "../..");

describe("the threat model names every area of /api", () => {
  const api = path.join(root, "src/app/api");
  const areas = readdirSync(api).filter((entry) => statSync(path.join(api, entry)).isDirectory());
  const doc = readFileSync(path.join(root, "docs/security.md"), "utf8");
  const table = doc.slice(doc.indexOf("### 2.11"), doc.indexOf("## 3."));

  it("has a row in section 2.11 for each, and none for a folder that is gone", () => {
    expect(areas.length).toBeGreaterThan(20);
    const missing = areas.filter((area) => !table.includes(`| \`/api/${area}\` |`));
    expect(missing).toEqual([]);
    const rows = [...table.matchAll(/^\| `\/api\/([a-z0-9-]+)` \|/gm)].map((m) => m[1]);
    expect(rows.filter((row) => !areas.includes(row))).toEqual([]);
  });
});
