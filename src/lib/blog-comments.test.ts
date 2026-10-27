import { describe, expect, it } from "vitest";

import {
  cleanComment,
  COMMENT_BODY_MAX,
  COMMENT_MIN_SECONDS,
  COMMENT_NAME_MAX,
  commentOutcome,
  commentProblems,
  linkCount,
  normalisedBody,
  REFUSED_COMMENT_DAYS,
  spamReasons,
  statusOf,
} from "./blog-comments";
import { RETENTION_SEED } from "./retention";

/** Comments on articles (D341, decision 3): what a visitor wrote is checked, the spam check is code, and the blog's setting decides. */

const person = { name: "Kari", body: "A lovely article, thank you!", website: "", elapsedMs: 40_000, repeated: false };

describe("a comment as typed", () => {
  it("is cleaned: trimmed, the name on one line, blank lines folded, control characters gone", () => {
    expect(cleanComment({ name: "  Kari \n Nordmann ", email: " kari@example.com ", body: "  Hei\r\n\r\n\r\n\r\nPå deg\u0007  " })).toEqual({
      name: "Kari Nordmann",
      email: "kari@example.com",
      body: "Hei\n\nPå deg",
    });
  });

  it("needs a name and words, takes an email only when it is one, and refuses what is too long", () => {
    expect(commentProblems({ name: "", email: "", body: "" })).toEqual({ name: "missing", body: "missing" });
    expect(commentProblems({ name: "Kari", email: "not an email", body: "Hi" })).toEqual({ email: "invalid" });
    expect(commentProblems({ name: "Kari", email: "", body: "Hi" })).toEqual({});
    expect(commentProblems({ name: "x".repeat(COMMENT_NAME_MAX + 1), email: "", body: "y".repeat(COMMENT_BODY_MAX + 1) })).toEqual({ name: "too_long", body: "too_long" });
  });
});

describe("the spam check", () => {
  it("finds nothing in a person's comment", () => {
    expect(spamReasons(person)).toEqual([]);
  });

  it("finds the hidden field, a form sent too fast, many links, a link as the name and the same text again", () => {
    expect(spamReasons({ ...person, website: "http://spam.example" })).toContain("honeypot");
    expect(spamReasons({ ...person, elapsedMs: COMMENT_MIN_SECONDS * 1000 - 1 })).toContain("too_fast");
    expect(spamReasons({ ...person, body: "Buy at https://a.example and www.b.example" })).toContain("links");
    expect(spamReasons({ ...person, body: "See https://a.example" })).toEqual([]);
    expect(spamReasons({ ...person, name: "cheap-pills.com" })).toContain("link_in_name");
    expect(spamReasons({ ...person, repeated: true })).toEqual(["repeated"]);
  });

  it("counts addresses written in many ways", () => {
    expect(linkCount("http://a.example https://b.example/x www.c.example d.ru plain words")).toBe(4);
    expect(linkCount("no links here, just words.")).toBe(0);
  });

  it("finds the same text however it is spaced or cased", () => {
    expect(normalisedBody("Great   POST!!")).toBe(normalisedBody("great post"));
    expect(normalisedBody("Flott innlegg")).not.toBe(normalisedBody("Flott artikkel"));
  });
});

describe("what a comment becomes", () => {
  it("is held for a person by default, shown at once on an automatic blog, refused with comments off", () => {
    expect(commentOutcome("moderated", [])).toEqual({ kind: "kept", status: "pending" });
    expect(commentOutcome("automatic", [])).toEqual({ kind: "kept", status: "approved" });
    expect(commentOutcome("off", [])).toEqual({ kind: "closed" });
  });

  it("keeps a flagged comment as spam (never shown, even on an automatic blog) and drops a robot's", () => {
    expect(commentOutcome("automatic", ["links"])).toEqual({ kind: "kept", status: "spam" });
    expect(commentOutcome("moderated", ["too_fast", "repeated"])).toEqual({ kind: "kept", status: "spam" });
    expect(commentOutcome("automatic", ["honeypot", "links"])).toEqual({ kind: "dropped" });
    expect(commentOutcome("off", ["honeypot"])).toEqual({ kind: "closed" });
  });

  it("maps staff's decisions to statuses", () => {
    expect(statusOf("approve")).toBe("approved");
    expect(statusOf("reject")).toBe("rejected");
    expect(statusOf("spam")).toBe("spam");
  });

  it("keeps a refused comment exactly as long as the retention rule says", () => {
    const rule = RETENTION_SEED.find((r) => r.kind === "blog_comments");
    expect(rule).toMatchObject({ periodValue: REFUSED_COMMENT_DAYS, periodUnit: "days", basis: "policy" });
  });
});
