import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { PackPictures } = await import("./pack-pictures");

const done = async () => ({ ok: true as const });
const draw = (made: number, asked: boolean, problem: string | null = null) =>
  renderToStaticMarkup(createElement(PackPictures, { title: "Fashion store", made, total: 10, asked, problem, ask: done, stop: done })).replaceAll("<!-- -->", "");

/** *Make the pictures* on the Store templates page (D271): one press asks the job, and the page says what it is doing. */
describe("a pack's pictures on the Demo stores page", () => {
  it("offers to make them with what is made so far", () => {
    const html = draw(0, false);
    expect(html).toContain("Make the pictures");
    expect(html).toContain("0 of 10 pictures made.");
    expect(draw(1, false)).toContain("Make the rest");
  });

  it("says they are being made and that the page may be left, with Stop in place of the button", () => {
    const html = draw(3, true);
    expect(html).toContain("Making the pictures: 3 of 10 made. You can leave this page.");
    expect(html).toContain("Stop");
    expect(html).not.toContain("Make the rest");
  });

  it("says why the job stopped, and nothing more once every picture is made", () => {
    expect(draw(4, false, "The picture model is busy.")).toContain("Stopped: The picture model is busy.");
    // A reason from an earlier stop is not shown while the job is at work again.
    expect(draw(4, true, "The picture model is busy.")).not.toContain("Stopped:");
    const all = draw(10, false, "The picture model is busy.");
    expect(all).toContain("Every picture is made.");
    expect(all).not.toContain("Stopped:");
    expect(all).not.toContain("<button");
  });
});
