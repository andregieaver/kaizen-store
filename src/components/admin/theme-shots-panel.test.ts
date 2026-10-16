import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ShotStatus } from "@/server/theme-shots";

import { ThemeShotsPanel } from "./theme-shots-panel";

const file = (name: string, width: number, height: number) => ({ path: `platform/theme-shots/t/${name}`, url: `https://x.test/${name}`, width, height, bytes: 1 });
const shot = (variation: string | null, kind: "computer" | "phone", status: ShotStatus["status"], extra: Partial<ShotStatus> = {}): ShotStatus => ({
  variation,
  kind,
  version: 3,
  status,
  problem: null,
  finishedAt: status === "done" ? "2026-10-16T12:00:00.000Z" : null,
  pictures: status === "done" ? (kind === "computer" ? { card: file("card.webp", 800, 600), screen: file("c.webp", 1440, 900) } : { screen: file("p.webp", 780, 1688) }) : {},
  ...extra,
});
const retry = async () => ({ status: "idle" as const, messages: [] });
const draw = (shots: ShotStatus[], published = true) =>
  renderToStaticMarkup(createElement(ThemeShotsPanel, { looks: [{ key: null, name: "Calm" }, { key: "sand", name: "Sand" }], shots, published, retry })).replaceAll("<!-- -->", "");

/** A theme's photographs on its admin page (`docs/theme-showcase-phase-2.md` step 1). */
describe("the Pictures panel", () => {
  it("shows each look's made pictures with their version, and what is still being made", () => {
    const html = draw([shot(null, "computer", "done"), shot(null, "phone", "done"), shot("sand", "computer", "running"), shot("sand", "phone", "waiting")]);
    expect(html).toContain("Calm (its own look)");
    expect(html).toContain('src="https://x.test/card.webp"');
    expect(html).toContain('src="https://x.test/p.webp"');
    expect(html).toContain("Version 3, 16 Oct, 12:00 UTC");
    expect(html).toContain("Being made");
    expect(html).toContain("Waiting to be made");
    expect(html).toContain("2 being made");
    expect(html).not.toContain("Try again");
    // Homer has nothing to do: publishing is enough.
    expect(html).toContain("Nothing to do: publishing is enough.");
  });

  it("says why a picture could not be made and offers to try again", () => {
    const html = draw([shot(null, "computer", "failed", { problem: "The preview answered 404." })]);
    expect(html).toContain("Could not be made");
    expect(html).toContain("The preview answered 404.");
    expect(html).toContain("Try again");
    expect(html).toContain("One picture could not be made after three tries.");
  });

  it("before the theme is published, says its looks are photographed once it is", () => {
    const html = draw([], false);
    expect(html).toContain("once the theme is published");
    expect(html).toContain("Not made yet");
  });
});
