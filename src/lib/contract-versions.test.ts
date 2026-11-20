import { describe, expect, it } from "vitest";

import { contractVersions } from "./contract-versions";

describe("a contract's versions", () => {
  it("number each version in its chain and list the chain oldest first", () => {
    const rows = [
      { id: "a", replacesId: null },
      { id: "x", replacesId: null },
      { id: "b", replacesId: "a" },
      { id: "c", replacesId: "b" },
    ];
    const v = contractVersions(rows);
    expect(v.get("a")?.number).toBe(1);
    expect(v.get("c")?.number).toBe(3);
    expect(v.get("b")?.chain.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(v.get("x")).toEqual({ number: 1, chain: [rows[1]] });
  });

  it("start a chain at the first version given when the one before is not among them", () => {
    const v = contractVersions([{ id: "b", replacesId: "gone" }, { id: "c", replacesId: "b" }]);
    expect(v.get("b")?.number).toBe(1);
    expect(v.get("c")?.number).toBe(2);
  });
});
