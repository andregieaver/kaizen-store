// First guard of the light routes (bloat review step 0.4). Step 1.8's src/server/route-load.graph.test.ts walks the whole import graph and replaces this file.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const BEACONS = [
  "src/app/api/visit/route.ts",
  "src/app/api/visit/touch/route.ts",
  "src/app/api/visit/speed/route.ts",
  "src/app/api/visit/speed/own/route.ts",
  "src/app/api/recommendations/events/route.ts",
];

const HEAVY = ["@/server/chat-route", "@/server/chat-agent", "@/server/auth", "@/server/ai", "@/lib/admin-text"];

/** The heavy modules a file's text imports (an empty list is a light file). */
export function heavyImports(text: string): string[] {
  const sources = [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1]);
  return sources.filter((source) => HEAVY.includes(source));
}

describe("the light routes", () => {
  it.each(BEACONS)("%s imports no chat, auth, AI or admin-text module", (path) => {
    expect(heavyImports(readFileSync(path, "utf8"))).toEqual([]);
  });

  it("chat-route.ts offers neither sameSite nor fail", () => {
    const text = readFileSync("src/server/chat-route.ts", "utf8");
    expect(text).not.toContain("sameSite");
    expect(text).not.toContain("export const fail");
  });

  it("sees a planted import of the chat's module", () => {
    expect(heavyImports('import { sameSite } from "@/server/chat-route";')).not.toEqual([]);
  });
});
