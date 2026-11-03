import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { apiContract, breakingChanges, changelogVersions, contractHash, contractSurface, versionParts } from "./api-contract";

/**
 * The published contract's version (D438, `docs/wave-14-developer-platform.md` A5): the generated contract (both APIs' OpenAPI documents,
 * the webhook topics and the MCP catalogues) is the one recorded in `src/data/api-contract.json`, the changelog has an entry for its
 * version, and nothing a caller relies on is taken away within a major version.
 *
 * After a change to a contract: `WRITE_API_CONTRACT=1 pnpm exec vitest run src/lib/api-contract.test.ts` records the new hash and surface
 * with the next version (1.n+1, or the next major when something breaks), then write that version's entry in
 * `content/docs/developers/changelog.md`.
 */

const ROOT = process.cwd();
const RECORD = join(ROOT, "src/data/api-contract.json");
const SURFACE = join(ROOT, "src/data/api-contract-surface.json");
const CHANGELOG = join(ROOT, "content/docs/developers/changelog.md");
const WRITE = process.env.WRITE_API_CONTRACT === "1";

type Recorded = { version: string; hash: string };
type Kept = { version: string; surface: string[] };

const read = <T>(path: string, fallback: T): T => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback);

const contract = apiContract();
const hash = contractHash(contract);
const surface = contractSurface(contract);

if (WRITE) {
  const recorded = read<Recorded>(RECORD, { version: "1.0", hash: "" });
  const kept = read<Kept>(SURFACE, { version: recorded.version, surface: [] });
  if (recorded.hash !== hash || kept.surface.join("\n") !== surface.join("\n")) {
    const parts = versionParts(recorded.version) ?? { major: 1, minor: 0 };
    const breaks = kept.surface.length > 0 && breakingChanges(kept.surface, surface).length > 0;
    const version = recorded.hash === "" ? recorded.version : breaks ? `${parts.major + 1}.0` : `${parts.major}.${parts.minor + 1}`;
    writeFileSync(RECORD, `${JSON.stringify({ version, hash }, null, 2)}\n`);
    writeFileSync(SURFACE, `${JSON.stringify({ version, surface }, null, 1)}\n`);
  }
}

describe("the published API contract (D438)", () => {
  const recorded = read<Recorded>(RECORD, { version: "", hash: "" });
  const kept = read<Kept>(SURFACE, { version: "", surface: [] });

  it("is the one recorded, with its version", () => {
    expect(versionParts(recorded.version), "src/data/api-contract.json's version is 1.<n>").not.toBeNull();
    expect(
      hash,
      `The API contract changed: record it with WRITE_API_CONTRACT=1 pnpm exec vitest run src/lib/api-contract.test.ts (the version goes up to the next 1.<n>), then add that version's entry to content/docs/developers/changelog.md.`,
    ).toBe(recorded.hash);
  });

  it("has an entry in the changelog for the recorded version", () => {
    const entries = changelogVersions(readFileSync(CHANGELOG, "utf8"));
    expect(
      entries.map((e) => e.version),
      `Add an entry "## ${recorded.version} — YYYY-MM-DD" to content/docs/developers/changelog.md saying what changed for callers.`,
    ).toContain(recorded.version);
    // Newest first.
    expect(entries[0]?.version).toBe(recorded.version);
  });

  it("takes nothing a caller relies on away within a major version", () => {
    const breaks = breakingChanges(kept.surface, surface);
    const sameMajor = versionParts(kept.version)?.major === versionParts(recorded.version)?.major;
    expect(sameMajor ? breaks : [], "A removed path or field, or a field a request must now send, breaks v1 callers: keep it, or make it a new major version.").toEqual([]);
  });

  it("keeps the surface recorded with the contract", () => {
    expect(kept.version).toBe(recorded.version);
    expect(surface).toEqual(kept.surface);
  });
});

describe("how a breaking change is found", () => {
  const kept = ["admin GET /products", "admin GET /products -> data[].id", "admin GET /products -> data[].title", "admin POST /products", "admin POST /products <- title (required)"];

  it("sees a removed field or path and a newly required field, never an addition", () => {
    expect(breakingChanges(kept, [...kept, "admin GET /products -> data[].handle", "admin GET /orders", "admin GET /orders <- ?status (required)"])).toEqual([]);
    expect(breakingChanges(kept, kept.filter((l) => !l.endsWith("data[].title")))).toEqual(["removed: admin GET /products -> data[].title"]);
    expect(breakingChanges(kept, [...kept, "admin POST /products <- handle (required)"])).toEqual(["now required: admin POST /products <- handle (required)"]);
    // A field a request no longer has to send is not a break.
    expect(breakingChanges(kept, kept.filter((l) => !l.endsWith("(required)")))).toEqual([]);
  });

  it("reads versions and the changelog's headings", () => {
    expect(versionParts("1.12")).toEqual({ major: 1, minor: 12 });
    expect(versionParts("v1")).toBeNull();
    expect(changelogVersions("# Changelog\n\n## 1.1 — 2026-12-01\n\nMore.\n\n## 1.0 — 2026-11-03\n\nFirst.")).toEqual([
      { version: "1.1", date: "2026-12-01" },
      { version: "1.0", date: "2026-11-03" },
    ]);
  });

  it("is the same text every time it is made", () => {
    expect(contractHash(apiContract())).toBe(hash);
    expect(surface.length).toBeGreaterThan(500);
  });
});
