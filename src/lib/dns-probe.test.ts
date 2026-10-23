import { describe, expect, it } from "vitest";

import { firstQuestions, mergeFound, secondQuestions, typesFor } from "./dns-probe";

describe("finding a domain's records (D315 5.4)", () => {
  it("asks a CNAME first, and nothing else of a name that has one", () => {
    expect(typesFor("")).toEqual(["A", "AAAA", "MX", "TXT", "CAA"]);
    expect(typesFor("_sip._tls")).toEqual(["SRV"]);
    const names = ["", "www", "mail"];
    const first = firstQuestions(names);
    expect(first.filter((q) => q.name === "www")).toEqual([{ name: "www", type: "CNAME" }]);
    const second = secondQuestions([{ name: "www", type: "CNAME", records: [{ type: "CNAME", name: "www", value: "shop.example.com" }] }, { name: "mail", type: "CNAME", records: [] }], names);
    expect(second.some((q) => q.name === "www")).toBe(false);
    expect(second.filter((q) => q.name === "mail").map((q) => q.type)).toEqual(["A", "AAAA", "MX", "TXT"]);
  });

  it("marks the zone file's records live or not, and adds what asking found that the file lacks", () => {
    const file = [
      { type: "MX" as const, name: "", value: "mx.old.example", mxPriority: 10 },
      { type: "TXT" as const, name: "", value: "v=spf1 include:old.example ~all" },
      { type: "A" as const, name: "legacy", value: "192.0.2.4" },
    ];
    const answers = [
      { name: "", type: "MX", records: [{ type: "MX" as const, name: "", value: "mx.old.example.", mxPriority: 10 }] },
      { name: "", type: "TXT", records: [{ type: "TXT" as const, name: "", value: "google-site-verification=x" }] },
    ];
    const merged = mergeFound(file, answers);
    expect(merged.map((f) => [f.record.type, f.from, f.live])).toEqual([
      ["MX", "file", true],
      ["TXT", "file", false],
      ["A", "file", null],
      ["TXT", "probe", true],
    ]);
  });
});
