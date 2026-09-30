import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { progressOf } from "@/lib/store-copy-test-support";

import { StoreCopyProgress, StoreCopyProgressView } from "./store-copy-progress";

const view = (over: Parameters<typeof progressOf>[0] = {}, trouble = false) =>
  renderToString(createElement(StoreCopyProgressView, { progress: progressOf(over), trouble }))
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");

describe("the copy's progress page", () => {
  it("shows a running copy with steps and counts", () => {
    const out = view();
    expect(out).toContain("Copying Kaffe & Co to Copy of Kaffe & Co");
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain("Copying pictures and files …");
    expect(out).toContain('aria-current="step"');
    expect(out).toContain("In progress");
    expect(out).toContain("Waiting");
    expect(out).toContain("12 of 90");
    expect(out).toContain("40 of 40");
    expect(out.match(/<progress/g)).toHaveLength(5);
    expect(out).toContain('value="12" max="90"');
    // Orders were not asked for.
    expect(out).not.toContain("Copying order history");
    expect(out).not.toContain("Your new store is ready");
    expect(out).not.toContain("could not be copied");
  });

  it("says when pictures were left out", () => {
    expect(view({ mediaLeftOut: 4 })).toContain("4 pictures and files could not be copied and were left out.");
  });

  it("says when the latest news could not be fetched", () => {
    expect(view({}, true)).toContain("this page keeps trying");
    expect(view({ status: "done", phase: "done" }, true)).not.toContain("keeps trying");
  });

  it("links to the new store when done", () => {
    const out = view({ status: "done", phase: "done", finishedAt: "2026-09-30T10:05:00Z" });
    expect(out).toContain("Your new store is ready");
    expect(out).toContain('href="/admin/copy-of-kaffe-co"');
    expect(out).toContain('href="/admin/copy-of-kaffe-co/setup"');
    expect(out).toContain('href="/admin/stores"');
    expect(out).not.toContain("In progress");
  });

  it("explains a failure in plain words", () => {
    const out = view({ status: "failed", phase: "media", problem: "The store has too many pictures to copy at once." });
    expect(out).toContain("The copy did not finish");
    expect(out).toContain('role="alert"');
    expect(out).toContain("The store has too many pictures to copy at once.");
    expect(out).toContain("start a new copy");
    expect(out).toContain("stays closed");
    expect(out).toContain("Stopped here");
    expect(out).not.toContain("Your new store is ready");
    expect(view({ status: "failed", problem: null })).toContain("Something went wrong while copying.");
  });

  it("draws the first answer on the server", () => {
    const out = renderToString(
      createElement(StoreCopyProgress, {
        id: "x",
        progress: progressOf(),
        read: async () => ({ ok: true as const, progress: progressOf() }),
      }),
    );
    expect(out).toContain("Copying");
  });
});
