import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SRC, chain, directive, files, read, reach, rel, resolve, specifiersOf } from "@/test/import-walk";

import baseline from "./admin-bundle.baseline.json";

/**
 * The admin's browser scripts under the import walk (bloat review step 1.4, `docs/performance.md`, `docs/rules/budgets.md`), as the
 * visitor's are under `src/lib/storefront-bundle.scan.test.ts`. Every `"use client"` module of `src/app/admin` and `src/components/admin`
 * is walked through its static value imports (`src/test/import-walk.ts`). A static walk does not follow `import()`: a part loaded on a
 * press may be large, and `server-only` files and server action files are not walked into (a reference in the browser, not its code).
 *   1. The frame: the client parts the four gated layouts draw reach no zod, no Supabase client and no area's catalogue (only `common`
 *      and `sign-in`). FRAME_EXCEPTIONS starts empty (step 0.9 took them off).
 *   2. zod: the client modules that reach zod are listed in `admin-bundle.baseline.json` (`zodReach`); a new one fails. Move the
 *      schema to a `-schema.ts` file beside the helper, or read the helper from a module without zod. Rewrite the list, once a module
 *      has stopped (or when growth is accepted on purpose, shown in the diff), with
 *      `WRITE_ADMIN_BUNDLE_BASELINE=1 pnpm exec vitest run src/components/admin/admin-bundle.scan.test.ts`.
 * Steps 2.26, 2.29 and 2.46 add their rules through `clientsReaching()`.
 */
const WRITE = process.env.WRITE_ADMIN_BUNDLE_BASELINE === "1";

const FRAME_LAYOUTS = [
  "app/admin/(gated)/layout.tsx",
  "app/admin/(gated)/[store]/layout.tsx",
  "app/admin/(gated)/platform/layout.tsx",
  "app/admin/(gated)/(owner)/layout.tsx",
];
/** `first -> last` pairs of frame chains allowed to stay; step 0.9 left none, and none is added without the owner's word. */
const FRAME_EXCEPTIONS: string[] = [];
/** Catalogue files the frame may reach: the shell's common words and the sign-in page's. */
const FRAME_CATALOGUES = ["lib/admin-messages/common.en.ts", "lib/admin-messages/sign-in.en.ts"];
const CATALOGUE = /^lib\/admin-messages\/[\w-]+\.(en|nb)\.ts$/;

function under(dir: string): string[] {
  return files(join(SRC, dir));
}
const CLIENTS = [...under("app/admin"), ...under("components/admin")].filter((file) => directive(read(file), "use client"));
const FORBIDDEN_NAMES = ["zod", "@supabase"];

/** The client modules `entry` draws: its static value imports walked through modules without a directive, each met client module kept and not walked into. */
function clientParts(entry: string, planted?: Map<string, string[]>): string[] {
  const found = new Set<string>();
  const seen = new Set<string>([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    for (const specifier of specifiersOf(file, planted)) {
      const target = resolve(file, specifier);
      if (!target || FORBIDDEN_NAMES.includes(target) || target.startsWith("@") || seen.has(target)) continue;
      seen.add(target);
      const text = read(target);
      if (directive(text, "use client")) found.add(target);
      else if (!directive(text, "use server")) queue.push(target);
    }
  }
  return [...found];
}

/** The client modules (as `rel()` names) that reach `target`: a package name, or a file's `rel()` name. */
function clientsReaching(target: string, planted?: Map<string, string[]>): string[] {
  const names: string[] = [];
  for (const client of CLIENTS) {
    for (const name of [...reach(client, { planted }).keys()].map(rel)) {
      if (name === target) {
        names.push(rel(client));
        break;
      }
    }
  }
  return names.sort();
}

/** The chains `first -> ... -> last` by which a client module of the frame reaches zod, the Supabase client or an area's catalogue. */
function frameOffences(planted?: Map<string, string[]>): string[] {
  const found = new Set<string>();
  for (const layout of FRAME_LAYOUTS) {
    for (const client of clientParts(join(SRC, layout), planted)) {
      const seen = reach(client, { planted });
      for (const target of seen.keys()) {
        const name = rel(target);
        const bad = FORBIDDEN_NAMES.includes(name) || (CATALOGUE.test(name) && !FRAME_CATALOGUES.includes(name));
        if (bad) found.add(chain(seen, target).join(" -> "));
      }
    }
  }
  return [...found].sort();
}
const ends = (line: string) => `${line.split(" -> ")[0]} -> ${line.split(" -> ").at(-1)}`;

const zodReach = () => clientsReaching("zod");

describe.runIf(WRITE)("the baseline writer", () => {
  it("writes the baseline", () => {
    writeFileSync(join(SRC, "components/admin/admin-bundle.baseline.json"), JSON.stringify({ zodReach: zodReach() }, null, 2) + "\n");
  });
});

describe.skipIf(WRITE)("the admin's browser scripts (bloat review step 1.4)", () => {
  it("finds the client modules", () => {
    const names = CLIENTS.map(rel);
    expect(names.length).toBeGreaterThan(300);
    expect(names).toContain("components/admin/admin-rail.tsx");
  });

  it("the frame reaches no zod, no Supabase client and no area's catalogue", () => {
    const offences = frameOffences().filter((line) => !FRAME_EXCEPTIONS.includes(ends(line)));
    expect(offences, "a client part of an admin layout reaches zod, the Supabase client or a catalogue: cut the import chain, do not list it").toEqual([]);
    const live = new Set(frameOffences().map(ends));
    expect(FRAME_EXCEPTIONS.filter((pair) => !live.has(pair)), "take the pair off FRAME_EXCEPTIONS").toEqual([]);
  });

  it("no client module reaches zod that is not on the list, and the list only shrinks", () => {
    const now = zodReach();
    const known = new Set(baseline.zodReach);
    expect(
      now.filter((name) => !known.has(name)),
      "Move the schema to a -schema.ts file beside the helper, or read the helper from a module without zod; if the chain cannot be cut now, add it on purpose with WRITE_ADMIN_BUNDLE_BASELINE=1 pnpm exec vitest run src/components/admin/admin-bundle.scan.test.ts, so it shows in the diff.",
    ).toEqual([]);
    const gone = baseline.zodReach.filter((name) => !now.includes(name));
    expect(gone, "These no longer reach zod: take them off with WRITE_ADMIN_BUNDLE_BASELINE=1 pnpm exec vitest run src/components/admin/admin-bundle.scan.test.ts").toEqual([]);
  });

  it("would notice: zod planted on a part of the frame", () => {
    const first = clientParts(join(SRC, FRAME_LAYOUTS[0]))[0];
    expect(first).toBeDefined();
    const planted = new Map([[first, ["zod"]]]);
    expect(frameOffences(planted).some((line) => line.startsWith(rel(first)) && line.endsWith("-> zod"))).toBe(true);
    expect(zodReach()).not.toContain(rel(first));
    expect(clientsReaching("zod", planted)).toContain(rel(first));
  });

  it("would notice: the Supabase client planted on the same part", () => {
    const first = clientParts(join(SRC, FRAME_LAYOUTS[0]))[0];
    const planted = new Map([[first, ["@supabase/supabase-js"]]]);
    expect(frameOffences(planted).some((line) => line.endsWith("-> @supabase"))).toBe(true);
  });

  it("would notice: the product editor reaches zod exactly when it is on the list", () => {
    const editor = "components/admin/product-editor.tsx";
    const reaches = [...reach(join(SRC, editor)).keys()].includes("zod");
    expect(baseline.zodReach.includes(editor)).toBe(reaches);
  });
});
