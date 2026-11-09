import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { platformAreaOfPath } from "./platform-access";

/**
 * The platform's guards (D510) stay where they belong: every `requirePlatform("area")` under the platform admin names the area of the folder it
 * sits in (the root's actions name each their own), and no server action or route that changes something asks only `requirePlatformReader()`,
 * which lets every role in. A guard's area is in code because a server action can be posted to any page's address.
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

describe("the platform's guards (D510)", () => {
  it("name the area of the folder they sit in", () => {
    const wrong: string[] = [];
    for (const file of files) {
      const rel = path.relative(base, path.dirname(file)).split(path.sep).join("/");
      if (rel === "") continue; // The root's actions are each their own area's.
      const area = platformAreaOfPath(`/${rel}`);
      for (const m of readFileSync(file, "utf8").matchAll(/requirePlatform\("(\w+)"/g)) if (m[1] !== area) wrong.push(`${path.relative(root, file)}: ${m[1]} (the folder is ${area})`);
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
