import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { importsOf, packageOf, sourceFiles } from "../../scripts/lib/import-walk.mjs";
import pkg from "../../package.json";

/**
 * Every direct package has a reason and an importer (bloat review step 1.8, DP-6). A package that is added, or whose last import goes,
 * fails here until the line is written or removed: a dependency nobody imports is install time, a lockfile and a patch surface for nothing.
 * `loads` says where its code runs: the server, the browser, both, the build (types and tools that run at build time), the tests, or as a
 * peer another package needs and nothing here imports.
 */
type Loads = "server" | "browser" | "both" | "build" | "test" | "peer";
const PACKAGES: Record<string, { why: string; loads: Loads }> = {
  "@codemirror/autocomplete": { why: "Completion in the owner's CSS editor (css-code-editor.tsx).", loads: "browser" },
  "@codemirror/commands": { why: "Editing commands and history in the owner's CSS editor.", loads: "browser" },
  "@codemirror/lang-css": { why: "CSS language support in the owner's CSS editor.", loads: "browser" },
  "@codemirror/language": { why: "Syntax highlighting and indentation of the owner's CSS editor.", loads: "browser" },
  "@codemirror/state": { why: "The CSS editor's state.", loads: "browser" },
  "@codemirror/view": { why: "The CSS editor's view.", loads: "browser" },
  "@dnd-kit/core": { why: "Drag and drop in the page builder and the deal board.", loads: "browser" },
  "@dnd-kit/sortable": { why: "Sortable lists in the page builder.", loads: "browser" },
  "@dnd-kit/utilities": { why: "Transform helpers for the drag and drop parts.", loads: "browser" },
  "@google/model-viewer": { why: "The 3D model in a product gallery (product-gallery.tsx), loaded when a model is shown.", loads: "browser" },
  "@jsquash/avif": { why: "AVIF encoding of pictures in the browser (avif-encode.ts).", loads: "browser" },
  "@lezer/highlight": { why: "Highlight tags for the CSS editor's theme.", loads: "browser" },
  "@rrweb/record": { why: "The session recorder of heatmaps and recordings (D656), loaded for a sampled tab.", loads: "browser" },
  "@rrweb/replay": { why: "The owner's recording player (recording-player.tsx).", loads: "browser" },
  "@rrweb/types": { why: "Pinned to the same version as the two rrweb packages above, which need it (docs/heatmaps-and-recordings.md); nothing here imports it.", loads: "peer" },
  "@signpdf/placeholder-pdf-lib": { why: "The signature placeholder of a sealed contract PDF (contract-seal.ts).", loads: "server" },
  "@signpdf/signer-p12": { why: "Signs a contract PDF with the platform's certificate (contract-seal.ts).", loads: "server" },
  "@signpdf/signpdf": { why: "Writes the signature into a contract PDF (contract-seal.ts).", loads: "server" },
  "@sparticuz/chromium": { why: "The Chromium that runs on a Vercel function, for page looks, map shots and replication (browser.ts).", loads: "server" },
  "@stripe/connect-js": { why: "Stripe's embedded Connect components in the admin.", loads: "browser" },
  "@stripe/react-connect-js": { why: "The React wrapper of the embedded Connect components.", loads: "browser" },
  "@stripe/react-stripe-js": { why: "Stripe's payment elements in the checkout.", loads: "browser" },
  "@stripe/stripe-js": { why: "Stripe.js and its types (checkout-appearance.ts).", loads: "browser" },
  "@supabase/realtime-js": { why: "The support desk's live channel (use-support-channel.ts).", loads: "browser" },
  "@supabase/ssr": { why: "The sign-in session in cookies, for the server and the browser (lib/supabase).", loads: "both" },
  "@supabase/supabase-js": { why: "Supabase Auth and Storage calls (lib/supabase).", loads: "both" },
  "@tiptap/core": { why: "The rich text engine of inline editing.", loads: "browser" },
  "@tiptap/extensions": { why: "Tiptap's extensions for the editors.", loads: "browser" },
  "@tiptap/pm": { why: "Tiptap's ProseMirror packages, a peer that @tiptap/core and @tiptap/react require.", loads: "peer" },
  "@tiptap/react": { why: "Tiptap's React bindings for the rich text editors.", loads: "browser" },
  "@tiptap/starter-kit": { why: "The starting set of Tiptap extensions of the admin's rich text editor.", loads: "browser" },
  "@vercel/functions": { why: "waitUntil and the function's attached database pool (db/client.ts).", loads: "server" },
  "drizzle-orm": { why: "The query builder and schema of every database read and write.", loads: "server" },
  fontverter: { why: "Converts a trimmed font to WOFF2 (font-trim.ts).", loads: "server" },
  "lucide-react": { why: "The admin's and the storefront's icons.", loads: "both" },
  mammoth: { why: "Reads a Word file into text for the knowledge base (knowledge.ts).", loads: "server" },
  mediabunny: { why: "Compresses a video in the browser before upload (video-compress.ts).", loads: "browser" },
  motion: { why: "Scroll-linked motion (motion-scroll.ts), loaded where a page uses it.", loads: "browser" },
  next: { why: "The framework.", loads: "both" },
  "node-forge": { why: "Reads the platform's PKCS#12 certificate for a contract seal (contract-seal.ts).", loads: "server" },
  "opentype.js": { why: "Turns text into outlines for brand marks (font-outlines.ts).", loads: "server" },
  "pdf-lib": { why: "Builds and edits PDFs: contracts and documents (contract-seal.ts).", loads: "server" },
  pg: { why: "The pooled Postgres driver of the app (db/client.ts).", loads: "server" },
  "playwright-core": { why: "Drives Chromium for page looks, map shots, replication and scripts.", loads: "server" },
  postgres: { why: "The direct Postgres connection of migrations and scripts (store-hosts-build.ts, scripts/).", loads: "server" },
  "qrcode-generator": { why: "QR codes for a product passport (qr.ts).", loads: "server" },
  react: { why: "The UI library.", loads: "both" },
  "react-dom": { why: "Renders the UI in the browser and on the server.", loads: "both" },
  "seek-bzip": { why: "Unpacks a legal source's bzip2 file (legal-sources.ts).", loads: "server" },
  "server-only": { why: "Makes a server module fail the build when a browser file imports it.", loads: "server" },
  sharp: { why: "Resizes, converts and edits pictures on the server.", loads: "server" },
  stripe: { why: "Stripe's server SDK: payments, Connect, billing.", loads: "server" },
  "subset-font": { why: "Trims a font to the glyphs a brand mark uses (font-trim.ts).", loads: "server" },
  three: { why: "A peer of @google/model-viewer, which draws the 3D model with it; nothing here imports it.", loads: "peer" },
  unpdf: { why: "Reads the text of a PDF bill (bill-reading.ts).", loads: "server" },
  "web-push": { why: "Sends push notices to the installed admin (push.ts).", loads: "server" },
  "web-vitals": { why: "The speed beacon's measures (speed-beacon.tsx).", loads: "browser" },
  zod: { why: "Validates every form, action and external input.", loads: "both" },
  "@axe-core/playwright": { why: "The accessibility checks of the browser tests (e2e/a11y.ts).", loads: "test" },
  "@electric-sql/pglite": { why: "The in-process Postgres every migration is tested on (db/testing.ts).", loads: "test" },
  "@electric-sql/pglite-pgvector": { why: "The vector extension of that test database (db/testing.ts).", loads: "test" },
  "@playwright/test": { why: "The browser tests (e2e/) and their configuration.", loads: "test" },
  "@tailwindcss/postcss": { why: "Tailwind's PostCSS plugin, named by string in postcss.config.mjs.", loads: "build" },
  "@types/node": { why: "Types of Node's own modules.", loads: "build" },
  "@types/node-forge": { why: "Types of node-forge.", loads: "build" },
  "@types/opentype.js": { why: "Types of opentype.js.", loads: "build" },
  "@types/pg": { why: "Types of pg.", loads: "build" },
  "@types/react": { why: "Types of React.", loads: "build" },
  "@types/react-dom": { why: "Types of React DOM.", loads: "build" },
  "@types/web-push": { why: "Types of web-push.", loads: "build" },
  "drizzle-kit": { why: "Writes migrations from the schema (drizzle.config.ts).", loads: "build" },
  eslint: { why: "The linter.", loads: "build" },
  "eslint-config-next": { why: "Next's lint rules (eslint.config.mjs).", loads: "build" },
  tailwindcss: { why: "The stylesheet's engine (@import in globals.css).", loads: "build" },
  typescript: { why: "The type check and Next's type tooling.", loads: "build" },
  vitest: { why: "The unit and integration tests.", loads: "test" },
};

const root = process.cwd();
const declared = (field: Record<string, string> | undefined) => Object.keys(field ?? {});
const dependencies = declared(pkg.dependencies);
const devDependencies = declared(pkg.devDependencies);

/** A specifier of any import form, type-only ones included: a package used only for its types still has an importer. */
const ANY_IMPORT = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*["']([^"']+)["']/g;
const CODE = /\.(?:[mc]?[jt]s|tsx)$/;
const TEST_FILE = /(?:\.test\.|\.spec\.|\.int\.test\.)/;
/** Test support that lives beside code and is run only by tests (the same names the ratchet leaves out). */
const TEST_SUPPORT = /(?:fixtures?|test-support|testing|test-helper|test-days)\.tsx?$|^src\/test\//;

function files(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (name === "node_modules") continue;
    if (statSync(file).isDirectory()) files(file, found);
    else if (CODE.test(name)) found.push(file);
  }
  return found;
}
const rel = (file: string) => path.relative(root, file).split(path.sep).join("/");

const rootConfigs = readdirSync(root).filter((name) => /\.config\.[^.]+$|\.mts$/.test(name));
const code = [...files(path.join(root, "src")), ...files(path.join(root, "scripts")), ...rootConfigs.map((name) => path.join(root, name))];
const e2e = files(path.join(root, "e2e"));
const isTest = (file: string) => TEST_FILE.test(file) || TEST_SUPPORT.test(rel(file)) || rel(file).startsWith("e2e/");

/** The packages each file imports, by any form. */
const importersOf = new Map<string, Set<string>>();
for (const file of [...code, ...e2e]) {
  for (const match of readFileSync(file, "utf8").matchAll(ANY_IMPORT)) {
    const name = packageOf(match[1]);
    if (name) importersOf.set(name, (importersOf.get(name) ?? new Set()).add(rel(file)));
  }
}
// Next reads `@import "tailwindcss"` from the stylesheet, which is not code.
importersOf.set("tailwindcss", (importersOf.get("tailwindcss") ?? new Set()).add("src/app/globals.css"));

describe("the direct dependencies (bloat review 1.8)", () => {
  it("every package has a line saying why it is here, and no line is for a package that is not", () => {
    const all = [...dependencies, ...devDependencies];
    expect(
      all.filter((name) => !PACKAGES[name]),
      "add a line to PACKAGES in src/lib/dependencies.scan.test.ts saying why the package is here and where it loads",
    ).toEqual([]);
    expect(
      Object.keys(PACKAGES).filter((name) => !all.includes(name)),
      "remove the line of a package that package.json no longer lists from PACKAGES in src/lib/dependencies.scan.test.ts",
    ).toEqual([]);
    for (const [name, line] of Object.entries(PACKAGES)) expect(line.why.length, name).toBeGreaterThan(10);
  });

  it("every package that loads code has an importer", () => {
    const missing = Object.entries(PACKAGES).flatMap(([name, { loads }]) => {
      if (loads === "peer" || loads === "build") return [];
      const importers = [...(importersOf.get(name) ?? [])];
      // A test package needs an importer anywhere (tests included); the others need one that is not a test.
      const ok = loads === "test" ? importers.length > 0 : importers.some((file) => !isTest(path.join(root, file)));
      return ok ? [] : [`${name} (${loads}) has no importer${loads === "test" ? "" : " outside tests"}`];
    });
    expect(missing, "remove the package, or import it; a package imported by nothing by design is 'peer' or 'build' in PACKAGES with the reason").toEqual([]);
  });

  it("no code under src imports a devDependency as a value", () => {
    const dev = new Set(devDependencies);
    const found = (sourceFiles(path.join(root, "src")) as string[])
      .filter((file) => !TEST_SUPPORT.test(rel(file)))
      .flatMap((file) =>
        (importsOf(readFileSync(file, "utf8"), { dynamic: true }) as string[])
          .map((specifier) => packageOf(specifier))
          .filter((name): name is string => name !== null && dev.has(name))
          .map((name) => `${rel(file)} imports ${name}`),
      );
    expect(found, "a package the app loads belongs in dependencies, not devDependencies").toEqual([]);
  });
});
