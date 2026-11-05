import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The page builder's sandbox is an allow-list (D457, `docs/builder-sandbox.md` 4.2 and 4.3), held here from the source:
 * - every action of a sandbox opens it with its pass first (`open()`, which is `sandboxFor()`), except the one that refuses everything;
 * - every page under `/admin/try/{sandbox}` and the template preview reads its sandbox through the pass, and so does every route (its AI);
 * - the AI is reached only through `sandboxAi()` (the sandbox's allowance and budget), an upload only through `uploadToLibrary()` (its
 *   storage), and the context's AI endpoints are the sandbox's own routes, never a store's;
 * - the builder's context leaves out what the sandbox must never do: videos and files, scheduling, share links, A/B tests and sharing
 *   with other stores, and a second page beside comes from the sandbox's own documents only;
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

  it("switches only to a free theme, within its copy budget (S4, D286)", () => {
    const look = exportedFunctions(actions).find((fn) => fn.name === "sandboxUseLookAction")?.body ?? "";
    expect(look).toMatch(/if \(!theme \|\| isPremium\(theme\.prices \?\? \[\]\)\) redirect\(/);
    expect(look).toMatch(/takeBudget\(null, "sandbox_copy", sandbox\.id\)/);
    expect(look).not.toMatch(/charge|"grant"/);
  });

  it("offers templates from the marketplace only", () => {
    expect(actions).not.toMatch(/listTemplates\([^)]*"stores"/);
    expect(actions).toMatch(/if \(!sandbox \|\| source !== "marketplace"\) return \[\];/);
    for (const name of ["sandboxSetTemplateActiveAction", "sandboxApplyTemplateAction"]) {
      expect(exportedFunctions(actions).find((fn) => fn.name === name)?.body).toMatch(/await marketplace\(sandbox\)/);
    }
  });

  it("reaches the AI only through sandboxAi(), uploads only within its storage, and sends no email itself (the keep request's link is the sign-up's own)", () => {
    expect(actions).not.toMatch(/\baiFor\(|\bcompleteText\(|sendEmail\(|startVideoUpload\(|registerVideo\(|storePicture\(|copyToLibrary\(|fetch\(/);
    expect(actions.match(/uploadToLibrary\(\{/g)?.length).toBe(1);
    expect(exportedFunctions(actions).find((fn) => fn.name === "sandboxUploadAction")?.body).toMatch(
      /return uploadToLibrary\(\{ storeId: sandbox\.store\.id, accountId: sandbox\.account\.id \}, formData\);/,
    );
    expect(actions).toMatch(/planPageMotion\(await sandboxAi\(sandbox, "page_motion"\), rows\.rows\)/);
    expect(actions).toMatch(/const connection = await sandboxAi\(sandbox, "page_translation"\);/);
    // sandboxAi() takes the platform's connection only while the allowance has room (`aiFor()`), and counts each call in its budget.
    const server = read(join(ROOT, "src/server/sandbox.ts"));
    expect(server).toMatch(/const connection = await aiFor\(sandbox\.store\.id, \{ feature, accountId: sandbox\.account\.id \}\);\n  if \(!connection\) return null;\n  if \(!\(await takeBudget\(null, "sandbox_ai", sandbox\.id\)\)\) return null;/);
  });

  it("answers the AI's requests only through the pass and on the sandbox's AI", () => {
    const routes = files(TRY).filter((path) => path.endsWith("/route.ts"));
    expect(routes.map((path) => relative(TRY, path)).sort()).toEqual([
      "[sandbox]/ai/change/route.ts",
      "[sandbox]/ai/edit/route.ts",
      "[sandbox]/ai/make/route.ts",
      "[sandbox]/store/route.ts",
    ]);
    for (const route of routes) expect(read(route), route).toMatch(/from "@\/server\/sandbox-(ai|storefront)";/);
    // The storefront's pass (S4) only after the sandbox's own.
    expect(read(join(ROOT, "src/server/sandbox-storefront.ts"))).toMatch(
      /const sandbox = await sandboxFor\(sandboxId\);\n  if \(!sandbox\) return NextResponse\.redirect\(new URL\(sandboxHome\(sandboxId\)/,
    );
    const ai = read(join(ROOT, "src/server/sandbox-ai.ts"));
    expect(ai).not.toMatch(/\baiFor\(|checkPermission\(|getAccount\(/);
    expect(ai).toMatch(/const sandbox = await sandboxFor\(sandboxId\);\n  if \(!sandbox\) return notFound\(\);/);
    const handlers = [...ai.matchAll(/export async function (\w+)\(request: Request, sandboxId: string\): Promise<Response> \{\n(.*)\n/g)];
    expect(handlers.map((m) => m[1])).toEqual(["sandboxPictureRequest", "sandboxEditRequest", "sandboxChangeRequest"]);
    for (const handler of handlers) expect(handler[2], handler[1]).toBe("  const ask = await asked(request, sandboxId);");
    for (const feature of ["page_pictures", "picture_edit", "page_change"]) expect(ai).toContain(`await connection(ask.sandbox, "${feature}")`);
  });

  it("reads every page's sandbox through the pass", () => {
    const pages = files(TRY).filter((path) => path.endsWith("/page.tsx") && path !== join(TRY, "page.tsx"));
    expect(pages.length).toBeGreaterThanOrEqual(5);
    const unread = pages.filter((path) => !/\b(sandboxOf|sandboxAndKind|sandboxFor)\(/.test(read(path))).map((path) => relative(ROOT, path));
    expect(unread).toEqual([]);
  });

  it("names its store in every email, so the one gate that refuses a sandbox's emails sees every one (4.4)", () => {
    const sources = [...files(join(ROOT, "src/server")), ...files(join(ROOT, "src/app"))];
    const calls: string[] = [];
    const unnamed: string[] = [];
    for (const path of sources) {
      const source = read(path);
      for (const match of source.matchAll(/\bsendEmail\(\{/g)) {
        let depth = 1;
        let i = match.index! + match[0].length;
        while (i < source.length && depth > 0) {
          if (source[i] === "{") depth++;
          else if (source[i] === "}") depth--;
          i++;
        }
        const where = `${relative(ROOT, path)}:${source.slice(0, match.index).split("\n").length}`;
        calls.push(where);
        if (!/\bstoreId\b/.test(source.slice(match.index, i))) unnamed.push(where);
      }
    }
    expect(calls.length).toBeGreaterThan(50);
    expect(unnamed).toEqual([]);
    expect(read(join(ROOT, "src/server/email.ts"))).toMatch(/if \(store\.sandbox\) return "suppressed: a sandbox sends no email";/);
  });

  it("leaves out of the builder's context what a sandbox never does, and points its AI at its own routes", () => {
    const context = read(join(TRY, "[sandbox]/context.ts"));
    for (const field of ["schedule", "share", "startVideo", "experimentsHref", "variantOf", "previewStore"]) {
      expect(context, field).toMatch(new RegExp(`\\b${field}: null,`));
    }
    expect(context).toMatch(/startFile: null/);
    expect(context).toMatch(/signupCodes: \[\],/);
    expect(context).toMatch(/upload: uploadsEnabled\(\) \? bind\(sandboxUploadAction\) : null,/);
    for (const [field, route] of [["pictures", "make"], ["pictureEdit", "edit"], ["aiChange", "change"]]) {
      expect(context, field).toMatch(new RegExp(`${field}: ${field} \\? \\{ endpoint: \`\\$\\{sandboxHome\\(id\\)\\}/ai/${route}\` \\} : null,`));
    }
    expect(context).not.toMatch(/\/admin\/\$\{/);
    // Dual page (S4): rooted at the sandbox, its choices the sandbox's own, its second document loaded through the sandbox alone.
    expect(context).toMatch(/dualPages: \{\n      root: sandboxHome\(id\),/);
    expect(context).toContain("choices: bind(sandboxDualChoicesAction),");
    const editor = read(join(TRY, "[sandbox]/editor.tsx"));
    expect(editor).not.toMatch(/checkPageTypeAccess|storePageContext|getAccount\(/);
    expect(editor).toMatch(/const savedParts = await listSavedParts\(store\.id\);/);
    // *View* opens its own preview of the published page, never the store's private address.
    expect(context).toContain("viewAt: `${sandboxBase(id, type)}/{id}/preview?published=1`,");
    expect(context).toMatch(/manageHref: sandboxHome\(sandbox\.id\),/);
  });
});
