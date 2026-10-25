import { describe, expect, it } from "vitest";

import { codeFindings, FINDINGS_MAX, lookFine, lookTokenValid, readLookAnswer, signLook, type ShotFacts } from "./page-look";

const secret = Buffer.from("a secret only the server knows, 32+");
const page = "11111111-1111-4111-8111-111111111111";
const facts = (over: Partial<ShotFacts> = {}): ShotFacts => ({ sideways: false, brokenPictures: 0, words: 120, actionInFirstScreen: true, ...over });

describe("the look's address", () => {
  it("opens the page it was made for, and only for ten minutes", () => {
    const now = Date.UTC(2026, 9, 25, 12);
    const token = signLook(secret, page, now);
    expect(lookTokenValid(secret, page, token, now + 60_000)).toBe(true);
    expect(lookTokenValid(secret, "22222222-2222-4222-8222-222222222222", token, now)).toBe(false);
    expect(lookTokenValid(secret, page, token, now + 11 * 60_000)).toBe(false);
    expect(lookTokenValid(Buffer.from("another server's secret, 32 chars"), page, token, now)).toBe(false);
    expect(lookTokenValid(secret, page, undefined, now)).toBe(false);
    // An expiry pushed far ahead is refused even with a signature of its own making.
    expect(lookTokenValid(secret, page, `${now + 999 * 60_000}.x`, now)).toBe(false);
  });
});

describe("the model's answer", () => {
  it("keeps only the list's checks, in plain short words, and knows where and how bad", () => {
    const answer = JSON.stringify({
      findings: [
        { check: "overlap", where: "phone", place: "the <b>top</b> banner", severity: "blocking", says: "The heading lies over the <script>picture</script>." },
        { check: "make_it_blue", where: "computer", says: "Use blue." },
        { check: "unreadable", where: "tablet", severity: "huge", says: "x".repeat(400) },
        { check: "cut_off", where: "computer", says: "   " },
      ],
    });
    const read = readLookAnswer("```json\n" + answer + "\n```");
    expect(read).toEqual([
      { check: "overlap", where: "phone", place: "the top banner", severity: "blocking", says: "The heading lies over the picture.", by: "model" },
      { check: "unreadable", where: "page", place: null, severity: "minor", says: "x".repeat(200), by: "model" },
    ]);
  });

  it("reads no findings as nothing wrong, keeps at most twelve, and says when it cannot read the answer", () => {
    expect(readLookAnswer('{"findings": []}')).toEqual([]);
    const many = { findings: Array.from({ length: 20 }, () => ({ check: "empty_space", says: "A gap." })) };
    expect(readLookAnswer(JSON.stringify(many))).toHaveLength(FINDINGS_MAX);
    expect(readLookAnswer("Looks great to me!")).toBeNull();
    expect(readLookAnswer('{"findings": "none"}')).toBeNull();
  });
});

describe("code's own findings", () => {
  it("names sideways scrolling on a phone, broken pictures, no words and no button in the first screen", () => {
    expect(codeFindings({ phone: facts(), computer: facts() })).toEqual([]);
    const found = codeFindings({ phone: facts({ sideways: true, brokenPictures: 2, actionInFirstScreen: false }), computer: facts({ sideways: true, actionInFirstScreen: false }) }, "the home page");
    expect(found.map((f) => [f.check, f.where, f.severity])).toEqual([
      ["sideways_scroll", "phone", "blocking"],
      ["broken_picture", "phone", "blocking"],
      ["no_action_first_screen", "page", "minor"],
    ]);
    expect(found[1]).toMatchObject({ says: "2 pictures did not load.", place: "the home page", by: "code" });
    expect(codeFindings({ phone: facts({ words: 0 }), computer: facts({ words: 0 }) }).map((f) => f.check)).toEqual(["no_words"]);
  });

  it("calls a look fine when nothing blocks", () => {
    expect(lookFine([])).toBe(true);
    expect(lookFine(codeFindings({ phone: facts({ actionInFirstScreen: false }), computer: facts({ actionInFirstScreen: false }) }))).toBe(true);
    expect(lookFine(codeFindings({ phone: facts({ sideways: true }) }))).toBe(false);
  });
});
