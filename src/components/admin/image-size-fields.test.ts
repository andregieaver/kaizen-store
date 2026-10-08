import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { BOUND_PICTURE_SIZE, IMAGE_WIDTH_MIN, type ImageBlock, type PageRow, type TextAlignments } from "@/lib/page-content";
import { upgradeBlock } from "@/lib/responsive";
import { patchBlock, type BlockPatch } from "@/lib/page-rows";

import type { Size } from "@/lib/breakpoints";

import { TextAlignFields } from "./block-fields";
import { ImageSizeFields, widthPatch } from "./image-size-fields";
import { SizeEditContext, type SizeEdit } from "./responsive-edit";

/**
 * A picture's Width and Position on its Style tab (D151). The markup is drawn on the server as the other settings are
 * (what a person sees and can use before any script runs). The state flow (the slider, the typed number with its draft,
 * Own size, Position) is driven without a DOM: the hooks are stood in for while the component is called as a function,
 * and the handlers it returns are fired by hand, with the parent's part played by the real `patchBlock()`.
 */

// While `harness.on`, `useState` and `useId` are a plain slot array (so a handler can be fired, the component drawn again and
// what it shows read); otherwise they are React's own, which `renderToString` needs.
const harness = vi.hoisted(() => ({ on: false, slots: [] as unknown[], at: 0, sizeEdit: null as unknown }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useId: () => (harness.on ? "t" : actual.useId()),
    // The builder's screen size (D179): the one a test gives, else the context's default (Extra large).
    useContext: (context: { _currentValue: unknown }) =>
      harness.on ? (harness.sizeEdit ?? context._currentValue) : actual.useContext(context as unknown as Parameters<typeof actual.useContext>[0]),
    useState: (initial: unknown) => {
      if (!harness.on) return actual.useState(initial);
      const slot = harness.at++;
      if (!(slot in harness.slots)) harness.slots[slot] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      const set = (next: unknown) => {
        harness.slots[slot] = typeof next === "function" ? (next as (value: unknown) => unknown)(harness.slots[slot]) : next;
      };
      return [harness.slots[slot], set];
    },
  };
});

const picture = (width: number, height: number) => ({ url: "https://cdn.example/p.webp", width, height, alt: "" });
/** A picture block; a position by screen as saved before D179 is read as the builder gets it (`upgradeBlock()`). */
const image = (over: Omit<Partial<ImageBlock>, "align"> & { align?: ImageBlock["align"] | TextAlignments } = {}): ImageBlock =>
  upgradeBlock({ id: "img", type: "image", image: picture(800, 600), caption: "", ...over }) as ImageBlock;
const fromField = { fieldId: "field-1" };

/** Drawn at a screen size of the builder's (D179), Extra large unless said. */
const html = (block: ImageBlock, size: Size = "xl") =>
  renderToString(
    createElement(SizeEditContext, { value: { size, active: size !== "xl", choose: () => {} } }, createElement(ImageSizeFields, { block, onChange: () => {} })),
  ).replace(/<!-- -->/g, "");

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
const rangeOf = (out: string) => out.match(/<input[^>]*type="range"[^>]*>/)?.[0] ?? "";
const typedOf = (out: string) => out.match(/<input[^>]*type="text"[^>]*>/)?.[0] ?? "";
const resetOf = (out: string) => out.match(/<button[^>]*>Own size<\/button>/)?.[0] ?? "";
const hintOf = (out: string) => out.match(/<p id="([^"]+)"[^>]*>([^<]*)<\/p>/);
/** The Width fieldset's own opening tag (the Position fieldsets come after it). */
const widthFieldsetOf = (out: string) => out.match(/<fieldset([^>]*)>/)?.[1] ?? "";
const isDisabled = (tag: string) => /\sdisabled=""/.test(tag);

describe("widthPatch", () => {
  it("stores nothing at or above the picture's own size, so the key goes", () => {
    expect(widthPatch(800, 800, 16)).toBeUndefined();
    expect(widthPatch(801, 800, 16)).toBeUndefined();
    expect(widthPatch(100_000, 800, 16)).toBeUndefined();
  });

  it("stores the whole width below it", () => {
    expect(widthPatch(300, 800, 16)).toBe(300);
    expect(widthPatch(799, 800, 16)).toBe(799);
    expect(widthPatch(16, 800, 16)).toBe(16);
  });

  it("clamps to the floor from below", () => {
    expect(widthPatch(15, 800, 16)).toBe(16);
    expect(widthPatch(1, 800, 16)).toBe(16);
    expect(widthPatch(0, 800, 16)).toBe(16);
    expect(widthPatch(-40, 800, 16)).toBe(16);
  });

  it("is the own size when the wish is not a number", () => {
    expect(widthPatch(Number.NaN, 800, 16)).toBeUndefined();
    expect(widthPatch(Number.POSITIVE_INFINITY, 800, 16)).toBeUndefined();
    expect(widthPatch(Number.NEGATIVE_INFINITY, 800, 16)).toBeUndefined();
  });

  it("rounds before it compares, so a wish that rounds up to the own size is the own size", () => {
    expect(widthPatch(299.4, 800, 16)).toBe(299);
    expect(widthPatch(299.6, 800, 16)).toBe(300);
    expect(widthPatch(799.4, 800, 16)).toBe(799);
    expect(widthPatch(799.5, 800, 16)).toBeUndefined();
    expect(widthPatch(15.6, 800, 16)).toBe(16);
  });

  it("never stores a size outside the slider's range, for any picture the slider can be used on", () => {
    // A picture of 16 pixels or less is not offered a slider at all, so the floor is always 16 here.
    for (const natural of [IMAGE_WIDTH_MIN + 1, 18, 100, 800, 1600]) {
      let previous = 0;
      for (let px = -5; px <= natural + 5; px += 1) {
        const stored = widthPatch(px, natural, IMAGE_WIDTH_MIN);
        if (stored === undefined) {
          expect(px, `${px} of ${natural}`).toBeGreaterThanOrEqual(natural);
          continue;
        }
        expect(Number.isInteger(stored)).toBe(true);
        expect(stored).toBeGreaterThanOrEqual(IMAGE_WIDTH_MIN);
        expect(stored).toBeLessThan(natural);
        expect(stored).toBeGreaterThanOrEqual(previous);
        previous = stored;
      }
    }
  });
});

describe("a picture's Width", () => {
  it("is one labelled group with a slider from the floor to the picture's own width", () => {
    const out = html(image());
    const group = out.slice(0, out.indexOf("</fieldset>"));
    // Named Width, with its device icon (D179).
    expect(group).toMatch(/<legend[^>]*>Width<span[^]*data-size-switch[^]*<\/legend>/);
    const range = rangeOf(group);
    expect(range).not.toBe("");
    expect(attr(range, "min")).toBe("16");
    expect(attr(range, "max")).toBe("800");
    expect(attr(range, "step")).toBe("1");
    expect(attr(range, "aria-label")).toBe("Width in pixels");
    expect(isDisabled(widthFieldsetOf(out))).toBe(false);
    expect(isDisabled(range)).toBe(false);
  });

  it("sits at the picture's own width when nothing is set", () => {
    const out = html(image());
    expect(attr(rangeOf(out), "value")).toBe("800");
    expect(out).toContain(">800 px</output>");
    expect(attr(typedOf(out), "value")).toBe("800");
    expect(attr(rangeOf(out), "aria-valuetext")).toBe("800 pixels wide");
  });

  it("shows what is set: 300 pixels on the slider, in the readout and in the typed field", () => {
    const out = html(image({ maxWidth: 300 }));
    expect(attr(rangeOf(out), "value")).toBe("300");
    expect(attr(rangeOf(out), "min")).toBe("16");
    expect(attr(rangeOf(out), "max")).toBe("800");
    expect(out).toMatch(/<output[^>]*>300 px<\/output>/);
    expect(out).not.toContain(">800 px<");
    expect(attr(typedOf(out), "value")).toBe("300");
    expect(attr(rangeOf(out), "aria-valuetext")).toBe("300 pixels wide");
    expect(out).toContain("pixels</span>");
  });

  it("reads the readout from the slider it belongs to", () => {
    const out = html(image({ maxWidth: 300 }));
    const readout = out.match(/<output[^>]*>/)?.[0] ?? "";
    expect(attr(rangeOf(out), "id")).toBeTruthy();
    expect(attr(readout, "for")).toBe(attr(rangeOf(out), "id"));
  });

  it("is described by the hint, which states the picture's own size", () => {
    const out = html(image({ maxWidth: 300 }));
    const hint = hintOf(out);
    expect(hint).not.toBeNull();
    const [, hintId, hintText] = hint!;
    expect(attr(rangeOf(out), "aria-describedby")).toBe(hintId);
    expect(attr(typedOf(out), "aria-describedby")).toBe(hintId);
    // The own size, not the size set, and what a picture may and may not do.
    expect(hintText).toContain("Own size: 800 × 600 pixels.");
    expect(hintText).toContain("never shown larger than that");
    expect(hintText).toContain("shrinks to fit");
    expect(out.split(`id="${hintId}"`).length).toBe(2);
  });

  it("gives each instance its own ids", () => {
    const out = renderToString(
      createElement(
        "div",
        null,
        createElement(ImageSizeFields, { block: image(), onChange: () => {} }),
        createElement(ImageSizeFields, { block: image({ id: "other" }), onChange: () => {} }),
      ),
    );
    const hints = [...out.matchAll(/<p id="([^"]+)"/g)].map((m) => m[1]);
    const ranges = [...out.matchAll(/<input id="([^"]+)"[^>]*type="range"/g)].map((m) => m[1]);
    expect(hints).toHaveLength(2);
    expect(new Set(hints).size).toBe(2);
    expect(new Set(ranges).size).toBe(2);
  });

  it("has a button back to the own size, enabled only while a width is set", () => {
    expect(isDisabled(resetOf(html(image())))).toBe(true);
    expect(resetOf(html(image()))).not.toBe("");
    const set = resetOf(html(image({ maxWidth: 300 })));
    expect(set).not.toBe("");
    expect(attr(set, "type")).toBe("button");
    expect(isDisabled(set)).toBe(false);
  });

  it("ignores a stored width above the picture's own size, as when a smaller picture replaces it", () => {
    const out = html(image({ maxWidth: 1000 }));
    expect(attr(rangeOf(out), "value")).toBe("800");
    expect(attr(rangeOf(out), "max")).toBe("800");
    expect(out).toContain(">800 px</output>");
  });

  it("takes a crop's own width as the slider's top: the largest crop inside the picture", () => {
    const circle = html(image({ image: picture(1600, 900), shape: "circle" }));
    expect(attr(rangeOf(circle), "min")).toBe("16");
    expect(attr(rangeOf(circle), "max")).toBe("900");
    expect(attr(rangeOf(circle), "value")).toBe("900");
    expect(circle).toContain(">900 px</output>");
    expect(hintOf(circle)![2]).toContain("Own size with this shape: 900 × 900 pixels.");

    const portrait = html(image({ shape: "portrait" }));
    expect(attr(rangeOf(portrait), "max")).toBe("450");
    expect(hintOf(portrait)![2]).toContain("Own size with this shape: 450 × 600 pixels.");

    const panorama = html(image({ image: picture(1600, 400), shape: "panorama" }));
    expect(attr(rangeOf(panorama), "max")).toBe("1200");
    expect(hintOf(panorama)![2]).toContain("1200 × 400 pixels");

    // A width set on a circle reads against the crop, not the picture.
    const narrow = html(image({ image: picture(1600, 900), shape: "circle", maxWidth: 300 }));
    expect(attr(rangeOf(narrow), "value")).toBe("300");
    expect(attr(rangeOf(narrow), "max")).toBe("900");
    expect(hintOf(narrow)![2]).toContain("900 × 900");
  });

  it("without a picture is a disabled group that says where to add one", () => {
    const out = html(image({ image: null }));
    expect(isDisabled(widthFieldsetOf(out))).toBe(true);
    expect(hintOf(out)![2]).toBe("Add a picture on the General tab to set its width.");
    expect(out).toMatch(/<output[^>]*>—<\/output>/);
    expect(attr(typedOf(out), "value")).toBe("");
    expect(isDisabled(resetOf(out))).toBe(true);
    expect(out).not.toContain("Own size:");
    expect(out).not.toContain("limited to");
  });

  it("for a picture taken from a field uses the stand-in's 1600 and says it is limited", () => {
    expect(BOUND_PICTURE_SIZE.width).toBe(1600);
    const out = html(image({ image: null, bind: fromField }));
    expect(isDisabled(widthFieldsetOf(out))).toBe(false);
    expect(attr(rangeOf(out), "min")).toBe("16");
    expect(attr(rangeOf(out), "max")).toBe("1600");
    expect(attr(rangeOf(out), "value")).toBe("1600");
    expect(out).toContain(">1600 px</output>");
    const hint = hintOf(out)![2];
    expect(hint).toContain("Own size: 1600 × 1200 pixels.");
    expect(hint).toContain("A picture from a field is limited to 1600 pixels wide here.");
    expect(out).not.toContain("Add a picture on the General tab");

    const narrow = html(image({ image: null, bind: fromField, maxWidth: 700 }));
    expect(attr(rangeOf(narrow), "value")).toBe("700");
    expect(narrow).toContain(">700 px</output>");
    expect(isDisabled(resetOf(narrow))).toBe(false);
  });

  it("measures a bound block against the stand-in, even when it keeps a picture of its own for an empty field", () => {
    // The field's picture is what is drawn, and its size is not known here, so the picture the block keeps does not set the limit.
    const out = html(image({ bind: fromField }));
    expect(attr(rangeOf(out), "max")).toBe(String(BOUND_PICTURE_SIZE.width));
    expect(hintOf(out)![2]).toContain("limited to 1600 pixels");
  });

  it("says a tiny picture is too small to make smaller, and offers no width to set", () => {
    const out = html(image({ image: picture(10, 10) }));
    expect(isDisabled(widthFieldsetOf(out))).toBe(true);
    expect(hintOf(out)![2]).toBe("This picture is too small to make smaller.");
    // The slider cannot be dragged past the picture it is on.
    expect(attr(rangeOf(out), "min")).toBe("10");
    expect(attr(rangeOf(out), "max")).toBe("10");
    expect(out).toContain(">10 px</output>");
    expect(out).not.toContain("Own size:");
  });

  it("draws the line between too small and not: 16 pixels cannot shrink, 17 can", () => {
    const sixteen = html(image({ image: picture(16, 12) }));
    expect(isDisabled(widthFieldsetOf(sixteen))).toBe(true);
    expect(hintOf(sixteen)![2]).toContain("too small");

    const seventeen = html(image({ image: picture(17, 12) }));
    expect(isDisabled(widthFieldsetOf(seventeen))).toBe(false);
    expect(attr(rangeOf(seventeen), "min")).toBe("16");
    expect(attr(rangeOf(seventeen), "max")).toBe("17");
    expect(hintOf(seventeen)![2]).not.toContain("too small");
  });

  it("is too small by the crop, not the picture, when a shape is chosen", () => {
    // 100 x 4 is 100 wide as it is, but a square crop of it is 4 wide.
    const out = html(image({ image: picture(100, 4), shape: "square" }));
    expect(isDisabled(widthFieldsetOf(out))).toBe(true);
    expect(hintOf(out)![2]).toContain("too small");
    expect(attr(rangeOf(out), "max")).toBe("4");
  });
});

describe("a picture's Position", () => {
  const group = (out: string, legend: string) =>
    out.split("<fieldset").find((part) => new RegExp(`<legend[^>]*>${legend}`).test(part)) ?? "";
  const chosen = (part: string) => part.match(/<input[^>]*type="radio"[^>]*checked=""[^>]*value="([^"]+)"/)?.[1];

  it("is one group, with its device icon, even when nothing is set", () => {
    const out = html(image());
    const part = group(out, "Position");
    expect(part).not.toBe("");
    expect(part).toContain("data-size-switch");
    expect(chosen(part)).toBe("left");
    expect(out).not.toContain("Position on phones");
    expect(out).toContain("Where the picture sits when it is narrower than its column.");
    expect(out).toContain("A left or right margin set under Spacing takes the place of this");
  });

  it("is drawn without a picture and with a picture too small to shrink", () => {
    for (const block of [image({ image: null }), image({ image: picture(10, 10) }), image({ image: null, bind: fromField })]) {
      expect(group(html(block), "Position")).not.toBe("");
    }
  });

  it("names the places a picture can sit", () => {
    const part = group(html(image()), "Position");
    for (const label of ["Left", "Centre", "Right"]) expect(part, label).toContain(`>${label}</label>`);
  });

  it("shows the place at the size the builder edits (D179), read larger to smaller", () => {
    // Saved before D179: centred on phones, right on computers (a base of right, centre from Medium down).
    const block = image({ align: { mobile: "center", desktop: "right" } });
    expect(chosen(group(html(block), "Position"))).toBe("right");
    expect(chosen(group(html(block, "lg"), "Position"))).toBe("right");
    expect(chosen(group(html(block, "md"), "Position"))).toBe("center");
    expect(chosen(group(html(block, "sm"), "Position"))).toBe("center");
    expect(group(html(block, "lg"), "Position")).toContain("From Extra large");
    expect(group(html(block, "md"), "Position")).toContain("Set for Medium");
    expect(group(html(block, "sm"), "Position")).toContain("From Medium");
  });

  it("does not depend on the width being set", () => {
    const out = html(image({ maxWidth: 300, align: { mobile: "right" } }), "sm");
    expect(chosen(group(out, "Position"))).toBe("right");
    expect(attr(rangeOf(out), "value")).toBe("300");
  });
});

describe("the width controls at work", () => {
  type Props = Record<string, unknown>;
  type Match = (element: ReactElement<Props>) => boolean;

  const search = (node: ReactNode, match: Match): ReactElement<Props> | undefined => {
    if (Array.isArray(node)) {
      for (const child of node) {
        const hit = search(child as ReactNode, match);
        if (hit) return hit;
      }
      return undefined;
    }
    if (!isValidElement(node)) return undefined;
    const element = node as ReactElement<Props>;
    return match(element) ? element : search(element.props.children as ReactNode, match);
  };
  const find = (node: ReactNode, match: Match) => {
    const hit = search(node, match);
    if (!hit) throw new Error("no such element in what the component drew");
    return hit;
  };

  const isRange: Match = (el) => el.type === "input" && el.props.type === "range";
  const isTyped: Match = (el) => el.type === "input" && el.props.type === "text";
  const isReset: Match = (el) => el.type === "button";
  const isPosition: Match = (el) => el.type === TextAlignFields;

  const rowOf = (block: ImageBlock): PageRow => ({ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks: [block] }] });

  /**
   * The component as a builder holds it: it draws the block, and what it reports is applied by the real `patchBlock()` before
   * it draws again, with its own state (the typed draft) kept between draws.
   */
  function mount(start: ImageBlock, size: Size = "xl") {
    let current = start;
    const sizeEdit: SizeEdit | null = size === "xl" ? null : { size, active: true, choose: () => {} };
    const patches: BlockPatch<ImageBlock>[] = [];
    const slots: unknown[] = [];
    const onChange = (patch: BlockPatch<ImageBlock>) => {
      patches.push(patch);
      current = patchBlock<ImageBlock>([rowOf(current)], current.id, patch)[0].columns[0].blocks[0] as ImageBlock;
    };
    const render = () => {
      harness.slots = slots;
      harness.at = 0;
      harness.sizeEdit = sizeEdit;
      harness.on = true;
      try {
        return ImageSizeFields({ block: current, onChange });
      } finally {
        harness.on = false;
      }
    };
    const fire = (match: Match, handler: string, arg?: unknown) => {
      const fn = find(render(), match).props[handler];
      if (typeof fn !== "function") throw new Error(`the element has no ${handler}`);
      fn(arg);
    };
    const prop = (match: Match, name: string) => find(render(), match).props[name];
    return {
      patches,
      get block() {
        return current;
      },
      fire,
      prop,
      slide: (px: number) => fire(isRange, "onChange", { target: { value: String(px) } }),
      type: (text: string) => fire(isTyped, "onChange", { target: { value: text } }),
      blur: () => fire(isTyped, "onBlur"),
      enter: () => {
        const preventDefault = vi.fn();
        fire(isTyped, "onKeyDown", { key: "Enter", preventDefault });
        return preventDefault;
      },
    };
  }

  /** What a patch says about a key: that it is named, and its value; a key left unnamed is not touched by `patchBlock()`. */
  const keysOf = (patch: BlockPatch<ImageBlock>) => Object.keys(patch);

  describe("the slider", () => {
    it("sets a width below the picture's own size", () => {
      const m = mount(image());
      m.slide(300);
      expect(m.patches).toEqual([{ maxWidth: 300 }]);
      expect(m.block.maxWidth).toBe(300);
      expect(m.prop(isRange, "value")).toBe(300);
      expect(m.prop(isTyped, "value")).toBe("300");
      expect(m.prop(isReset, "disabled")).toBe(false);
    });

    it("takes the key away at the picture's own size, never storing the natural width", () => {
      const m = mount(image({ maxWidth: 300 }));
      m.slide(800);
      expect(m.patches).toHaveLength(1);
      // The key is named with no value, which is how `merge()` takes a key out.
      expect(keysOf(m.patches[0])).toEqual(["maxWidth"]);
      expect(m.patches[0].maxWidth).toBeUndefined();
      expect("maxWidth" in m.block).toBe(false);
      expect(m.prop(isRange, "value")).toBe(800);
      expect(m.prop(isReset, "disabled")).toBe(true);
    });

    it("works against a crop's own size", () => {
      const m = mount(image({ shape: "portrait" }));
      m.slide(449);
      expect(m.block.maxWidth).toBe(449);
      m.slide(450);
      expect("maxWidth" in m.block).toBe(false);
    });

    it("keeps the position and the rest of the block", () => {
      const m = mount(image({ align: { mobile: "center" }, caption: "Harbour", shape: "square" }));
      m.slide(300);
      expect(m.block).toMatchObject({ maxWidth: 300, align: "center", caption: "Harbour", shape: "square", type: "image" });
    });

    it("changes nothing without a picture to measure against", () => {
      const m = mount(image({ image: null }));
      m.slide(300);
      expect(m.patches).toEqual([]);
      expect("maxWidth" in m.block).toBe(false);
    });

    it("sets a width on a picture from a field, against the stand-in's 1600", () => {
      const m = mount(image({ image: null, bind: fromField }));
      m.slide(700);
      expect(m.block.maxWidth).toBe(700);
      m.slide(1600);
      expect("maxWidth" in m.block).toBe(false);
    });
  });

  describe("Own size", () => {
    it("takes a set width off the block, for good", () => {
      const m = mount(image({ maxWidth: 300 }));
      expect(m.prop(isReset, "disabled")).toBe(false);
      m.fire(isReset, "onClick");
      expect(m.patches).toHaveLength(1);
      expect(keysOf(m.patches[0])).toEqual(["maxWidth"]);
      expect(m.patches[0].maxWidth).toBeUndefined();
      expect("maxWidth" in m.block).toBe(false);
      // Back at the picture's own width, in the slider, the readout and the typed field.
      expect(m.prop(isRange, "value")).toBe(800);
      expect(m.prop(isTyped, "value")).toBe("800");
      expect(m.prop(isReset, "disabled")).toBe(true);
    });

    it("is a plain button, so it cannot submit a form it sits in", () => {
      expect(mount(image({ maxWidth: 300 })).prop(isReset, "type")).toBe("button");
    });
  });

  describe("the typed width", () => {
    it("keeps what is typed as typed, and writes each number that is a width the picture can have", () => {
      const m = mount(image());
      // 3 is under the floor: it waits, the picture is not shrunk to 16 on the way to 300.
      m.type("3");
      expect(m.prop(isTyped, "value")).toBe("3");
      expect(m.patches).toEqual([]);
      expect(m.prop(isRange, "value")).toBe(800);
      m.type("30");
      expect(m.prop(isTyped, "value")).toBe("30");
      expect(m.patches).toEqual([{ maxWidth: 30 }]);
      m.type("300");
      expect(m.prop(isTyped, "value")).toBe("300");
      expect(m.patches).toEqual([{ maxWidth: 30 }, { maxWidth: 300 }]);
      expect(m.prop(isRange, "value")).toBe(300);
    });

    it("has written a typed width before the field is left, so closing the dialog at once loses nothing, and leaving writes nothing more", () => {
      const m = mount(image());
      m.type("300");
      expect(m.block.maxWidth).toBe(300);
      m.blur();
      expect(m.patches).toEqual([{ maxWidth: 300 }]);
      expect(m.block.maxWidth).toBe(300);
      expect(m.prop(isTyped, "value")).toBe("300");
      expect(m.prop(isRange, "value")).toBe(300);
    });

    it("stops Enter from submitting a form, and writes nothing again", () => {
      const m = mount(image());
      m.type("250");
      const preventDefault = m.enter();
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(m.patches).toEqual([{ maxWidth: 250 }]);
      m.blur();
      expect(m.patches).toHaveLength(1);
    });

    it("ignores other keys", () => {
      const m = mount(image());
      m.type("250");
      const preventDefault = vi.fn();
      m.fire(isTyped, "onKeyDown", { key: "a", preventDefault });
      m.fire(isTyped, "onKeyDown", { key: "Tab", preventDefault });
      expect(preventDefault).not.toHaveBeenCalled();
      expect(m.patches).toEqual([{ maxWidth: 250 }]);
      expect(m.prop(isTyped, "value")).toBe("250");
    });

    it("raises a width below the floor to it", () => {
      const m = mount(image());
      m.type("5");
      m.blur();
      expect(m.patches).toEqual([{ maxWidth: IMAGE_WIDTH_MIN }]);
      expect(m.prop(isTyped, "value")).toBe("16");
    });

    it("is the own size at or above it, with no width kept, and shows the own width again, not what was typed", () => {
      const m = mount(image({ maxWidth: 300 }));
      m.type("9999");
      expect(m.prop(isTyped, "value")).toBe("9999");
      m.blur();
      expect(keysOf(m.patches[0])).toEqual(["maxWidth"]);
      expect(m.patches[0].maxWidth).toBeUndefined();
      expect("maxWidth" in m.block).toBe(false);
      expect(m.prop(isTyped, "value")).toBe("800");

      const exact = mount(image({ maxWidth: 300 }));
      exact.type("800");
      exact.blur();
      expect("maxWidth" in exact.block).toBe(false);
    });

    it("lets only digits through", () => {
      const m = mount(image());
      m.type("3a0-0 px");
      expect(m.prop(isTyped, "value")).toBe("300");
      m.type("abc");
      expect(m.prop(isTyped, "value")).toBe("");
    });

    it("keeps the width it had when the field is emptied and left", () => {
      const m = mount(image({ maxWidth: 300 }));
      m.type("");
      expect(m.prop(isTyped, "value")).toBe("");
      m.blur();
      expect(m.patches).toEqual([]);
      expect(m.block.maxWidth).toBe(300);
      expect(m.prop(isTyped, "value")).toBe("300");
    });

    it("writes nothing when the field is left without a word typed", () => {
      const m = mount(image({ maxWidth: 300 }));
      m.blur();
      m.enter();
      expect(m.patches).toEqual([]);
    });

    it("writes a width for a picture from a field, and nothing without a picture", () => {
      const fromAField = mount(image({ image: null, bind: fromField }));
      fromAField.type("1000");
      fromAField.blur();
      expect(fromAField.block.maxWidth).toBe(1000);

      const none = mount(image({ image: null }));
      none.type("300");
      none.blur();
      expect(none.patches).toEqual([]);
      expect(none.prop(isTyped, "value")).toBe("");
    });
  });

  describe("Position", () => {
    it("is handed the block itself and called Position", () => {
      const align = { mobile: "center", desktop: "right" } as const;
      const m = mount(image({ align }));
      expect(m.prop(isPosition, "what")).toBe("Position");
      // The block itself (D179: its base alignment and overrides), which the size edited is read from.
      expect(m.prop(isPosition, "value")).toMatchObject({ align: "right", at: { md: { align: "center" } } });
    });

    it("sets where the picture sits, leaving its width alone", () => {
      const m = mount(image({ maxWidth: 300 }));
      m.fire(isPosition, "onChange", { align: "center" });
      expect(m.patches).toEqual([{ align: "center" }]);
      expect(m.block).toMatchObject({ maxWidth: 300, align: "center" });
    });

    it("takes the key away when the choice is back to nothing", () => {
      const m = mount(image({ align: "center" }));
      m.fire(isPosition, "onChange", { align: undefined });
      expect(keysOf(m.patches[0])).toEqual(["align"]);
      expect("align" in m.block).toBe(false);
    });
  });

  describe("at a smaller screen size (D179)", () => {
    it("shows the width the size inherits, and makes one of its own there only", () => {
      const m = mount(image({ maxWidth: 600 }), "md");
      expect(m.prop(isRange, "value")).toBe(600);
      m.slide(300);
      expect(m.block.maxWidth).toBe(600);
      expect(m.block.at).toEqual({ md: { maxWidth: 300 } });
      expect(m.prop(isRange, "value")).toBe(300);
    });

    it("makes the picture its own size at the size alone, under a narrower larger size", () => {
      const m = mount(image({ maxWidth: 300 }), "sm");
      m.fire(isReset, "onClick");
      expect(m.block.maxWidth).toBe(300);
      expect(m.block.at).toEqual({ sm: { maxWidth: null } });
      expect(m.prop(isRange, "value")).toBe(800);
    });

    it("takes the override away when the width is what the size inherits", () => {
      const m = mount(image({ maxWidth: 300, at: { md: { maxWidth: 200 } } }), "md");
      m.slide(300);
      expect(m.block.at).toBeUndefined();
      expect(m.block.maxWidth).toBe(300);
    });
  });
});
