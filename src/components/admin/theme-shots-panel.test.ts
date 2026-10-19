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
  retryAt: null,
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
    expect(html).toContain("One picture could not be made after every try.");
  });

  it("says when a picture that failed a round of tries is tried again by itself, and offers to try now (D284)", () => {
    const html = draw([
      shot(null, "computer", "done"),
      shot(null, "phone", "waiting", { problem: "The browser stopped while it was looking at the page.", retryAt: "2026-10-19T08:10:00.000Z" }),
    ]);
    expect(html).toContain("Waiting to be made");
    expect(html).toContain("Tried again by itself 19 Oct, 08:10 UTC. Last time: The browser stopped while it was looking at the page.");
    expect(html).toContain("Try again now");
    expect(html).toContain("One picture will be tried again by itself.");
    expect(html).not.toContain("Could not be made");
  });

  it("shows the three highlights once composed, and that they follow the photographs before", () => {
    const highlights: ShotStatus = {
      variation: null,
      kind: "highlights",
      version: 3,
      status: "done",
      problem: null,
      finishedAt: "2026-10-16T12:00:00.000Z",
      retryAt: null,
      pictures: { devices: file("d.webp", 1600, 1000), collage: file("g.webp", 1600, 1000), closeup: file("u.webp", 1600, 1000) },
    };
    const made = draw([shot(null, "computer", "done"), shot(null, "phone", "done"), highlights]);
    expect(made).toContain('alt="On a computer and two phones"');
    expect(made).toContain('src="https://x.test/g.webp"');
    expect(made).toContain('alt="The product page up close"');
    expect(draw([shot(null, "computer", "running")])).toContain("Made after the photographs");
  });

  it("lets the admin put their own picture in place of each made one, and says which shows (step 3)", () => {
    const own = async () => ({ status: "idle" as const, messages: [] });
    const upload = async () => ({ ok: true as const, url: "/media/x.webp" });
    const computer = shot(null, "computer", "done", { pictures: { card: file("card.webp", 800, 600), share: file("share.jpg", 1200, 630) } });
    const html = renderToStaticMarkup(
      createElement(ThemeShotsPanel, { looks: [{ key: null, name: "Calm" }], shots: [computer], published: true, retry, own: { collage: "/media/mine.webp" }, ownAction: own, upload }),
    ).replaceAll("<!-- -->", "");
    expect(html).toContain("Use your own pictures");
    // Closed, saying how many are in use (opened from the props, a save would close it under the person).
    expect(html).not.toMatch(/<details[^>]*open=""/);
    expect(html).toContain("1 in use");
    for (const slot of ["share", "devices", "collage", "closeup"]) expect(html).toContain(`data-own-slot="${slot}"`);
    expect(html).toContain("Share image");
    expect(html).toContain('value="/media/mine.webp"');
    expect(html).toContain("Your own picture shows in place of the made one.");
    expect(html).toContain("The made picture shows.");
    expect(html).toContain("Nothing made yet.");
    // Without the action the section is not drawn; with none set it says nothing is in use.
    expect(draw([computer])).not.toContain("Use your own pictures");
    const none = renderToStaticMarkup(createElement(ThemeShotsPanel, { looks: [], shots: [], published: true, retry, ownAction: own, upload }));
    expect(none).not.toContain("in use");
  });

  it("before the theme is published, says its looks are photographed once it is", () => {
    const html = draw([], false);
    expect(html).toContain("once the theme is published");
    expect(html).toContain("Not made yet");
  });
});
