import { describe, expect, it } from "vitest";

import { chosenFirst } from "./chip-strip";

describe("chosenFirst (round 17)", () => {
  it("moves the chosen item to the front and keeps the others in order", () => {
    expect(chosenFirst(["a", "b", "c", "d"], (x) => x === "c")).toEqual(["c", "a", "b", "d"]);
    expect(chosenFirst(["a", "b"], () => false)).toEqual(["a", "b"]);
  });
});
