import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The page builder's sandbox is an allow-list (D457, `docs/builder-sandbox.md` 4.2 and 4.3), held here from the source:
 * - every action of a sandbox opens it with its pass first (`open()`, which is `sandboxFor()`), except the one that refuses everything;
 * - every page under `/admin/try/{sandbox}` and the template preview reads its sandbox through the pass;
 * - the builder's context leaves out what the sandbox must never do: uploads, every AI, scheduling, share links, A/B tests, translation,
 *   a second page beside, and sharing with other stores;
 * - templates come from the marketplace only.
 */
const ROOT = process.cwd();
const TRY = join(ROOT, "src/app/admin/try");
const read = (path: string) => readFileSync(path, "utf8");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Each exported function of a file with its body, its braces balanced. */
function exportedFunctions(source: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  // The body opens with the first `{` that ends a line: a type's braces never do.
  for (const match of source.matchAll(/export async function (\w+)\([^]*?\{\n/g)) {
    let depth = 1;
    let i = match.index! + match[0].length;
    const start = i;
    while (i < source.length && depth > 0) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") depth--;
      i++;
    }
    out.push({ name: match[1], body: source.slice(start, i - 1) });
  }
  return out;
}

describe("the sandbox's allow-list (D457)", () => {
  const actions = read(join(TRY, "[sandbox]/actions.ts"));

  it("opens the sandbox with its pass before anything else in every action", () => {
    const fns = exportedFunctions(actions);
    expect(fns.length).toBeGreaterThan(25);
    const REFUSES_ALL = ["sandboxSetPartSharingAction"];
    const unopened = fns
      .filter((fn) => !REFUSES_ALL.includes(fn.name))
      .filter((fn) => !/^\s*const sandbox = await open\(sandboxId\);/.test(fn.body))
      .map((fn) => fn.name);
    expect(unopened).toEqual([]);
    expect(actions).toMatch(/const open = \(sandboxId: string\): Promise<Sandbox \| null> => sandboxFor\(sandboxId\);/);
  });

  it("refuses sharing a saved part outright, and keeps a saved part private", () => {
    const sharing = exportedFunctions(actions).find((fn) => fn.name === "sandboxSetPartSharingAction");
    expect(sharing?.body).toMatch(/return \{ ok: false, problems: \[await notHere\(\)\] \};/);
    expect(actions.match(/sharing: "private"/g)?.length).toBe(2);
  });

  it("offers templates from the marketplace only", () => {
    expect(actions).not.toMatch(/listTemplates\([^)]*"stores"/);
    expect(actions).toMatch(/if \(!sandbox \|\| source !== "marketplace"\) return \[\];/);
    for (const name of ["sandboxSetTemplateActiveAction", "sandboxApplyTemplateAction"]) {
      expect(exportedFunctions(actions).find((fn) => fn.name === name)?.body).toMatch(/await marketplace\(sandbox\)/);
    }
  });

  it("calls no AI, sends nothing and uploads nothing", () => {
    expect(actions).not.toMatch(/\baiFor\(|sendEmail\(|uploadToLibrary\(|startVideoUpload\(|fetch\(/);
    expect(actions).toMatch(/planPageMotion\(null,/);
  });

  it("reads every page's sandbox through the pass", () => {
    const pages = files(TRY).filter((path) => path.endsWith("/page.tsx") && path !== join(TRY, "page.tsx"));
    expect(pages.length).toBeGreaterThanOrEqual(5);
    const unread = pages.filter((path) => !/\b(sandboxOf|sandboxAndKind|sandboxFor)\(/.test(read(path))).map((path) => relative(ROOT, path));
    expect(unread).toEqual([]);
  });

  it("leaves out of the builder's context what a sandbox never does", () => {
    const context = read(join(TRY, "[sandbox]/context.ts"));
    for (const field of ["blog", "schedule", "share", "dualPages", "upload", "pictures", "pictureEdit", "aiChange", "startVideo", "experimentsHref", "variantOf", "translate", "previewStore"]) {
      expect(context, field).toMatch(new RegExp(`\\b${field}: null,`));
    }
    expect(context).toMatch(/startFile: null/);
    expect(context).toMatch(/signupCodes: \[\],/);
  });
});
