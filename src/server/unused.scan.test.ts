import { beforeAll, describe, expect, it } from "vitest";

import { TEST_SUPPORT } from "../../scripts/lib/ratchet-count.mjs";
import { unreferencedApiRoutes, unreferencedPublic, unusedScan } from "../../scripts/lib/unused-scan.mjs";
import baseline from "./unused.baseline.json";

/**
 * The unused-code budget (bloat review step 1.17, DD-4, GAP-code-2 and GAP-code-3): exports nothing imports, exports only tests import,
 * files only tests reach, files under public/ nothing names and route handlers under src/app/api whose URL nothing names, as
 * `unused.baseline.json` records them. A new one fails and the message says the fix. A fall, or an item that left a list, is a note,
 * never a failure (code is removed every day): `node scripts/unused.mjs --write` drops it from the file. The unused exports are held by
 * name; the exports only tests use are held by count (they may only fall), and the failure names the ones not in the list.
 */

const TESTS_ONLY_FIX = "a helper only tests need lives in a *-test-support.ts file; an oracle is listed in keptForTests with its reason (node scripts/unused.mjs --write)";

let scan: { unusedExports: string[]; testOnlyExports: string[]; testOnlyFiles: string[] };
let publicFiles: string[];
let apiRoutes: string[];

beforeAll(() => {
  const root = process.cwd();
  scan = unusedScan(root);
  publicFiles = unreferencedPublic(root);
  apiRoutes = unreferencedApiRoutes(root);
}, 120_000);

const kept = baseline.keptForTests as Record<string, string>;
const testOnlyFiles = baseline.testOnlyFiles as Record<string, string>;
const publicUnreferenced = baseline.publicUnreferenced as Record<string, string>;
const apiUnreferenced = baseline.apiUnreferenced as Record<string, string>;
const blank = (reason: string | undefined) => !reason || reason.trim().length === 0 || reason.trim() === "TODO";

describe("the unused-code budget (bloat review 1.17)", () => {
  it("adds no export that nothing imports", () => {
    const held = new Set(baseline.unusedExports);
    const added = scan.unusedExports.filter((item) => !held.has(item));
    expect(added, `${added.join(", ")}: nothing imports ${added.length === 1 ? "it" : "them"}; delete it or use it`).toEqual([]);
  });

  it("adds no export that only tests import", () => {
    const listed = new Set([...baseline.testOnlyExports, ...Object.keys(kept)]);
    const onlyTests = scan.testOnlyExports.filter((item) => !kept[item]);
    const added = onlyTests.filter((item) => !baseline.testOnlyExports.includes(item));
    expect(
      onlyTests.length,
      `exports only tests use, ${onlyTests.length}, baseline ${baseline.testOnlyExports.length}. New: ${added.filter((item) => !listed.has(item)).join(", ") || added.slice(0, 20).join(", ")}. ${TESTS_ONLY_FIX}`,
    ).toBeLessThanOrEqual(baseline.testOnlyExports.length);
  });

  it("adds no file that only tests reach", () => {
    const added = scan.testOnlyFiles.filter((file) => !TEST_SUPPORT.test(file) && !testOnlyFiles[file]);
    expect(added, `${added.join(", ")}: only tests reach ${added.length === 1 ? "it" : "them"}; a file only tests need is named *-test-support.ts or *fixtures.ts, else list it in testOnlyFiles with its reason (node scripts/unused.mjs --write)`).toEqual([]);
  });

  it("references every file under public/", () => {
    const added = publicFiles.filter((file) => !publicUnreferenced[file]);
    expect(added, `${added.join(", ")}: nothing in src, scripts, e2e, content, wordpress-plugin, next.config.ts or vercel.json names ${added.length === 1 ? "it" : "them"}; delete the file or list it in publicUnreferenced with its reason (node scripts/unused.mjs --write)`).toEqual([]);
  });

  it("references every route under src/app/api", () => {
    const added = apiRoutes.filter((route) => !apiUnreferenced[route]);
    expect(added, `${added.join(", ")}: nothing calls ${added.length === 1 ? "this route" : "these routes"}; delete it or list it in apiUnreferenced with its reason (node scripts/unused.mjs --write)`).toEqual([]);
  });

  it("keeps a reason for every entry that has one to give", () => {
    const empty = [
      ...Object.entries(kept),
      ...Object.entries(testOnlyFiles),
      ...Object.entries(publicUnreferenced),
      ...Object.entries(apiUnreferenced),
    ]
      .filter(([, reason]) => blank(reason))
      .map(([item]) => item);
    expect(empty, `${empty.join(", ")}: an entry needs a reason a reviewer can check in src/server/unused.baseline.json`).toEqual([]);
  });

  it("notes what left the lists: node scripts/unused.mjs --write drops it", () => {
    const gone = [
      ...baseline.unusedExports.filter((item) => !scan.unusedExports.includes(item)).map((item) => `unused export ${item}`),
      ...Object.keys(kept).filter((item) => !scan.testOnlyExports.includes(item)).map((item) => `kept for tests ${item}`),
      ...Object.keys(testOnlyFiles).filter((file) => !scan.testOnlyFiles.includes(file)).map((file) => `tests-only file ${file}`),
      ...Object.keys(publicUnreferenced).filter((file) => !publicFiles.includes(file)).map((file) => `public file ${file}`),
      ...Object.keys(apiUnreferenced).filter((route) => !apiRoutes.includes(route)).map((route) => `API route ${route}`),
    ];
    const fewer = baseline.testOnlyExports.length - scan.testOnlyExports.filter((item) => !kept[item]).length;
    if (gone.length > 0 || fewer > 0) console.info(`unused: ${gone.length} baseline items left their lists and ${Math.max(fewer, 0)} fewer exports are only tests'; run node scripts/unused.mjs --write.${gone.length > 0 ? ` ${gone.slice(0, 10).join(", ")}` : ""}`);
    expect(Array.isArray(baseline.unusedExports)).toBe(true);
  });
});
