import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PageBlock, PageRow } from "@/lib/page-content";
import { newModal } from "@/lib/page-modal";

import { ModalBar } from "./modal-preview";

vi.mock("server-only", () => ({}));

/**
 * A modal's row on the builder's canvas (D121): its badge says what opens it, and, because the preview below it
 * draws a form that has no address to send to yet while the site leaves the row out, whether it is on the site.
 */

const newsletter = (recipients: string[]): PageBlock => ({
  id: "n",
  type: "newsletter",
  recipients,
  placeholder: "",
  submitLabel: "",
  successMessage: "",
  consent: "",
});
const row = (blocks: PageBlock[]): PageRow => ({
  id: "m",
  type: "row",
  layout: "1",
  columns: [{ id: "m-c", blocks }],
  modal: newModal("newsletter"),
});
const bar = (target: PageRow) => renderToString(createElement(ModalBar, { row: target, lang: "en" }));

describe("the badge on a modal's row", () => {
  it("names the modal and what opens it", () => {
    const out = bar(row([newsletter(["owner@example.com"])]));
    expect(out).toContain("Modal · newsletter · opens by button");
    expect(out).not.toContain("data-modal-left-out");
  });

  it("says the modal is not on the site while nothing in its row shows there", () => {
    const out = bar(row([newsletter([])]));
    expect(out).toContain("data-modal-left-out");
    expect(out).toContain("Not on your site yet");
    expect(out).toContain("no link or class can open it");
  });

  it("does not say it once something else in the row shows", () => {
    const heading: PageBlock = { id: "h", type: "heading", text: "Join us", level: 2 };
    expect(bar(row([heading, newsletter([])]))).not.toContain("data-modal-left-out");
  });
});
