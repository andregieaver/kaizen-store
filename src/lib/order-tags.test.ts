import { describe, expect, it } from "vitest";

import { TAGS_PER_ORDER, TAG_MAX_LENGTH, normaliseTag, parseTagList, tagChange, tagChangeNote, tagKey, tagsOf, type Tag } from "./order-tags";

const ch = (...codes: number[]) => String.fromCharCode(...codes);
const tag = (label: string): Tag => ({ key: label.toLowerCase(), label });
const ok = (input: string) => {
  const result = normaliseTag(input);
  if (!result.ok) throw new Error(`refused: ${result.problem}`);
  return result.tag;
};

describe("normalising a tag", () => {
  it("trims, collapses whitespace to one space and keeps the first spelling as the label", () => {
    expect(ok("  VIP   customer \n")).toEqual({ key: "vip customer", label: "VIP customer" });
    expect(ok("Late\tdelivery")).toEqual({ key: "late delivery", label: "Late delivery" });
  });

  it("makes the key by lower-casing, so VIP and vip are one tag, and keeps Norwegian, Swedish and Danish letters", () => {
    expect(ok("VIP").key).toBe(ok("vip").key);
    expect(ok("ÆØÅ Bestilling").key).toBe("æøå bestilling");
    expect(ok("Äpple").key).toBe("äpple");
  });

  it("composes Unicode: a letter typed as a base and a combining mark is the same tag as the composed letter", () => {
    const decomposed = ch(0x41, 0x30a); // A + combining ring above
    expect(ok(`${decomposed}lesund`).label).toBe(`${ch(0xc5)}lesund`);
    expect(ok(`${decomposed}lesund`).key).toBe(ok(`${ch(0xc5)}lesund`).key);
  });

  it("accepts 40 code points and refuses 41; an emoji counts as one", () => {
    expect(normaliseTag("a".repeat(TAG_MAX_LENGTH)).ok).toBe(true);
    expect(normaliseTag("a".repeat(TAG_MAX_LENGTH + 1))).toEqual({ ok: false, problem: "too_long" });
    const heart = String.fromCodePoint(0x1f600);
    expect(normaliseTag(heart.repeat(40)).ok).toBe(true);
    expect(normaliseTag(heart.repeat(41))).toEqual({ ok: false, problem: "too_long" });
    // "İ" lower-cases to two code points, so twenty-one of them make a key over the limit that the database would refuse.
    expect(normaliseTag("İ".repeat(20))).toMatchObject({ ok: true });
    expect(normaliseTag("İ".repeat(21))).toEqual({ ok: false, problem: "too_long" });
  });

  it("refuses nothing left, a comma and control characters", () => {
    expect(normaliseTag("")).toEqual({ ok: false, problem: "empty" });
    expect(normaliseTag("   \n\t ")).toEqual({ ok: false, problem: "empty" });
    expect(normaliseTag(null)).toEqual({ ok: false, problem: "empty" });
    expect(normaliseTag("a,b")).toEqual({ ok: false, problem: "invalid_chars" });
    expect(normaliseTag(`a${ch(0)}b`)).toEqual({ ok: false, problem: "invalid_chars" });
    expect(normaliseTag(`a${ch(0x7f)}b`)).toEqual({ ok: false, problem: "invalid_chars" });
    expect(normaliseTag(`a${ch(0x85)}b`)).toEqual({ ok: false, problem: "invalid_chars" });
  });

  it("refuses the bidirectional controls and the zero-width characters that disguise text, wherever they are", () => {
    for (const code of [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x200b, 0x200c, 0x200d]) {
      expect(normaliseTag(`vi${ch(code)}p`), code.toString(16)).toEqual({ ok: false, problem: "invalid_chars" });
      expect(normaliseTag(`${ch(code)}vip`), code.toString(16)).toEqual({ ok: false, problem: "invalid_chars" });
    }
  });

  it("treats the byte order mark as the whitespace JavaScript says it is: a space in the middle, nothing at the ends", () => {
    expect(ok(`vi${ch(0xfeff)}p`).label).toBe("vi p");
    expect(ok(`${ch(0xfeff)}vip`).label).toBe("vip");
  });

  it("allows hyphens, underscores, digits and common punctuation", () => {
    for (const t of ["rush-order", "b2b", "vip_2026", "Sale #1", "50% off", "a/b", "né"]) expect(normaliseTag(t).ok, t).toBe(true);
  });

  it("gives the key of a tag as typed, or null when it is not one", () => {
    expect(tagKey(" VIP ")).toBe("vip");
    expect(tagKey("a,b")).toBeNull();
  });
});

describe("a list of tags", () => {
  it("splits typed text on commas, drops empty fragments and duplicates (the first spelling wins) and reports what was refused", () => {
    const parsed = parseTagList("VIP, late, vip, , " + "x".repeat(41) + ", Late");
    expect(parsed.tags.map((t) => t.label)).toEqual(["VIP", "late"]);
    expect(parsed.problems).toEqual([{ input: "x".repeat(41), problem: "too_long" }]);
  });

  it("reads a list of strings without splitting them (an AI tool's arguments)", () => {
    const parsed = tagsOf(["VIP", "a,b", "vip", 3 as unknown as string]);
    expect(parsed.tags.map((t) => t.label)).toEqual(["VIP"]);
    expect(parsed.problems.map((p) => p.problem)).toEqual(["invalid_chars", "empty"]);
  });

  it("is empty for text that is not text", () => {
    expect(parseTagList(undefined)).toEqual({ tags: [], problems: [] });
  });
});

describe("changing the tags of an order", () => {
  it("adds, removes, and keeps the first spelling written on the order", () => {
    const change = tagChange([tag("VIP")], { add: [ok("vip"), ok("Late")], remove: [ok("test")] });
    expect(change.added.map((t) => t.label)).toEqual(["Late"]);
    expect(change.alreadyHad.map((t) => t.label)).toEqual(["VIP"]);
    expect(change.didNotHave.map((t) => t.label)).toEqual(["test"]);
    expect(change.next.map((t) => t.label)).toEqual(["VIP", "Late"]);
    expect(change.changed).toBe(true);
  });

  it("is idempotent: adding what is there and removing what is not change nothing and are not errors", () => {
    const change = tagChange([tag("VIP")], { add: [ok("VIP")], remove: [ok("gone")] });
    expect(change.changed).toBe(false);
    expect(change.refused).toEqual([]);
    expect(change.next).toEqual([tag("VIP")]);
    expect(tagChangeNote(change)).toBe("");
  });

  it("removes before it adds, so asking for both of one tag leaves it on the order", () => {
    const change = tagChange([tag("a")], { add: [ok("a")], remove: [ok("a")] });
    expect(change.removed.map((t) => t.label)).toEqual(["a"]);
    expect(change.added.map((t) => t.label)).toEqual(["a"]);
    expect(change.next.map((t) => t.label)).toEqual(["a"]);
  });

  it("refuses an add beyond 250 for that tag only, and goes on; an add of a tag already there at the limit is not refused", () => {
    const full: Tag[] = Array.from({ length: TAGS_PER_ORDER }, (_, i) => tag(`t${i}`));
    const change = tagChange(full, { add: [ok("t3"), ok("new"), ok("newer")] });
    expect(change.alreadyHad.map((t) => t.label)).toEqual(["t3"]);
    expect(change.refused.map((t) => t.label)).toEqual(["new", "newer"]);
    expect(change.added).toEqual([]);
    expect(change.next).toHaveLength(TAGS_PER_ORDER);
    // A remove in the same change makes room for one add, in the order given.
    const room = tagChange(full, { remove: [ok("t0")], add: [ok("new"), ok("newer")] });
    expect(room.added.map((t) => t.label)).toEqual(["new"]);
    expect(room.refused.map((t) => t.label)).toEqual(["newer"]);
    expect(room.next).toHaveLength(TAGS_PER_ORDER);
  });

  it("collapses a tag asked for twice in one change", () => {
    const change = tagChange([], { add: [ok("vip"), ok("VIP")], remove: [ok("x"), ok("X")] });
    expect(change.added).toHaveLength(1);
    expect(change.didNotHave).toHaveLength(1);
  });

  it("writes the words of the history event: Added: …. Removed: … (the one free-text key the erasure removes)", () => {
    expect(tagChangeNote({ added: [tag("vip"), tag("late")], removed: [tag("test")] })).toBe("Added: vip, late. Removed: test");
    expect(tagChangeNote({ added: [tag("vip")], removed: [] })).toBe("Added: vip");
    expect(tagChangeNote({ added: [], removed: [tag("test")] })).toBe("Removed: test");
  });
});
