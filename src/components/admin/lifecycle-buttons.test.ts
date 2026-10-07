import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { FormState } from "./action-form";
import { LifecycleBadge, LifecycleButtons } from "./lifecycle-buttons";
import { PreviewLink } from "./preview-link";

const action = async (): Promise<FormState> => ({ status: "ok", messages: [] });
const actions = { publish: action, unpublish: action, archive: action, restore: action, remove: action };
const facts: { published: boolean; archivedAt: string | null; publishedAt: string | null; changed: boolean; used: boolean } = {
  published: false,
  archivedAt: null,
  publishedAt: null,
  changed: false,
  used: false,
};
const render = (over: Partial<typeof facts>) =>
  renderToString(createElement(LifecycleButtons, { kind: "design profile", title: "Nordic calm", facts: { ...facts, ...over }, actions }));
const buttons = (html: string) => (html.match(/<button[^>]*>.*?<\/button>/g) ?? []).map((b) => b.replace(/<[^>]+>/g, ""));

describe("the life of a store template or design profile on the platform (D177)", () => {
  it("offers Publish, Archive and a confirmed Delete for a draft nothing used", () => {
    const html = render({});
    expect(buttons(html)).toEqual(["Publish Nordic calm", "Archive Nordic calm", "Delete for good Nordic calm"]);
    // Delete is behind a disclosure and a required tick.
    expect(html).toMatch(/<details[^>]*>\s*<summary[^>]*>Delete…/);
    expect(html).toMatch(/<input type="checkbox" required=""[^>]*name="confirm"/);
  });

  it("offers Publish changes and Unpublish while published with changes, and never Delete once used", () => {
    expect(buttons(render({ published: true, publishedAt: "2026-10-07", changed: true, used: true }))).toEqual([
      "Publish changes Nordic calm",
      "Unpublish Nordic calm",
      "Archive Nordic calm",
    ]);
  });

  it("offers only Restore (and Delete while unused) when archived", () => {
    expect(buttons(render({ archivedAt: "2026-10-07", used: true }))).toEqual(["Restore Nordic calm"]);
    expect(buttons(render({ archivedAt: "2026-10-07" }))).toEqual(["Restore Nordic calm", "Delete for good Nordic calm"]);
  });

  it("names the state, and opens previews in a new window", () => {
    expect(renderToString(createElement(LifecycleBadge, { facts: { ...facts, published: true, publishedAt: "x", changed: true } }))).toContain(
      "Published, with unpublished changes",
    );
    const link = renderToString(createElement(PreviewLink, { href: "/s/spa-v1", label: "Preview as published", title: "Spa" }));
    expect(link).toMatch(/target="_blank" rel="noopener"/);
    expect(link).toContain("(opens in a new window)");
  });
});
