import { describe, expect, it } from "vitest";

import { BACKGROUND_IDS, DELAY_MAX, ENTER_IDS, HOVER_IDS, SCROLL_IDS, STAGGER_MAX } from "./motion";
import { newPageContent, pageColumnSchema, pageInput, pageRowSchema, type PageContent } from "./page-content";

/** What the page save accepts of motion (D128): names from the lists and small numbers, nothing else. */
const heading = { id: "b1", type: "heading", text: "Hello", level: 2 };
const column = (extra: Record<string, unknown> = {}) => ({ id: "c1", blocks: [heading], ...extra });
const row = (extra: Record<string, unknown> = {}) => ({
  id: "r1",
  type: "row",
  layout: "1",
  columns: [column()],
  ...extra,
});
const page = (rows: unknown[]) =>
  ({ ...newPageContent(), title: "Motion", slug: "motion", rows }) as unknown as PageContent;
const parsed = (rows: unknown[]) => pageInput.safeParse(page(rows));
const gradient = (extra: Record<string, unknown> = {}) => ({
  type: "gradient",
  style: "aurora",
  colors: ["#112233", "#445566"],
  ...extra,
});

describe("motion in a saved page", () => {
  it("keeps every entrance, hover, scroll and background effect in the lists", () => {
    for (const effect of ENTER_IDS)
      expect(pageRowSchema.safeParse(row({ motion: { enter: { effect } } })).success, effect).toBe(true);
    for (const effect of HOVER_IDS)
      expect(pageRowSchema.safeParse(row({ motion: { hover: { effect } } })).success, effect).toBe(true);
    for (const effect of SCROLL_IDS)
      expect(pageRowSchema.safeParse(row({ motion: { scroll: { effect } } })).success, effect).toBe(true);
    for (const effect of BACKGROUND_IDS) {
      expect(pageRowSchema.safeParse(row({ backgroundMotion: { effect } })).success, effect).toBe(true);
      expect(
        pageColumnSchema.safeParse(column({ backgroundMotion: { effect, intensity: "strong" } })).success,
        effect,
      ).toBe(true);
    }
  });

  it("round-trips a row, a column and a block with motion through the page", () => {
    const motion = {
      enter: {
        effect: "fade-up",
        speed: "slow",
        ease: "bounce",
        distance: "large",
        delay: 300,
        trigger: "view",
        start: "late",
        once: false,
        stagger: 90,
      },
      hover: { effect: "lift", intensity: "strong" },
      scroll: { effect: "parallax", intensity: "subtle" },
    };
    const rows = [
      row({
        motion,
        backgroundMotion: { effect: "ken-burns", intensity: "subtle" },
        columns: [column({ motion, backgroundMotion: { effect: "drift" }, blocks: [{ ...heading, motion }] })],
      }),
    ];
    const result = parsed(rows);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const [out] = result.data.rows;
    expect(out.motion).toEqual(motion);
    expect(out.backgroundMotion).toEqual({ effect: "ken-burns", intensity: "subtle" });
    expect(out.columns[0].motion).toEqual(motion);
    expect(out.columns[0].backgroundMotion).toEqual({ effect: "drift" });
    expect(out.columns[0].blocks[0].motion).toEqual(motion);
  });

  it("leaves an empty motion out", () => {
    const result = parsed([row({ motion: {} })]);
    expect(result.success && result.data.rows[0].motion).toBeUndefined();
  });

  it("refuses an effect that is not in a list", () => {
    expect(pageRowSchema.safeParse(row({ motion: { enter: { effect: "explode" } } })).success).toBe(false);
    expect(pageRowSchema.safeParse(row({ motion: { hover: { effect: "fade" } } })).success).toBe(false);
    expect(pageRowSchema.safeParse(row({ motion: { scroll: { effect: "lift" } } })).success).toBe(false);
    expect(pageRowSchema.safeParse(row({ backgroundMotion: { effect: "words" } })).success).toBe(false);
    expect(pageRowSchema.safeParse(row({ motion: { enter: { effect: "fade", speed: "warp" } } })).success).toBe(false);
    expect(pageRowSchema.safeParse(row({ motion: { enter: { effect: "fade", ease: "url(x)" } } })).success).toBe(false);
    expect(pageRowSchema.safeParse(row({ motion: { enter: { effect: "fade", trigger: "click" } } })).success).toBe(
      false,
    );
    expect(pageRowSchema.safeParse(row({ motion: { hover: { effect: "lift", intensity: "extreme" } } })).success).toBe(
      false,
    );
  });

  it("refuses a delay or a stagger out of range, and keeps the edges", () => {
    for (const bad of [-1, DELAY_MAX + 1, 1.5, Number.NaN]) {
      expect(
        pageRowSchema.safeParse(row({ motion: { enter: { effect: "fade", delay: bad } } })).success,
        `delay ${bad}`,
      ).toBe(false);
    }
    for (const bad of [-1, STAGGER_MAX + 1, 0.5]) {
      expect(
        pageRowSchema.safeParse(row({ motion: { enter: { effect: "fade", stagger: bad } } })).success,
        `stagger ${bad}`,
      ).toBe(false);
    }
    expect(
      pageRowSchema.safeParse(row({ motion: { enter: { effect: "fade", delay: DELAY_MAX, stagger: STAGGER_MAX } } }))
        .success,
    ).toBe(true);
    expect(pageRowSchema.safeParse(row({ motion: { enter: { effect: "fade", delay: 0, stagger: 0 } } })).success).toBe(
      true,
    );
  });

  it("strips fields it does not know, as the rest of the page does, so no CSS or code rides along", () => {
    const result = pageRowSchema.safeParse(
      row({
        motion: { enter: { effect: "fade", css: "x{}", onclick: "alert(1)" }, script: "alert(1)" },
        backgroundMotion: { effect: "drift", style: "x" },
      }),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.motion).toEqual({ enter: { effect: "fade" } });
    expect(result.data.backgroundMotion).toEqual({ effect: "drift" });
  });
});

describe("a gradient background in a saved page", () => {
  it("is accepted on rows and columns, with every style and flow", () => {
    for (const style of ["shift", "aurora", "mesh", "conic"]) {
      for (const flow of ["still", "slow", "medium", "fast"]) {
        expect(
          pageRowSchema.safeParse(row({ background: gradient({ style, flow }) })).success,
          `${style} ${flow}`,
        ).toBe(true);
      }
    }
    expect(pageColumnSchema.safeParse(column({ background: gradient({ angle: 45, grain: true }) })).success).toBe(true);
    const result = pageRowSchema.safeParse(
      row({
        background: gradient({
          style: "shift",
          angle: 200,
          flow: "fast",
          grain: true,
          colors: ["#000000", "#ffffff", "#ff0000", "#00ff00"],
        }),
      }),
    );
    expect(result.success && result.data.background).toEqual({
      type: "gradient",
      style: "shift",
      angle: 200,
      flow: "fast",
      grain: true,
      colors: ["#000000", "#ffffff", "#ff0000", "#00ff00"],
    });
  });

  it("needs two to four colours, each written as #rrggbb", () => {
    expect(pageRowSchema.safeParse(row({ background: gradient({ colors: ["#112233"] }) })).success).toBe(false);
    expect(pageRowSchema.safeParse(row({ background: gradient({ colors: [] }) })).success).toBe(false);
    expect(
      pageRowSchema.safeParse(
        row({ background: gradient({ colors: ["#000000", "#111111", "#222222", "#333333", "#444444"] }) }),
      ).success,
    ).toBe(false);
    expect(pageRowSchema.safeParse(row({ background: gradient({ colors: ["#112233", "red"] }) })).success).toBe(false);
    expect(pageRowSchema.safeParse(row({ background: gradient({ colors: ["#112233", "url(x)"] }) })).success).toBe(
      false,
    );
  });

  it("refuses an unknown style or flow and an angle outside a turn", () => {
    expect(pageRowSchema.safeParse(row({ background: gradient({ style: "plasma" }) })).success).toBe(false);
    expect(pageRowSchema.safeParse(row({ background: gradient({ flow: "warp" }) })).success).toBe(false);
    expect(pageRowSchema.safeParse(row({ background: gradient({ angle: -1 }) })).success).toBe(false);
    expect(pageRowSchema.safeParse(row({ background: gradient({ angle: 361 }) })).success).toBe(false);
    expect(pageRowSchema.safeParse(row({ background: gradient({ angle: 10.5 }) })).success).toBe(false);
  });

  it("still leaves a video to rows only", () => {
    const video = { type: "video", video: { url: "https://cdn.example/a.mp4" }, poster: null, overlay: null };
    expect(pageRowSchema.safeParse(row({ background: video })).success).toBe(true);
    expect(pageColumnSchema.safeParse(column({ background: video })).success).toBe(false);
  });
});
