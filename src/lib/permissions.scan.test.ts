import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { ADMIN_PAGES, matchPath } from "./admin-map";
import baseline from "./permissions.baseline.json";
import { DELEGATED_GUARDS, GUARDS } from "./permission-guards";
import { BUILDER_AREAS, BUILDER_READ, BUILDER_WRITE, MEMBERSHIP_ONLY_PAGE_IDS, PAGE_TYPE_AREA, permissionOfPath } from "./permissions";

/**
 * The sweep of wave 1, 1f (docs/wave-1-trust.md 2.7.2), held mechanically: every page, route handler, layout and server action of a store's
 * admin (and the Work screens, which live at the owner's level but belong to a store) asks a guard from `GUARDS` (`src/server/permissions.ts`)
 * with the key of its own area, and nothing else decides who the owner is. A new admin file that forgets its guard fails here, so a role can
 * never see a page by accident.
 *
 * What is held:
 *  1. every entry point calls a guard, directly or through a wrapper in `DELEGATED_GUARDS` that itself calls one;
 *  2. the guard's key is the key of the page's place in the store navigation (`permissionOfPath()`): a page needs `read`, an action or a route that
 *     changes something `write`, a page marked `needs: "owner"` the owner key and nothing else; a read-only action is named in `READ_ONLY_ACTIONS`;
 *  3. the key is a literal (a guard with a variable key cannot be checked);
 *  4. the owner key appears only where the page was the owner's before roles (the baseline written before the sweep) or the map marks it so;
 *  5. a file that asked for the owner role before still does (the baseline is the oracle: no page gained or lost);
 *  6. no bare `requireMember(` or `getMembership(` outside `src/server/auth.ts` and `src/server/permissions.ts`, and no comparison of a
 *     membership's role with "owner" in the store admin or the server modules that act for a member.
 */

const root = process.cwd();
const STORE = "src/app/admin/(gated)/[store]/";
/** The store's printable views (an invoice or a credit note without the admin around it, wave 1b): the same guards, no store layout. */
const STORE_PRINT = "src/app/admin/(gated)/(print)/[store]/";
const WORK = "src/app/admin/(gated)/(owner)/account/work/s/[store]/";
const WORK_PRINT = "src/app/admin/(gated)/(print)/account/work/s/[store]/";
/** Entry points of other trees that take a store from the address; each has its own expectation. */
const OTHERS: Record<string, "any" | "owner" | string> = {
  // Duplicating a store: the owner's (a platform admin who is a member too); the page checks the owner key itself.
  "src/app/admin/(gated)/(owner)/stores/copy/[store]/page.tsx": "any",
  // A template shown in the builder: whoever can open the website's pages.
  "src/app/admin/(gated)/(print)/account/templates/s/[store]/[templateId]/preview/page.tsx": "website:read",
};

/** Files that ask for the owner role where the map would let a member in: each says why (a new file, so the baseline cannot). */
const OWNER_ONLY_EXTRA: Record<string, string> = {
  "src/app/admin/(gated)/[store]/analytics/tax/actions.ts": "an exchange rate changes the figures a tax return is made from (wave 1, 1c): the ECB fetch and an owner's own rate are the owner's",
  "src/app/admin/(gated)/[store]/activity/export/route.ts": "the activity log's CSV export is the owner's (wave 1, 1f 2.9); the page itself is open to every member, narrowed by what they may read",
};

/**
 * Files the baseline marks `owner` only because they compare a *company* account's role (D108: the main account of a company, or an employee)
 * with "owner", which is nobody's role in the store.
 */
const BASELINE_FALSE_OWNER = new Set([
  "src/app/admin/(gated)/[store]/companies/[companyId]/page.tsx",
  "src/app/admin/(gated)/[store]/customers/[customerId]/page.tsx",
]);

/** Actions that only read (a preview, a list, a lookup): they ask the area's `read`, so a view-only role can still open the screen that calls them. */
const READ_ONLY_ACTIONS = new Set(["storeGridPreviewAction", "storeGridTermsAction", "storeLinkTargetsAction", "templatesListAction", "termFieldsAction", "worklistAction", "workReader"]);

const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

const walk = (dir: string, found: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.int\.test\.ts$/.test(name) && !name.endsWith(".d.ts")) found.push(path);
  }
  return found;
};

const rel = (path: string) => relative(root, path).split("\\").join("/");
const allFiles = walk(join(root, "src")).map(rel);
const text = (file: string) => readFileSync(join(root, file), "utf8");

type Kind = "page" | "layout" | "route" | "action";
type Entry = { file: string; kind: Kind; surface: "store" | "work" | "other"; path: string };

/** The address after the store's, route groups taken out. */
const tailOf = (file: string, base: string) =>
  "/" +
  file
    .slice(base.length)
    .split("/")
    .slice(0, -1)
    .filter((segment) => !/^\(.*\)$/.test(segment))
    .join("/");

function discover(): Entry[] {
  const entries: Entry[] = [];
  const kindOf = (file: string): Kind | null => {
    const name = file.split("/").pop()!;
    if (name === "page.tsx") return "page";
    if (name === "layout.tsx") return "layout";
    if (name === "route.ts") return "route";
    if (/^\s*["']use server["']/.test(text(file))) return "action";
    return null;
  };
  for (const file of allFiles) {
    const surface = file.startsWith(STORE) || file.startsWith(STORE_PRINT) ? "store" : file.startsWith(WORK) || file.startsWith(WORK_PRINT) ? "work" : file in OTHERS ? "other" : null;
    if (!surface) continue;
    const kind = kindOf(file);
    if (!kind) continue;
    const base = file.startsWith(STORE) ? STORE : file.startsWith(STORE_PRINT) ? STORE_PRINT : file.startsWith(WORK) ? WORK : file.startsWith(WORK_PRINT) ? WORK_PRINT : "";
    entries.push({ file, kind, surface, path: base ? tailOf(file, base).replace(/\/$/, "") : "" });
  }
  return entries;
}

const entries = discover();

type BaselineEntry = { file: string; legacy: "member" | "owner" | "none" };
const baselineOf = new Map((baseline.entries as BaselineEntry[]).map((e) => [e.file, e]));

/**
 * The key a store address needs: the map's for the page itself, or for the nearest ancestor page when the address is a sub-route of one
 * (`/assistant/turn`, `/activity/export`, `/orders/[orderId]/label/[shipmentId]`): a route handler belongs to the page it serves.
 */
function keyFor(path: string, access: "read" | "write"): string | null {
  let current = path;
  for (;;) {
    const matched = matchPath(`/admin/_store${current}`);
    if (matched && matched.page.area === "store") return permissionOfPath(current, access);
    if (!current) return permissionOfPath(path, access);
    current = current.replace(/\/[^/]*$/, "");
  }
}

type Used = {
  /** A literal key, `owner`, `any` (membership only), `anyOf` (a list), `pagetype`, `delegated` or `dynamic`. */
  key: string;
  /** For `anyOf`: the keys, any of which opens the file. */
  keys?: string[];
  fn: string | null;
  delegated?: boolean;
  /** For a page builder view: the kind of page it was given. */
  pageType?: string;
};

const functionBefore = (source: string, index: number): string | null => {
  const head = source.slice(0, index);
  const found = [...head.matchAll(/(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/g)];
  const last = found[found.length - 1];
  return last ? (last[1] ?? last[2] ?? null) : null;
};

/** The top-level arguments of the call that opens at `open` (the index of its "("), as text. */
function argumentsOf(source: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = open + 1;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) {
        args.push(source.slice(start, i).trim());
        return args;
      }
    } else if (ch === "," && depth === 1) {
      args.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }
  return args;
}

const KEY = /^["']([a-z]+:(?:read|write))["']$/;

/** Every guard the file calls, with the key it asks for ("any" for membership only, "dynamic" when the key is not a literal). */
function guardsIn(file: string): Used[] {
  const source = strip(text(file));
  const used: Used[] = [];
  for (const m of source.matchAll(/\b(requirePermission|checkPermission)\(/g)) {
    const args = argumentsOf(source, m.index! + m[0].length - 1);
    const literal = /^["']([a-z]+:(?:read|write)|owner)["']$/.exec(args[1] ?? "");
    used.push({ key: literal ? literal[1] : "dynamic", fn: functionBefore(source, m.index!) });
  }
  for (const m of source.matchAll(/\b(requireAnyPermission|checkAnyPermission)\(/g)) {
    const args = argumentsOf(source, m.index! + m[0].length - 1);
    const list = (args[1] ?? "").trim();
    let keys: string[] | null = null;
    if (list === "BUILDER_READ") keys = [...BUILDER_READ];
    else if (list === "BUILDER_WRITE") keys = [...BUILDER_WRITE];
    else if (/^\[[\s\S]*\]$/.test(list)) {
      const parts = list.slice(1, -1).split(",").map((part) => part.trim()).filter(Boolean);
      keys = parts.every((part) => KEY.test(part)) ? parts.map((part) => KEY.exec(part)![1]) : null;
    }
    used.push(keys ? { key: "anyOf", keys, fn: functionBefore(source, m.index!) } : { key: "dynamic", fn: functionBefore(source, m.index!) });
  }
  for (const m of source.matchAll(/\b(requirePageTypeAccess|checkPageTypeAccess)\(/g)) used.push({ key: "pagetype", fn: functionBefore(source, m.index!) });
  for (const m of source.matchAll(/\b(requireOwnerRole|checkOwnerRole)\(/g)) used.push({ key: "owner", fn: functionBefore(source, m.index!) });
  for (const m of source.matchAll(/\b(requireMemberAny|checkMemberAny)\(/g)) used.push({ key: "any", fn: functionBefore(source, m.index!) });
  for (const name of Object.keys(DELEGATED_GUARDS)) {
    for (const m of source.matchAll(new RegExp(`\\b${name}\\(`, "g"))) {
      if (name === "analyticsContext") {
        const args = argumentsOf(source, m.index! + m[0].length - 1);
        used.push({ key: /^["']owner["']$/.test(args[2] ?? "") ? "owner" : "analytics:read", fn: functionBefore(source, m.index!), delegated: true });
      } else used.push({ key: "delegated", fn: functionBefore(source, m.index!), delegated: true });
    }
    // A view drawn as an element: `<StorePagesListView type="page" .../>`, which passes its kind of page to the guard inside.
    for (const m of source.matchAll(new RegExp(`<${name}\\b[^>]*?\\btype="([a-z_]+)"`, "gs"))) {
      used.push({ key: "delegated", fn: functionBefore(source, m.index!), delegated: true, pageType: m[1] });
    }
  }
  return used;
}

const mutates = (file: string) => /export\s+(?:async\s+)?(?:function|const)\s+(POST|PUT|PATCH|DELETE)\b/.test(text(file));

describe("every entry point of a store's admin asks a guard", () => {
  it("finds the store admin's pages, routes, layouts and actions (the scan is not empty)", () => {
    expect(entries.filter((e) => e.surface === "store" && e.kind === "page").length).toBeGreaterThan(100);
    expect(entries.filter((e) => e.surface === "store" && e.kind === "action").length).toBeGreaterThan(30);
    expect(entries.filter((e) => e.surface === "store" && e.kind === "route").length).toBeGreaterThan(10);
    expect(entries.filter((e) => e.surface === "work").length).toBeGreaterThan(20);
  });

  it("calls at least one guard, directly or through a wrapper", () => {
    const unguarded = entries.filter((e) => guardsIn(e.file).length === 0).map((e) => e.file);
    expect(unguarded).toEqual([]);
  });

  it("never asks a guard for a key it cannot read (the key is a literal)", () => {
    const dynamic = entries.filter((e) => guardsIn(e.file).some((g) => g.key === "dynamic")).map((e) => e.file);
    expect(dynamic).toEqual([]);
  });

  it("asks only for the key of the page's own area: read for a page, write for what changes something, owner where the page is the owner's", () => {
    const wrong: string[] = [];
    for (const entry of entries) {
      const legacyOwner = baselineOf.get(entry.file)?.legacy === "owner";
      const writes = entry.kind === "action" || (entry.kind === "route" && mutates(entry.file));
      let derived: string | null;
      if (entry.surface === "store") derived = keyFor(entry.path, writes ? "write" : "read");
      else if (entry.surface === "work") derived = writes ? "settings:write" : "settings:read";
      else derived = OTHERS[entry.file] === "any" ? null : OTHERS[entry.file];
      const area = derived && derived !== "owner" ? derived.split(":")[0] : null;
      for (const used of guardsIn(entry.file)) {
        let ok: boolean;
        if (used.key === "delegated") ok = used.pageType === undefined || (derived !== null && derived !== "owner" && PAGE_TYPE_AREA[used.pageType as keyof typeof PAGE_TYPE_AREA] === area);
        else if (derived === "owner") ok = used.key === "owner";
        else if (used.key === "owner") ok = legacyOwner || entry.file in OWNER_ONLY_EXTRA;
        else if (used.key === "any") ok = derived === null || entry.kind === "layout";
        else if (derived === null) ok = false;
        else if (used.key === "pagetype") ok = BUILDER_AREAS.includes(area as never) && entry.surface === "store";
        else if (used.key === "anyOf") {
          // The file's own key is among them, and the others belong to the page builder's areas only.
          const target = entry.kind === "action" && used.fn && READ_ONLY_ACTIONS.has(used.fn) ? derived.replace(":write", ":read") : derived;
          const own = used.keys!.includes(target);
          const others = used.keys!.every((key) => BUILDER_AREAS.includes(key.split(":")[0] as never) || key === derived);
          ok = own && others && BUILDER_AREAS.includes(area as never);
        } else if (used.key === derived) ok = true;
        else if (used.key === `${area}:read` && entry.kind === "action") ok = used.fn !== null && READ_ONLY_ACTIONS.has(used.fn);
        else if (used.key === `${area}:write` && entry.kind === "route") ok = writes;
        else ok = false;
        // A helper inside an action file (`asOwner`, `workMember`) is held to the same rule: it is where the guard is.
        if (!ok) wrong.push(`${entry.file}: asks ${used.key}${used.keys ? ` ${used.keys.join("|")}` : ""}${used.fn ? ` in ${used.fn}` : ""}, the page needs ${derived ?? "membership only"}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("has every exported server action ask a guard itself, or call a helper of its file that does", () => {
    const guardNames = new Set<string>([...GUARDS, ...Object.keys(DELEGATED_GUARDS)]);
    const bare: string[] = [];
    for (const entry of entries.filter((e) => e.kind === "action")) {
      const sf = ts.createSourceFile(entry.file, text(entry.file), ts.ScriptTarget.Latest, true);
      const functions = new Map<string, ts.Node>();
      const exported: string[] = [];
      // An action that takes no store (the person's own running timer, across their stores) acts for the account, not for a store's member.
      const forAStore = new Set<string>();
      const firstParam = (fn: ts.SignatureDeclaration) => fn.parameters[0]?.name.getText(sf) ?? "";
      for (const st of sf.statements) {
        if (ts.isFunctionDeclaration(st) && st.name && st.body) {
          functions.set(st.name.text, st.body);
          if (/store/i.test(firstParam(st))) forAStore.add(st.name.text);
          if (st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) exported.push(st.name.text);
        } else if (ts.isVariableStatement(st)) {
          for (const d of st.declarationList.declarations) {
            if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
              functions.set(d.name.text, d.initializer.body);
              if (/store/i.test(firstParam(d.initializer))) forAStore.add(d.name.text);
              if (st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) exported.push(d.name.text);
            }
          }
        }
      }
      const callsOf = (node: ts.Node): string[] => {
        const names: string[] = [];
        const visit = (n: ts.Node) => {
          if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) names.push(n.expression.text);
          ts.forEachChild(n, visit);
        };
        visit(node);
        return names;
      };
      const guarded = (name: string, seen = new Set<string>()): boolean => {
        if (seen.has(name)) return false;
        seen.add(name);
        const body = functions.get(name);
        if (!body) return false;
        return callsOf(body).some((call) => guardNames.has(call) || (functions.has(call) && guarded(call, seen)));
      };
      for (const name of exported) if (forAStore.has(name) && !guarded(name)) bare.push(`${entry.file}: ${name}`);
    }
    expect(bare).toEqual([]);
  });

  it("keeps the owner key where the baseline says the file asked for the owner role before roles, and the owner role only there", () => {
    const lost: string[] = [];
    const gained: string[] = [];
    for (const entry of entries) {
      const before = baselineOf.get(entry.file);
      if (!before) continue;
      const source = strip(text(entry.file));
      const asksOwner =
        guardsIn(entry.file).some((g) => g.key === "owner") || /\bmemberCan\([^)]*["']owner["']\)/.test(source) || /\bcan\(\{[^}]*\},\s*["']owner["']\)/.test(source);
      const derivedOwner = entry.surface === "store" && keyFor(entry.path, "read") === "owner";
      if (before.legacy === "owner" && !asksOwner && !BASELINE_FALSE_OWNER.has(entry.file) && !guardsIn(entry.file).some((g) => g.delegated)) lost.push(entry.file);
      if (before.legacy !== "owner" && guardsIn(entry.file).some((g) => g.key === "owner") && !derivedOwner) gained.push(entry.file);
    }
    expect({ lost, gained }).toEqual({ lost: [], gained: [] });
  });

  it("is held to by every store page of the map: it has a key, or is membership only", () => {
    const withoutKey = ADMIN_PAGES.filter((p) => p.area === "store")
      .filter((p) => p.needs !== "owner" && permissionOfPath(p.path) === null && !(MEMBERSHIP_ONLY_PAGE_IDS as readonly string[]).includes(p.id))
      .map((p) => p.id);
    expect(withoutKey).toEqual([]);
  });

  it("has wrappers that call a guard themselves, each in the file it is listed with", () => {
    for (const [name, file] of Object.entries(DELEGATED_GUARDS)) {
      const source = strip(text(file));
      expect(source, `${name} is defined in ${file}`).toMatch(new RegExp(`(?:function|const)\\s+${name}\\b`));
      expect(GUARDS.some((guard) => new RegExp(`\\b${guard}\\(`).test(source)), `${name} calls a guard`).toBe(true);
    }
  });
});

describe("nothing else decides who the owner is", () => {
  const exempt = new Set(["src/server/auth.ts", "src/server/permissions.ts"]);
  const code = allFiles.filter((f) => f.startsWith("src/") && !exempt.has(f));

  it("has no bare requireMember() or getMembership() outside the two files", () => {
    const bare = code.filter((f) => /\b(requireMember|getMembership)\(/.test(strip(text(f)))).sort();
    expect(bare).toEqual([]);
  });

  /**
   * Comparisons that are not a member's role in a store: the account's own list of stores (`StoreSummary`, the control center, the
   * level switcher), a company account's role (`company_role`, D108), the platform's list of a store's people. Each is a line of text.
   */
  const NOT_A_MEMBERS_ROLE = [
    "stores.some((s) => s.role",
    'access.role === "owner" ? "Main account of "',
    'member.role === "owner" ? "Main account" : "Employee"',
    "people.find((p) => p.role",
    'owner.role === "owner" ? "Owner" : "Staff"',
    "s.role === \"owner\"",
    'store.role === "owner"',
    'mine.role === "owner"',
    'member.role === "owner" ? m.roleOwner',
    'row.company_role === "owner"',
    'role === "owner" ? tierPercent',
  ];

  it("compares no membership's role with owner in the store admin or in the modules that act for a member", () => {
    const scope = code.filter((f) => f.startsWith(STORE) || f.startsWith(WORK) || f.startsWith(WORK_PRINT) || (f.startsWith("src/server/") && !f.endsWith(".test.ts")));
    const offending: string[] = [];
    for (const file of scope) {
      strip(text(file))
        .split("\n")
        .forEach((line, index) => {
          if (!/(?:\brole|\.role)\s*(?:===|!==|==|!=)\s*["']owner["']/.test(line)) return;
          if (NOT_A_MEMBERS_ROLE.some((allowed) => line.includes(allowed))) return;
          offending.push(`${file}:${index + 1}: ${line.trim()}`);
        });
    }
    expect(offending).toEqual([]);
  });
});
