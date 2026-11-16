import { describe, expect, it } from "vitest";

import { readiness, sentences } from "./product-readiness";

describe("a product's readiness to sell (round 1)", () => {
  it("counts sentences of two words or more", () => {
    expect(sentences("Glazed stoneware mug.")).toBe(1);
    expect(sentences("Glazed stoneware mug. Holds 350 ml!")).toBe(2);
    expect(sentences("<p>One thing. Another thing.</p>")).toBe(2);
    expect(sentences("")).toBe(0);
  });

  it("ticks what is there and leaves the rest", () => {
    const list = readiness({ title: "Mug", description: "Glazed mug.", pictures: 1, priced: true, stock: 4, categories: 0 });
    expect(list.filter((c) => c.done).map((c) => c.check)).toEqual(["photo", "namePrice", "stock"]);
    expect(readiness({ title: "Course", description: "", pictures: 0, priced: false, stock: null, categories: 1 }).find((c) => c.check === "stock")?.done).toBe(true);
  });
});
