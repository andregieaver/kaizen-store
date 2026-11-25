import { describe, expect, it } from "vitest";

import { claimBody, fixedBody, incidentRouteOf, ingestBody, proposeBody } from "./incident-api";

/** The incident log's API (D895): its routes and the bodies it takes, pure. */
const ID = "1a2b3c4d-1a2b-4c3d-8e9f-1a2b3c4d5e6f";
const SESSION = "https://claude.ai/code/session_01ABCDEFGHIJ";

describe("the routes", () => {
  it("reads the board, due and an entry, and nothing else by GET", () => {
    expect(incidentRouteOf("GET", [])).toEqual({ method: "GET", name: "board" });
    expect(incidentRouteOf("GET", ["due"])).toEqual({ method: "GET", name: "due" });
    expect(incidentRouteOf("GET", [ID])).toEqual({ method: "GET", name: "entry", id: ID });
    expect(incidentRouteOf("GET", [ID, "claim"])).toBeNull();
    expect(incidentRouteOf("GET", ["not-an-id"])).toBeNull();
  });

  it("writes only the log's own actions by POST", () => {
    expect(incidentRouteOf("POST", ["ingest"])).toEqual({ method: "POST", name: "ingest" });
    expect(incidentRouteOf("POST", ["propose"])).toEqual({ method: "POST", name: "propose" });
    expect(incidentRouteOf("POST", ["runs"])).toEqual({ method: "POST", name: "run_start" });
    expect(incidentRouteOf("POST", ["runs", ID, "finish"])).toEqual({ method: "POST", name: "run_finish", id: ID });
    expect(incidentRouteOf("POST", [ID, "needs-owner"])).toEqual({ method: "POST", name: "needs_owner", id: ID });
    expect(incidentRouteOf("POST", [ID, "give-back"])).toEqual({ method: "POST", name: "give_back", id: ID });
    expect(incidentRouteOf("POST", [ID, "approve"])).toBeNull();
    expect(incidentRouteOf("POST", [ID, "constructor"])).toBeNull();
    expect(incidentRouteOf("DELETE", [ID])).toBeNull();
  });
});

describe("the bodies", () => {
  it("take a session only as its own claude.ai link", () => {
    expect(claimBody.safeParse({ session: SESSION }).success).toBe(true);
    expect(claimBody.safeParse({ session: "https://evil.example/code/session_01ABCDEFGHIJ" }).success).toBe(false);
  });

  it("ask a fix for its commit and a note", () => {
    expect(fixedBody.safeParse({ session: SESSION, commit: "abc1234", note: "Guarded it" }).success).toBe(true);
    expect(fixedBody.safeParse({ session: SESSION, commit: "main", note: "Guarded it" }).success).toBe(false);
    expect(fixedBody.safeParse({ session: SESSION, commit: "abc1234", note: "" }).success).toBe(false);
  });

  it("let the session ingest only what it pulls, never a proposal or the app's own sources", () => {
    const entry = { kind: "error", source: "runtime", fingerprint: "runtime:/cart:TypeError", title: "TypeError on /cart" };
    expect(ingestBody.safeParse({ entries: [entry] }).success).toBe(true);
    expect(ingestBody.safeParse({ entries: [{ ...entry, kind: "enhancement" }] }).success).toBe(false);
    expect(ingestBody.safeParse({ entries: [{ ...entry, source: "owner" }] }).success).toBe(false);
    expect(ingestBody.safeParse({ entries: Array.from({ length: 51 }, () => entry) }).success).toBe(false);
  });

  it("ask a proposal for its reason", () => {
    expect(proposeBody.safeParse({ session: SESSION, fingerprint: "menu-cache", title: "Cache the menu", reason: "Read on every page." }).success).toBe(true);
    expect(proposeBody.safeParse({ session: SESSION, fingerprint: "menu-cache", title: "Cache the menu", reason: "" }).success).toBe(false);
  });
});
