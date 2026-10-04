// One-off, run BEFORE the permission sweep (wave 1, 1f, docs/wave-1-trust.md 2.7.2): reads every entry point of a store's
// admin and every helper that asks who may do something, and writes src/lib/permissions.baseline.json, the oracle the
// sweep is measured against. For each file: what it asked for before roles existed (`member`: any member of the store;
// `owner`: the owner role; `none`: nothing of its own, it relies on a layout or on the caller) and the lines that say so.
//
//   node scripts/permission-baseline.mjs          # writes the file
//   node scripts/permission-baseline.mjs --check  # fails if the file is not what the working tree before the sweep gives
//
// `--check` is meant for the commit that holds the baseline: after the sweep the files no longer say `requireMember(`, so it
// is not run again. The matrix test (src/lib/permissions.matrix.test.ts) reads the file and compares what owners and admins
// could do with what they can do now; the page's area is derived there from the store navigation, so the baseline cannot
// drift from it.
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const SRC = path.join(root, "src");
const OUT = path.join(SRC, "lib", "permissions.baseline.json");

const CALLS = ["requireMember", "getMembership", "requireOwner"];
// What a guard that asks for the owner role looks like, before roles: a comparison with the string "owner" on a role.
const OWNER_CHECK = /(?:\brole\b|\.role\b)\s*(?:!==|===|!=|==)\s*["']owner["']|\bisOwner\s*\(/;
const CALL = new RegExp(`\\b(${CALLS.join("|")})\\s*\\(`);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const rel = (file) => path.relative(root, file).split(path.sep).join("/");
const isTest = (file) => /\.(test|int\.test)\.tsx?$/.test(file) || file.endsWith(".d.ts");

const STORE_ROOT = "src/app/admin/(gated)/[store]/";
const WORK_ROOT = "src/app/admin/(gated)/(owner)/account/work/s/[store]/";
const OWNER_STORE_ROOT = "src/app/admin/(gated)/(owner)/stores/copy/[store]/";

/** What kind of entry point or helper a file is, and (for a page) its address after the store's. */
function classify(file) {
  const name = path.basename(file);
  const inStore = file.startsWith(STORE_ROOT);
  const inWork = file.startsWith(WORK_ROOT);
  const inOwner = file.startsWith(OWNER_STORE_ROOT);
  const inApi = file.startsWith("src/app/api/");
  const tail = (base) =>
    "/" +
    file
      .slice(base.length)
      .split("/")
      .slice(0, -1)
      .filter((s) => !/^\(.*\)$/.test(s))
      .join("/");
  const entry = /^(page|layout|route|default|not-found)\.tsx?$/.test(name) ? name.replace(/\.tsx?$/, "").replace("not-found", "page") : /actions/i.test(name) ? "action" : null;
  if (inStore) return { kind: entry ?? "module", surface: "store", path: entry === "page" || entry === "layout" || entry === "route" ? tail(STORE_ROOT).replace(/\/$/, "") : null };
  if (inWork) return { kind: entry ?? "module", surface: "work", path: entry === "page" || entry === "layout" || entry === "route" ? tail(WORK_ROOT).replace(/\/$/, "") : null };
  if (inOwner) return { kind: entry ?? "module", surface: "owner", path: null };
  if (inApi) return { kind: entry === "route" ? "route" : "module", surface: "api", path: "/" + file.slice("src/app/".length).split("/").slice(0, -1).join("/") };
  if (file.startsWith("src/app/admin/")) return { kind: entry ?? "module", surface: "admin", path: null };
  if (file.startsWith("src/components/")) return { kind: "component", surface: "component", path: null };
  if (file.startsWith("src/server/")) return { kind: "helper", surface: "server", path: null };
  return { kind: "module", surface: "other", path: null };
}

const entries = [];
for await (const full of walk(SRC)) {
  if (!/\.tsx?$/.test(full) || isTest(full)) continue;
  const file = rel(full);
  if (file === "src/server/auth.ts") continue; // the guard's own home
  const text = await readFile(full, "utf8");
  const lines = text.split("\n");
  const calls = new Set();
  const callLines = [];
  const ownerLines = [];
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "");
    const call = CALL.exec(code);
    if (call && !/^\s*(import|export)\b.*\bfrom\b/.test(code) && !/^\s*import\b/.test(code)) {
      calls.add(call[1]);
      callLines.push(i + 1);
    }
    if (OWNER_CHECK.test(code) && !/^\s*import\b/.test(code)) ownerLines.push({ line: i + 1, text: code.trim().replace(/\s+/g, " ").slice(0, 140) });
  });
  const { kind, surface, path: where } = classify(file);
  // Every entry point of a store's admin is listed, even one that asks for nothing itself: the sweep must meet it.
  const entryPoint = (surface === "store" || surface === "work" || surface === "owner") && ["page", "layout", "route", "action", "default"].includes(kind);
  const apiEntry = surface === "api" && kind === "route" && (calls.size > 0 || ownerLines.length > 0);
  if (!(calls.size > 0 || ownerLines.length > 0 || entryPoint || apiEntry)) continue;
  const legacy = ownerLines.length > 0 && calls.size > 0 ? "owner" : calls.size > 0 ? "member" : ownerLines.length > 0 ? "owner" : "none";
  entries.push({
    file,
    surface,
    kind,
    ...(where !== null && { path: where }),
    legacy,
    calls: [...calls].sort(),
    ...(callLines.length > 0 && { callLines }),
    ...(ownerLines.length > 0 && { ownerChecks: ownerLines }),
  });
}
entries.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));

const summary = entries.reduce((n, e) => ({ ...n, [e.legacy]: (n[e.legacy] ?? 0) + 1 }), {});
const out = {
  note: "Written by scripts/permission-baseline.mjs before the permission sweep (wave 1, 1f). The oracle: what each file asked for before roles. Do not edit by hand.",
  guards: CALLS,
  summary,
  entries,
};
const text = JSON.stringify(out, null, 2) + "\n";

if (process.argv.includes("--check")) {
  const current = await readFile(OUT, "utf8").catch(() => "");
  if (current !== text) {
    console.error("src/lib/permissions.baseline.json is not what the tree gives (it is the oracle from before the sweep).");
    process.exit(1);
  }
  console.log(`baseline holds: ${entries.length} files`);
} else {
  await writeFile(OUT, text);
  console.log(`wrote ${rel(OUT)}: ${entries.length} files`, summary);
}
