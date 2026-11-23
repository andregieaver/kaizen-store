// The navigation doc's command line (code review step 4.3, D885): docs/admin-navigation.md's tables of tabs and pages are written from
// the menu's data at all three levels (src/lib/admin-navigation.ts, pure; node strips its types).
//
//   node scripts/admin-navigation.mjs write   rewrite what lies between the nav:generated markers; the prose around them is kept
//   node scripts/admin-navigation.mjs check   fail when a table differs from the menu (CI holds the same in src/lib/admin-navigation.test.ts)
//
// No database, no secrets, no build. The nav modules import their neighbours without an extension, as the bundler allows, so a
// TypeScript file's relative or `@/` import is resolved here as the bundler would: `@/` is src/, and a missing extension is `.ts`.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(import.meta.dirname, "..");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith(".ts") && (specifier.startsWith(".") || specifier.startsWith("@/"))) {
      const file = specifier.startsWith("@/") ? path.join(root, "src", specifier.slice(2)) : fileURLToPath(new URL(specifier, context.parentURL));
      const found = [`${file}.ts`, path.join(file, "index.ts")].find((f) => existsSync(f) && statSync(f).isFile());
      if (!(existsSync(file) && statSync(file).isFile()) && found) return nextResolve(pathToFileURL(found).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { NAV_DOC, navDocProblems, writeNavDoc } = await import("../src/lib/admin-navigation.ts");

const command = process.argv[2] ?? "check";
if (!["write", "check"].includes(command)) {
  console.error(`unknown command "${command}": use write or check`);
  process.exit(2);
}

const file = path.join(root, NAV_DOC);
const doc = readFileSync(file, "utf8");
const { markers, stale } = navDocProblems(doc);

if (markers.length > 0) {
  console.error(`${NAV_DOC}'s markers need fixing by hand:`);
  for (const m of markers) console.error(`  ${m}`);
  process.exit(1);
}
if (command === "write") {
  if (stale.length === 0) console.log(`${NAV_DOC} is already up to date`);
  else {
    writeFileSync(file, writeNavDoc(doc));
    console.log(`rewrote ${stale.length} table section(s) of ${NAV_DOC}: ${stale.join(", ")}`);
  }
} else if (stale.length > 0) {
  console.error(`${NAV_DOC} differs from the menu in ${stale.join(", ")}. Run pnpm nav:write.`);
  process.exit(1);
} else console.log(`${NAV_DOC}: the tables match the menu at all three levels`);
