import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ADMIN_PAGES } from "./admin-map";
import { platformAreaIn, platformAreaOfPath } from "./platform-access";
import { PLATFORM_SECTIONS, platformItemsOf, platformNavAreas } from "./platform-nav";

/**
 * The platform's guards (D510) stay where they belong: every `requirePlatform("area")` and `platformCan(account, "area")` under the platform
 * admin names the area of the folder it sits in (the root's actions and Home's controls name each their own), and no server action or route
 * that changes something asks only `requirePlatformReader()`, which lets every role in. A guard's area is in code because a server action can
 * be posted to any page's address; this test holds that copy to the area the page's navigation entry names (D851), never its tab.
 */

const root = path.resolve(__dirname, "../..");
const base = path.join(root, "src/app/admin/(gated)/platform");

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(full) : /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

const files = filesUnder(base);
/** Each folder of the platform admin as an address after its base, route groups and all ("/plans/analytics/payouts/[payoutId]"). */
const folders = [...new Set(files.map((file) => path.relative(base, path.dirname(file)).split(path.sep).join("/")))].filter((rel) => rel !== "");

describe("the platform's guards (D510)", () => {
  it("name the area of the folder they sit in", () => {
    const wrong: string[] = [];
    for (const file of files) {
      const rel = path.relative(base, path.dirname(file)).split(path.sep).join("/");
      if (rel === "") continue; // The root's actions are each their own area's.
      const area = platformAreaOfPath(`/${rel}`);
      const source = readFileSync(file, "utf8");
      for (const m of source.matchAll(/requirePlatform\("(\w+)"/g)) if (m[1] !== area) wrong.push(`${path.relative(root, file)}: ${m[1]} (the folder is ${area})`);
      // A page's or a route's own check by hand (`if (!platformCan(account, "settings", "read")) notFound()`) and a control's are held the same way.
      for (const m of source.matchAll(/platformCan\(\w+, "(\w+)"/g)) if (m[1] !== area) wrong.push(`${path.relative(root, file)}: platformCan ${m[1]} (the folder is ${area})`);
    }
    expect(wrong).toEqual([]);
  });

  it("never let every role change something", () => {
    const servers = [...files, ...filesUnder(path.join(root, "src/server")), ...filesUnder(path.join(root, "src/app/api"))].filter((file) => {
      const text = readFileSync(file, "utf8");
      return text.includes("requirePlatformReader(") && (/^["']use server["']/m.test(text) || /export async function (POST|PUT|PATCH|DELETE)\b/.test(text));
    });
    expect(servers.map((f) => path.relative(root, f))).toEqual([]);
  });
});

describe("a platform page's area is its own, not its tab (D851)", () => {
  /** Every folder the guards above are held to, and every platform page of the map. */
  const addresses = [...new Set(["", ...folders.map((rel) => `/${rel}`), ...ADMIN_PAGES.filter((p) => p.area === "platform").map((p) => p.path)])];

  it("leaves every folder's and page's area as it is when any sidebar page moves to another section", () => {
    const before = addresses.map((address) => platformAreaOfPath(address));
    let moves = 0;
    PLATFORM_SECTIONS.forEach((section, s) =>
      platformItemsOf(section).forEach((item) => {
        // To the next section of another area (`PLATFORM_SECTIONS`, D877), whose area the page took before D851; one with no sidebar gets one.
        const offsets = PLATFORM_SECTIONS.map((_, i) => (s + 1 + i) % PLATFORM_SECTIONS.length);
        const to = offsets.find((i) => PLATFORM_SECTIONS[i].area !== item.area)!;
        const moved = PLATFORM_SECTIONS.map((x, i) => ({
          ...x,
          groups: x.groups.map((g) => ({ ...g, items: i === s ? g.items.filter((other) => other !== item) : g.items })),
        }));
        const target = moved[to];
        target.groups = target.groups.length > 0 ? target.groups.map((g, i) => (i === target.groups.length - 1 ? { ...g, items: [...g.items, item] } : g)) : [{ heading: target.label, items: [item] }];
        // The menu now lists it under another section, whose area decided before D851.
        expect([item.path, target.area === item.area]).toEqual([item.path, false]);
        const areas = platformNavAreas(moved);
        expect([item.path, addresses.map((address) => platformAreaIn(areas, address))]).toEqual([item.path, before]);
        moves += 1;
      }),
    );
    expect(moves).toBeGreaterThan(50);
    expect(addresses.length).toBeGreaterThan(100);
  });
});
