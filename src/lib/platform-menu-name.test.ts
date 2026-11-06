import { describe, expect, it } from "vitest";

import { platformMenuName } from "./platform-menu-name";

describe("a platform menu's name for screen readers (D85, D312)", () => {
  it("is the name the platform admin gave it on English pages", () => {
    expect(platformMenuName("Useful links", "en")).toBe("Useful links");
  });

  it("is said in Norwegian on Norwegian pages, plainly Meny for a name without Norwegian", () => {
    expect(platformMenuName("Main menu", "nb")).toBe("Hovedmeny");
    expect(platformMenuName("Footer menu", "nb")).toBe("Bunnmeny");
    expect(platformMenuName("Useful links", "nb")).toBe("Nyttige lenker");
    expect(platformMenuName("Partners", "nb")).toBe("Meny");
    expect(platformMenuName("toString", "nb")).toBe("Meny");
  });
});
