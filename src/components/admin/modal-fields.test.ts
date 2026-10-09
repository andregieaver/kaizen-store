import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PageRow } from "@/lib/page-content";
import { newModal, type RowModal } from "@/lib/page-modal";

import { ModalFields, ModalPicker } from "./modal-fields";

/**
 * A row's Modal setting and a button's "Opens a modal" as the builder draws
 * them (D121), drawn on the server as the other settings are: what a person
 * sees and can use before any script runs.
 */

const row = (id: string, modal?: RowModal): PageRow => ({
  id,
  type: "row",
  layout: "1",
  columns: [{ id: `${id}-c`, blocks: [] }],
  ...(modal && { modal }),
});

const fields = (target: PageRow, rows: PageRow[] = [target]) =>
  renderToString(createElement(ModalFields, { row: target, rows, onChange: () => {} })).replace(/<!-- -->/g, "");

describe("a row's Modal setting", () => {
  it("is one switch until it is turned on", () => {
    const out = fields(row("a"));
    expect(out).toContain("Show this row in a modal");
    expect(out).not.toContain("Address name");
    expect(out).not.toMatch(/checked/);
  });

  it("shows what opens it, how often, and how it looks, each labelled", () => {
    const target = row("a", {
      ...newModal("newsletter"),
      name: "Newsletter",
      triggers: { button: true, className: "open-newsletter", exitIntent: true, timer: { seconds: 12 } },
      frequency: "days",
      days: 30,
    });
    const out = fields(target);
    for (const text of [
      "Show this row in a modal",
      "Address name",
      "#modal-",
      "Copy link #modal-newsletter",
      "Opens when",
      "A button or link is pressed",
      "Give a button the action Opens a modal, or link any text, menu item or button to #modal-newsletter.",
      "An element with a class is pressed",
      "Add the class to any button, image or text with Advanced → CSS classes.",
      "Class name",
      "The visitor is about to leave (exit intent)",
      "A touch screen has no pointer to leave with",
      "A timer runs out",
      "seconds",
      "How often it opens by itself",
      "Not again for",
      "Size",
      "Position",
      "Dimming behind it",
      "Show a close button",
      "Escape closes it either way.",
      "A click outside it closes it",
    ]) {
      expect(out, text).toContain(text);
    }
    expect(out).toContain('value="12"');
    expect(out).toContain('value="30"');
    expect(out).toContain('value="open-newsletter"');
    expect(out).not.toContain('role="alert"');
  });

  it("says what is wrong as it arises", () => {
    const nothing = fields(row("a", { ...newModal("promo"), triggers: {} }));
    expect(nothing).toContain('role="alert"');
    expect(nothing).toContain("Choose at least one way to open the modal");
    const clash = fields(row("a", newModal("promo")), [row("a", newModal("promo")), row("b", newModal("promo"))]);
    expect(clash).toContain("Another modal on this page has this address name.");
    expect(fields(row("a", { ...newModal("promo"), key: "Bad Key" }))).toContain("lower-case letters");
    expect(fields(row("a", { ...newModal("promo"), triggers: { className: "a b" } }))).toContain(
      "Write one class name",
    );
  });

  it("does not let both ways to close be switched off", () => {
    const onlyButton = fields(row("a", { ...newModal("promo"), closeOnOverlay: false }));
    // The close button is the last way left to close it: its switch is disabled.
    expect(onlyButton).toMatch(/<input type="checkbox"[^>]*disabled[^>]*\/><span[^>]*><span[^>]*>Show a close button/);
  });
});

const picker = (rows: PageRow[], href: string) =>
  renderToString(createElement(ModalPicker, { rows, href, onPick: () => {} })).replace(/<!-- -->/g, "");

/** A modal row whose only component is a newsletter form: shown on the site only once it has an address to send to. */
const formRow = (recipients: string[]): PageRow => ({
  id: "m",
  type: "row",
  layout: "1",
  columns: [
    {
      id: "m-c",
      blocks: [{ id: "n", type: "newsletter", recipients, placeholder: "", submitLabel: "", successMessage: "", consent: "" }],
    },
  ],
  modal: newModal("newsletter"),
});

describe("a modal that nothing in shows on the site", () => {
  it("says so in its settings, and not once the form has an address", () => {
    const out = fields(formRow([]));
    expect(out).toContain("Not on your site yet");
    expect(out).toContain("no link or class can open it");
    expect(out).toContain("under Send to");
    expect(fields(formRow(["owner@example.com"]))).not.toContain("Not on your site yet");
  });

  it("says so beside a button's choice of it", () => {
    const out = picker([formRow([])], "#modal-newsletter");
    expect(out).toContain("That modal is not on the site yet");
    expect(picker([formRow(["owner@example.com"])], "#modal-newsletter")).not.toContain("not on the site yet");
  });
});

describe("a button's Opens a modal", () => {
  it("lists the page's modals by name, and the one the address names is chosen", () => {
    const rows = [row("a", { ...newModal("promo"), name: "Promo" }), row("b", newModal("newsletter")), row("c")];
    const out = picker(rows, "#modal-newsletter");
    expect(out).toContain("Opens a modal");
    expect(out).toContain('<option value="promo">Promo</option>');
    expect(out).toContain('<option value="newsletter" selected="">newsletter</option>');
  });

  it("says when the page has none, when a modal is not set to open from links, and when the address names another", () => {
    expect(picker([row("a")], "")).toContain("This page has no modal yet");
    const timerOnly = row("a", { ...newModal("promo"), triggers: { timer: { seconds: 5 } } });
    expect(picker([timerOnly], "#modal-promo")).toContain("not set to open from a button or link");
    expect(picker([row("a", newModal("promo"))], "#modal-footer-offer")).toContain(
      "a modal in the footer or header may",
    );
  });
});
