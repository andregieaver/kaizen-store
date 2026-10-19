import { describe, expect, it } from "vitest";

import { LAUNCH_THEMES } from "./launch-themes";
import { MADE_PICTURE_RULES, NO_TEXT, altFromBrief, colourWords, pictureDirection, shapeOf, sitePicturePrompt } from "./picture-direction";
import { THEME_TEMPLATES } from "./theme";

const kinetic = LAUNCH_THEMES.find((theme) => theme.key === "kinetic")!;

describe("a colour in words (D283)", () => {
  it("names greys by lightness and colours by hue, lightness and strength", () => {
    expect(colourWords("#ffffff")).toBe("white");
    expect(colourWords("#f4f4f1")).toBe("off-white");
    expect(colourWords("#808080")).toBe("grey");
    expect(colourWords("#0d0f12")).toBe("near-black");
    expect(colourWords("#d6342a")).toBe("red");
    expect(colourWords("#c8ff2e")).toBe("lime");
    expect(colourWords("#0b2a6b")).toBe("deep blue");
    expect(colourWords("#e07b2a")).toBe("orange");
    expect(colourWords("#8a5a2b")).toBe("brown");
    expect(colourWords("#5a3a1b")).toBe("deep brown");
    expect(colourWords("#cfe3d3")).toMatch(/green$/);
  });

  it("reads only #rrggbb", () => {
    expect(colourWords("red")).toBeNull();
    expect(colourWords("#fff")).toBeNull();
    expect(colourWords("url(x)")).toBeNull();
  });
});

describe("a picture's shape", () => {
  it("is the one nearest its own size, and wide when it has none", () => {
    expect(shapeOf(1600, 1067)).toBe("landscape");
    expect(shapeOf(1024, 1536)).toBe("portrait");
    expect(shapeOf(1000, 1050)).toBe("square");
    expect(shapeOf(0, 0)).toBe("landscape");
  });
});

describe("the site's look for the picture model", () => {
  it("is the theme's photography, its colours as shown and what the site is about", () => {
    const direction = pictureDirection({ look: "Shot on film in soft light.", settings: kinetic.snapshot.theme.settings, about: "Running kit for the hills." })!;
    expect(direction.startsWith("Shot on film in soft light.")).toBe(true);
    expect(direction).toContain("off-white");
    expect(direction).toContain("red accents");
    expect(direction).toContain("The website is about: Running kit for the hills.");
    expect(direction).not.toMatch(/dark, low-key/);
  });

  it("takes a theme that is always dark in its dark colours and mood", () => {
    const dark = { ...kinetic.snapshot.theme.settings, mode: "dark" as const };
    const direction = pictureDirection({ look: null, settings: dark, about: null })!;
    expect(direction).toContain("near-black");
    expect(direction).toContain("lime accents");
    expect(direction).toMatch(/dark, low-key mood/);
  });

  it("is nothing when nothing is known, and keeps long words short", () => {
    expect(pictureDirection({ look: null, settings: null, about: "  " })).toBeNull();
    const long = pictureDirection({ look: null, settings: null, about: "word ".repeat(200) })!;
    expect(long.length).toBeLessThan(340);
    expect(long.endsWith("…")).toBe(true);
    expect(pictureDirection({ look: null, settings: THEME_TEMPLATES.minimal.settings, about: null })).toMatch(/^The website is /);
  });
});

describe("a made picture's prompt", () => {
  it("puts the person's words first, then the look that never adds to what is in it, then the rules", () => {
    const prompt = sitePicturePrompt("  A trail shoe on a rock  ", "Shot on film.");
    expect(prompt.startsWith("A trail shoe on a rock. Make it in the website's look")).toBe(true);
    expect(prompt).toContain("never what is in the picture: Shot on film.");
    expect(prompt.endsWith(MADE_PICTURE_RULES)).toBe(true);
    expect(MADE_PICTURE_RULES).toContain(NO_TEXT);
    expect(MADE_PICTURE_RULES).toMatch(/never a real or famous person/);
  });

  it("is the words and the rules alone without a look, and never longer than the model reads", () => {
    expect(sitePicturePrompt("A red kite!", null)).toBe(`A red kite! ${MADE_PICTURE_RULES}`);
    expect(sitePicturePrompt("x".repeat(5000), "y".repeat(5000)).length).toBe(4000);
  });
});

describe("a made picture's alt text", () => {
  it("is the description's first sentence, without its full stop", () => {
    expect(altFromBrief("A shoe on a rock. Seen from the side.")).toBe("A shoe on a rock");
    expect(altFromBrief("  A kite  ")).toBe("A kite");
    expect(altFromBrief("word ".repeat(100)).length).toBeLessThanOrEqual(301);
  });
});
