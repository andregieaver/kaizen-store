import { describe, expect, it } from "vitest";

import { WORK_ROOT, workBase } from "./work-paths";

describe("Work's addresses (D123)", () => {
  it("builds a store's Work under the owner's", () => {
    expect(WORK_ROOT).toBe("/admin/account/work");
    expect(workBase("kaffe")).toBe("/admin/account/work/s/kaffe");
  });
});
