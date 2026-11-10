import { describe, expect, it } from "vitest";

import {
  ANIMATION_CHOOSE_MAX_BYTES,
  ANIMATION_SECONDS_MAX,
  ANIMATION_STILL_MAX,
  PLAYER_FRAGMENT_SHADER,
  STACKED_BLOCKS_MAX,
  animationPlays,
  animationSeenKey,
  animationSeenScript,
  refusalBeforeOpening,
  refusalOnceOpened,
  stackedPictureSize,
  stillSize,
} from "./animation";

const blocks = (size: { width: number; height: number }) => Math.ceil(size.width / 16) * Math.ceil((size.height * 2) / 16);

describe("an animation's sizes", () => {
  it("keeps the picture and its mask inside what every phone decodes, in the source's shape, with even sides", () => {
    for (const [w, h] of [[1920, 1080], [3840, 2160], [1080, 1920], [1500, 1500], [2000, 400], [1366, 768]] as const) {
      const size = stackedPictureSize(w, h)!;
      expect(blocks(size), `${w} × ${h}`).toBeLessThanOrEqual(STACKED_BLOCKS_MAX);
      expect(size.width % 2).toBe(0);
      expect(size.height % 2).toBe(0);
      expect(Math.abs(size.width / size.height - w / h), `${w} × ${h}`).toBeLessThan(0.01);
      expect(size.width).toBeLessThanOrEqual(w);
    }
    expect(stackedPictureSize(1920, 1080)).toEqual({ width: 1394, height: 784 });
  });

  it("never enlarges a small source, and uses nearly all the room a large one has", () => {
    expect(stackedPictureSize(640, 360)).toEqual({ width: 640, height: 360 });
    expect(stackedPictureSize(200, 100)).toEqual({ width: 200, height: 100 });
    expect(blocks(stackedPictureSize(1920, 1080)!)).toBeGreaterThan(STACKED_BLOCKS_MAX * 0.9);
  });

  it("keeps the still at the source's size up to what a page's pictures are kept at", () => {
    expect(stillSize(1600, 900)).toEqual({ width: 1600, height: 900 });
    expect(stillSize(1920, 1080)).toEqual({ width: ANIMATION_STILL_MAX, height: 900 });
    expect(stillSize(3840, 2160)).toEqual({ width: ANIMATION_STILL_MAX, height: 900 });
    expect(stillSize(1080, 2400)).toEqual({ width: 720, height: ANIMATION_STILL_MAX });
    expect(stillSize(640, 360)).toEqual({ width: 640, height: 360 });
  });

  it("has no size for a source too small to be a picture", () => {
    expect(stackedPictureSize(8, 600)).toBeNull();
    expect(stillSize(600, 0)).toBeNull();
    expect(stackedPictureSize(Number.NaN, 600)).toBeNull();
  });
});

describe("what can be an animation", () => {
  it("is a WebM of a size that can be chosen", () => {
    expect(refusalBeforeOpening({ type: "video/webm", size: 3_000_000 })).toBeNull();
    expect(refusalBeforeOpening({ type: "video/mp4", size: 3_000_000 })).toBe("type");
    expect(refusalBeforeOpening({ type: "image/gif", size: 3_000_000 })).toBe("type");
    expect(refusalBeforeOpening({ type: "video/webm", size: 0 })).toBe("size");
    expect(refusalBeforeOpening({ type: "video/webm", size: ANIMATION_CHOOSE_MAX_BYTES + 1 })).toBe("size");
  });

  it("has a see-through background, is short, and is large enough to see", () => {
    const track = { width: 1920, height: 1080, seconds: 6, transparent: true };
    expect(refusalOnceOpened(track)).toBeNull();
    expect(refusalOnceOpened({ ...track, transparent: false })).toBe("opaque");
    expect(refusalOnceOpened({ ...track, seconds: ANIMATION_SECONDS_MAX + 0.1 })).toBe("long");
    expect(refusalOnceOpened({ ...track, seconds: 0 })).toBe("long");
    expect(refusalOnceOpened({ ...track, width: 8 })).toBe("small");
  });
});

describe("the site's player", () => {
  it("shows the still at once to a visitor who prefers less motion or whose browser cannot draw it", () => {
    expect(animationPlays({ reducedMotion: false, canDraw: true })).toBe(true);
    expect(animationPlays({ reducedMotion: true, canDraw: true })).toBe(false);
    expect(animationPlays({ reducedMotion: false, canDraw: false })).toBe(false);
  });

  it("reads the mask from the bottom half and the picture from the top, never brighter than the mask allows", () => {
    // A texture's y runs upwards: 0 to 0.5 is the bottom half of the video, the mask.
    expect(PLAYER_FRAGMENT_SHADER).toContain("float a = texture2D(v, vec2(uv.x, y)).g");
    expect(PLAYER_FRAGMENT_SHADER).toContain("texture2D(v, vec2(uv.x, y + 0.5)).rgb");
    expect(PLAYER_FRAGMENT_SHADER).toContain("min(c, vec3(a))");
    // A decoded video's black and white are near, not exact: the mask's ends count as clear and as solid.
    expect(PLAYER_FRAGMENT_SHADER).toContain("a = clamp((a - 0.02) / 0.96, 0.0, 1.0)");
  });
});

describe("an animation that plays once a visit", () => {
  /** The script as a page runs it: `seen` is what the tab's storage holds, and the element before the script is the animation. */
  const run = (name: string, storage: Record<string, string> | "off") => {
    const marks: string[] = [];
    const before = { setAttribute: (attribute: string) => marks.push(attribute) };
    const sessionStorage = {
      getItem: (key: string) => {
        if (storage === "off") throw new Error("storage is switched off");
        return storage[key] ?? null;
      },
    };
    new Function("sessionStorage", "document", animationSeenScript(name))(sessionStorage, { currentScript: { previousElementSibling: before } });
    return marks;
  };

  it("is marked as seen before the page is drawn, in a tab that has played it, and only there", () => {
    expect(run("logo:shop", { [animationSeenKey("logo:shop")]: "1" })).toEqual(["data-kz-seen"]);
    expect(run("logo:shop", {})).toEqual([]);
    // Another site's logo in the same tab is another animation.
    expect(run("logo:shop", { [animationSeenKey("logo:other")]: "1" })).toEqual([]);
  });

  it("leaves the player to find out where storage is switched off, and never breaks the page", () => {
    expect(run("logo:shop", "off")).toEqual([]);
  });

  it("carries its name as data, never as code", () => {
    const script = animationSeenScript('x");alert(1);("</script><script>alert(2)');
    expect(script).not.toContain("</script>");
    expect(script).toContain("\\u003c/script>");
    expect(run('x");alert(1);("</script>', {})).toEqual([]);
  });
});
