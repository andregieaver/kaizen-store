import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A lifetime is fixed when a file is stored: a year for a file whose address never changes, "0" for a private one (bloat review step
 * 0.32, docs/media-compression.md).
 */
const ROOT = process.cwd();

/** The text of every call of `name(…)` in `text`, up to its matching closing parenthesis. */
function callsOf(text: string, name: string): string[] {
  const calls: string[] = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(`${name}(`, from);
    if (at === -1) return calls;
    let depth = 0;
    let end = at + name.length;
    for (; end < text.length; end++) {
      if (text[end] === "(") depth++;
      else if (text[end] === ")" && --depth === 0) break;
    }
    calls.push(text.slice(at, end + 1));
    from = at + name.length + 1;
  }
}

function filesUnder(dir: string, extensions: string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(path, extensions);
    return extensions.some((ext) => entry.name.endsWith(ext)) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const rel = (path: string) => path.slice(ROOT.length + 1);

describe("every stored file has a lifetime", () => {
  it("names one in every upload from the browser", () => {
    let total = 0;
    for (const file of filesUnder(join(ROOT, "src/components"), [".ts", ".tsx"])) {
      for (const call of callsOf(readFileSync(file, "utf8"), "uploadToSignedUrl")) {
        total++;
        expect(call, `${rel(file)}: an uploadToSignedUrl call without cacheControl`).toContain("cacheControl");
      }
    }
    // 10 with a social post's slideshow video (D870 S2.5).
    expect(total).toBe(10);
  });

  it("says how long it is kept for every server upload of made or fetched bytes", () => {
    for (const file of filesUnder(join(ROOT, "src"), [".ts"]).filter((f) => /\/src\/(server|app)\//.test(f))) {
      const text = readFileSync(file, "utf8").replace("export async function uploadBytes(", "export async function uploadBytesDeclared");
      for (const call of callsOf(text, "uploadBytes")) {
        expect(call.includes('"year"') || call.includes('"short"'), `${rel(file)}: an uploadBytes() call without "year" or "short"`).toBe(true);
      }
    }
  });

  it("keeps the font file at the CDN", () => {
    expect(read("src/app/api/fonts/files/[file]/route.ts")).toContain("s-maxage=31536000");
  });

  it("stores in each file the lifetime its files need", () => {
    for (const file of ["video-upload.tsx", "media-compress.ts", "product-media-tools.tsx", "field-file-upload.ts", "social-calendar.tsx"]) {
      for (const call of callsOf(read(`src/components/admin/${file}`), "uploadToSignedUrl")) expect(call, file).toContain('cacheControl: "31536000"');
    }
    for (const file of ["product-editor.tsx", "customer-import-flow.tsx", "redirects/redirect-import-flow.tsx", "inventory/stock-import-flow.tsx", "data/import-flow.tsx"]) {
      for (const call of callsOf(read(`src/components/admin/${file}`), "uploadToSignedUrl")) expect(call, file).toContain('cacheControl: "0"');
    }
    for (const file of ["theme-shots.ts", "replicate-assets.ts"]) {
      for (const call of callsOf(read(`src/server/${file}`), "uploadBytes")) expect(call, file).toContain('"year"');
    }
    for (const call of callsOf(read("src/server/replicate-store.ts"), "uploadBytes")) expect(call).toContain('"short"');
  });

  it("would notice a call without a lifetime", () => {
    const browser = callsOf("x.uploadToSignedUrl(p, t, file, { contentType: f(a) })", "uploadToSignedUrl");
    expect(browser).toHaveLength(1);
    expect(browser[0]).not.toContain("cacheControl");
    const server = callsOf('await uploadBytes("product-media", path, bytes, type)', "uploadBytes");
    expect(server).toHaveLength(1);
    expect(server[0].includes('"year"') || server[0].includes('"short"')).toBe(false);
  });
});
