import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PackSlotView } from "@/server/content-packs";

import { ImageUploadButton } from "./image-upload";
import { PackSlotPictures } from "./pack-pictures";
import { PictureMakerProvider } from "./picture-maker";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const upload = async () => ({ ok: true as const, url: "https://x.test/p.webp" });
const field = (props: Partial<Parameters<typeof ImageUploadButton>[0]> = {}) =>
  createElement(ImageUploadButton, { upload, label: "Upload picture", onUploaded: () => {}, ...props });
const inMaker = (child: ReactNode) => createElement(PictureMakerProvider, { maker: { endpoint: "/admin/shop/media/make" } }, child);

describe("making a picture field's picture by prompt (D283)", () => {
  it("is offered under the builder's maker, as making again where the field has a picture", () => {
    expect(renderToString(inMaker(field()))).toContain("Make with AI");
    expect(renderToString(inMaker(field({ current: { url: "https://x.test/a.webp", width: 10, height: 10 } })))).toContain("Make again with AI");
  });

  it("is not offered without a maker (no picture model), nor for a brand's logo", () => {
    expect(renderToString(field())).not.toContain("with AI");
    expect(renderToString(inMaker(field({ make: false })))).not.toContain("with AI");
  });
});

describe("a theme content's pictures one by one (D283)", () => {
  const view = (patch: Partial<PackSlotView>): PackSlotView => ({
    slot: "hero",
    label: "The front page's large picture",
    picture: { url: "https://x.test/hero.webp", thumbnailUrl: null },
    state: "made",
    brief: "A track at dawn",
    again: false,
    previous: false,
    ...patch,
  });
  const done = async () => ({ ok: true as const });
  const render = (slots: PackSlotView[], problem: string | null = null) =>
    renderToString(createElement(PackSlotPictures, { title: "Halden Athletic", slots, problem, remake: done, putBack: done, stop: done }));

  it("offers Make again for a made picture, and Put back once one was made again", () => {
    const html = render([view({}), view({ slot: "product:shoe", label: "Trail running shoes", previous: true })]);
    // Each button is named for its picture.
    expect(html.match(/aria-label="Make again: /g)).toHaveLength(2);
    expect(html).toContain('aria-label="Make again: Trail running shoes"');
    expect(html.match(/aria-label="Put back the one before: /g)).toHaveLength(1);
    expect(html).toContain('aria-label="Put back the one before: Trail running shoes"');
  });

  it("says a picture is being made again, with Stop, and offers nothing for art or a picture not made", () => {
    const html = render([view({ again: true }), view({ slot: "story", state: "art" }), view({ slot: "tile", state: "missing", picture: null })]);
    expect(html).toContain("Being made again");
    expect(html).toContain("Making one picture again");
    expect(html).toContain("Stop");
    expect(html).toContain("Drawn art stands in until its photograph is made.");
    expect(html).toContain("Not made yet.");
    expect(html.match(/aria-label="Make again: /g) ?? []).toHaveLength(0);
  });

  it("says why the job stopped", () => {
    expect(render([view({})], "The picture model is busy.")).toContain("Stopped: The picture model is busy.");
  });
});
