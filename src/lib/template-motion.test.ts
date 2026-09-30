import { describe, expect, it } from "vitest";

import { pageRowSchema, type PageRow } from "./page-content";
import { copyRow } from "./page-rows";
import { mapTemplateMedia, sanitizeTemplate, templateMediaUrls, type ForeignStore } from "./template-content";

/**
 * Motion (D128) in templates: an effect is only names and numbers, and a gradient holds no file, so both go from one store
 * to another exactly as they are; a picture behind a moving background is still copied, and takes its motion with it.
 */
const PUBLIC = "https://project.supabase.co/storage/v1/object/public";
const from: ForeignStore = { id: "11111111-1111-4111-8111-111111111111", slug: "other-shop", hosts: [] };
const motion = {
  enter: { effect: "fade-up", speed: "slow", delay: 200, stagger: 80, once: false },
  hover: { effect: "lift", intensity: "strong" },
  scroll: { effect: "parallax" },
} as const;
const gradient = {
  type: "gradient",
  style: "aurora",
  colors: ["#112233", "#445566", "#778899"],
  flow: "slow",
  grain: true,
} as const;
const picture = { url: `${PUBLIC}/product-media/${from.id}/bg.webp`, width: 1600, height: 900, alt: "" };

const row = (extra: Record<string, unknown> = {}): PageRow =>
  ({
    id: "r1",
    type: "row",
    layout: "2",
    motion,
    background: gradient,
    backgroundMotion: { effect: "drift", intensity: "subtle" },
    columns: [
      {
        id: "c1",
        motion,
        background: { ...gradient, style: "conic" },
        backgroundMotion: { effect: "ken-burns" },
        blocks: [{ id: "b1", type: "heading", text: "Hi", level: 2, motion }],
      },
      { id: "c2", blocks: [] },
    ],
    ...extra,
  }) as unknown as PageRow;

describe("a gradient background in a template", () => {
  it("holds no media, so nothing is asked of the resolver and it is left as it is", () => {
    expect(templateMediaUrls("row", row())).toEqual([]);
    const asked: string[] = [];
    const mapped = mapTemplateMedia("row", row(), (url) => (asked.push(url), null)) as PageRow;
    expect(asked).toEqual([]);
    expect(mapped.background).toEqual(gradient);
    expect(mapped.columns[0].background).toEqual({ ...gradient, style: "conic" });
    expect(mapped.backgroundMotion).toEqual({ effect: "drift", intensity: "subtle" });
    expect(mapped.columns[0].backgroundMotion).toEqual({ effect: "ken-burns" });
  });

  it("keeps the motion of rows, columns and blocks when copied for another store", () => {
    const clean = sanitizeTemplate("row", row(), from) as PageRow;
    expect(clean.motion).toEqual(motion);
    expect(clean.columns[0].motion).toEqual(motion);
    expect(clean.columns[0].blocks[0].motion).toEqual(motion);
    expect(clean.background).toEqual(gradient);
    expect(clean.backgroundMotion).toEqual({ effect: "drift", intensity: "subtle" });
    expect(pageRowSchema.safeParse(clean).error?.issues).toBeUndefined();
  });

  it("does the same in a whole page layout and for a column or a block", () => {
    const layout = sanitizeTemplate("page", { pageType: "page", rows: [row()], css: "" }, from) as { rows: PageRow[] };
    expect(layout.rows[0].motion).toEqual(motion);
    expect(layout.rows[0].background).toEqual(gradient);
    const column = sanitizeTemplate("column", row().columns[0], from) as PageRow["columns"][number];
    expect(column.backgroundMotion).toEqual({ effect: "ken-burns" });
    expect(column.motion).toEqual(motion);
    const block = sanitizeTemplate("block", row().columns[0].blocks[0], from) as { motion: unknown };
    expect(block.motion).toEqual(motion);
  });
});

describe("a picture behind a moving background in a template", () => {
  const withPicture = () =>
    row({ background: { type: "image", image: picture, overlay: null }, backgroundMotion: { effect: "parallax" } });

  it("is copied like any other, and keeps its motion", () => {
    expect(templateMediaUrls("row", withPicture())).toEqual([picture.url]);
    const mapped = mapTemplateMedia("row", withPicture(), (url) => url.replace(from.id ?? "", "new-store")) as PageRow;
    expect(mapped.background).toMatchObject({ type: "image", image: { url: expect.stringContaining("new-store") } });
    expect(mapped.backgroundMotion).toEqual({ effect: "parallax" });
  });

  it("takes the background's motion with it when the picture could not be copied", () => {
    const mapped = mapTemplateMedia("row", withPicture(), () => null) as PageRow;
    expect(mapped.background).toBeUndefined();
    expect(mapped.backgroundMotion).toBeUndefined();
    // The part's own effects are not about the picture.
    expect(mapped.motion).toEqual(motion);
    expect(pageRowSchema.safeParse(mapped).error?.issues).toBeUndefined();
  });
});

describe("copying a row with motion", () => {
  it("keeps every effect and background, and the copies do not share them", () => {
    let n = 0;
    const original = row();
    const copy = copyRow(original, () => `n${++n}`);
    expect(copy.id).not.toBe(original.id);
    expect(copy.motion).toEqual(original.motion);
    expect(copy.background).toEqual(original.background);
    expect(copy.backgroundMotion).toEqual(original.backgroundMotion);
    expect(copy.columns[0].motion).toEqual(motion);
    expect(copy.columns[0].blocks[0].motion).toEqual(motion);
    expect(copy.motion).not.toBe(original.motion);
  });
});
