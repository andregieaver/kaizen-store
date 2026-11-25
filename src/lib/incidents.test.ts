import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  canMove,
  cleanTitle,
  digestDue,
  fingerprintOf,
  firstStatus,
  INCIDENT_MOVES,
  INCIDENT_STATUSES,
  incidentGroup,
  statusFitsKind,
  workableStatus,
} from "./incidents";

/** The incident log's words and moves (D895). */
describe("the incident log's moves", () => {
  it("are the moves the database's trigger allows, in its newest version", () => {
    const dir = join(process.cwd(), "supabase/migrations");
    const newest = readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .map((name) => readFileSync(join(dir, name), "utf8"))
      .filter((text) => text.includes("FUNCTION commerce.platform_incidents_move()"))
      .at(-1);
    expect(newest).toBeDefined();
    const inTrigger = [...newest!.matchAll(/'([a-z_]+>[a-z_]+)'/g)].map((m) => m[1]).sort();
    const inCode = Object.entries(INCIDENT_MOVES)
      .flatMap(([from, tos]) => tos.map((to) => `${from}>${to}`))
      .sort();
    expect(inTrigger).toEqual(inCode);
  });

  it("only name statuses the log has, and every status can be left", () => {
    for (const status of INCIDENT_STATUSES) {
      expect(INCIDENT_MOVES[status].length, status).toBeGreaterThan(0);
      for (const to of INCIDENT_MOVES[status]) expect(INCIDENT_STATUSES).toContain(to);
    }
  });

  it("never let a proposal be built before the owner approves it", () => {
    for (const to of ["claimed", "fixed", "done", "needs_owner"] as const) expect(canMove("enhancement", "proposed", to)).toBe(false);
    expect(canMove("enhancement", "proposed", "approved")).toBe(true);
  });

  it("give each kind only its own statuses", () => {
    expect(statusFitsKind("enhancement", "open")).toBe(false);
    expect(statusFitsKind("error", "proposed")).toBe(false);
    expect(canMove("error", "claimed", "approved")).toBe(false);
    expect(canMove("enhancement", "claimed", "open")).toBe(false);
    expect(workableStatus("warning")).toBe("open");
    expect(workableStatus("enhancement")).toBe("approved");
  });
});

describe("a new entry and a repeat", () => {
  it("start a problem open, a proposal proposed and the owner's own idea approved", () => {
    expect(firstStatus("error", "cron")).toBe("open");
    expect(firstStatus("enhancement", "nightly")).toBe("proposed");
    expect(firstStatus("enhancement", "platform_ai")).toBe("proposed");
    expect(firstStatus("enhancement", "owner")).toBe("approved");
  });

  it("group statuses for the page: what needs the owner, what is worked, what was fixed", () => {
    expect(incidentGroup("proposed")).toBe("needs_you");
    expect(incidentGroup("needs_owner")).toBe("needs_you");
    expect(incidentGroup("claimed")).toBe("being_fixed");
    expect(incidentGroup("done")).toBe("fixed");
    expect(incidentGroup("dismissed")).toBe("closed");
  });
});

describe("fingerprints and titles", () => {
  it("fold case and spaces and skip empty parts, so one problem meets one row", () => {
    expect(fingerprintOf("cron", " Route.Watchdog ", null, "")).toBe("cron:route.watchdog");
    expect(fingerprintOf("a  b")).toBe(fingerprintOf("A B"));
    expect(fingerprintOf("x".repeat(500))).toHaveLength(200);
  });

  it("keep a title to one line and the limit", () => {
    expect(cleanTitle("  A job\nfailed  ")).toBe("A job failed");
    expect(cleanTitle("y".repeat(300))).toHaveLength(200);
  });
});

describe("the daily summary's time", () => {
  it("is due from seven in Oslo, once a day", () => {
    expect(digestDue(null, { date: "2026-11-25", hour: 6 })).toBeNull();
    expect(digestDue(null, { date: "2026-11-25", hour: 7 })).toBe("2026-11-25");
    expect(digestDue("2026-11-24", { date: "2026-11-25", hour: 13 })).toBe("2026-11-25");
    expect(digestDue("2026-11-25", { date: "2026-11-25", hour: 13 })).toBeNull();
  });
});
