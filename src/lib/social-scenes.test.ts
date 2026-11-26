import { describe, expect, it } from "vitest";

import { BRIEF_MAX } from "./picture-direction";
import { mayRemakeScene, sceneBrief, sceneShape, SCENE_TRIES_MAX } from "./social-scenes";

describe("a social post's made scene (D870 S2.1)", () => {
  it("asks for a setting around a product's own photo, and a quiet background for a topic, never words or prices in the picture", () => {
    const product = sceneBrief({ kind: "product", title: "Stoneware bowl", idea: "A reel of a bowl taking shape on the wheel." });
    expect(product).toContain('the product "Stoneware bowl"');
    expect(product).toContain("A reel of a bowl taking shape on the wheel.");
    expect(product).toContain("No text, no prices");
    const topic = sceneBrief({ kind: "topic", title: "", idea: "The workshop's Christmas market" });
    expect(topic).toContain("about: The workshop's Christmas market");
    expect(topic).toContain("a quiet area where a headline can sit");
    expect(sceneBrief({ kind: "topic", title: "", idea: "x".repeat(5000) }).length).toBeLessThanOrEqual(BRIEF_MAX);
  });

  it("makes each channel's scene in the nearest shape, and a scene at most three times", () => {
    expect(sceneShape("instagram")).toBe("portrait");
    expect(sceneShape("linkedin")).toBe("square");
    expect(sceneShape("tiktok")).toBe("portrait");
    expect(SCENE_TRIES_MAX).toBe(3);
    expect(mayRemakeScene(2)).toBe(true);
    expect(mayRemakeScene(3)).toBe(false);
  });
});
