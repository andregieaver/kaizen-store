import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DEFAULT_RETURN_SETTINGS, type ReturnSettings } from "@/lib/withdrawal";

import { ReturnSettingsForm } from "./settings-form";
import { plain } from "./test-fixtures";

const BAD = /\bNaN\b|Infinity|undefined|\[object|\bnull\b/;
const action = async () => ({ status: "idle" as const, messages: [] });

/** The input or textarea tags with this name, whatever order their attributes come in. */
const tags = (html: string, name: string) => [...html.matchAll(new RegExp(`<(?:input|textarea)[^>]*\\bname="${name}"[^>]*>`, "g"))].map((m) => m[0]);
const tag = (html: string, name: string, value?: string) => tags(html, name).find((t) => value === undefined || t.includes(`value="${value}"`)) ?? "";

const draw = (over: Partial<Parameters<typeof ReturnSettingsForm>[0]> = {}) => {
  const html = renderToString(
    h(ReturnSettingsForm, {
      settings: { ...DEFAULT_RETURN_SETTINGS },
      translations: {},
      main: { locale: "nb-NO", name: "Norwegian" },
      others: [
        { locale: "sv-SE", name: "Swedish" },
        { locale: "en-GB", name: "English" },
      ],
      canEdit: true,
      action,
      translateHref: "/admin/s/translate",
      ...over,
    }),
  );
  const text = plain(html);
  expect(text).not.toMatch(BAD);
  return { html, text };
};

describe("the store's return rules", () => {
  it("start from the legal defaults", () => {
    const { html, text } = draw();
    expect(tag(html, "windowDays")).toContain('value="14"');
    expect(tag(html, "transitDays")).toContain('value="3"');
    expect(tag(html, "whoPaysReturn", "shopper")).toContain("checked");
    expect(tag(html, "whoPaysReturn", "store")).not.toContain("checked");
    expect(tag(html, "refundWhen", "received")).toContain("checked");
    expect(text).toContain("The law gives every consumer 14 days");
    expect(text).toContain("you cannot shorten that");
  });

  it("never offer a window under the legal 14 days", () => {
    const { html } = draw();
    expect(tag(html, "windowDays")).toContain('min="14"');
    expect(tag(html, "windowDays")).toContain('max="100"');
  });

  it("show what the store has set", () => {
    const settings: ReturnSettings = {
      ...DEFAULT_RETURN_SETTINGS,
      windowDays: 30,
      whoPaysReturn: "store",
      refundWhen: "request",
      acceptExcluded: true,
      b2bReturns: true,
      instructions: "Pakk godt.",
      returnAddress: { name: "Retur", street: "Lager 1", postalCode: "0150", city: "Oslo", country: "NO" },
    };
    const { html, text } = draw({ settings });
    expect(tag(html, "windowDays")).toContain('value="30"');
    expect(tag(html, "whoPaysReturn", "store")).toContain("checked");
    expect(tag(html, "refundWhen", "request")).toContain("checked");
    expect(tag(html, "acceptExcluded")).toContain("checked");
    expect(tag(html, "b2bReturns")).toContain("checked");
    expect(text).toContain("Pakk godt.");
    expect(html).toContain('value="Lager 1"');
    expect(html).toContain('value="NO"');
  });

  it("have the instructions in the main language and a text for each other language", () => {
    const { html, text } = draw({ translations: { "sv-SE": "Packa väl." } });
    expect(text).toContain("Norwegian");
    expect(html).toContain('name="instructions"');
    expect(html).toContain('name="instructions:sv-SE"');
    expect(html).toContain('name="instructions:en-GB"');
    expect(text).toContain("Packa väl.");
    expect(html).toContain('href="/admin/s/translate"');
    // The main language has no second box of its own.
    expect(html).not.toContain('name="instructions:nb-NO"');
  });

  it("have no translations to write in a store with one language", () => {
    const { html, text } = draw({ others: [] });
    expect(html).not.toContain('name="instructions:');
    expect(text).not.toContain("A text for each of the other languages");
  });

  it("can be changed by an owner", () => {
    const { html, text } = draw();
    expect(text).toContain("Save the return rules");
    expect(html).not.toMatch(/<fieldset[^>]*disabled/);
  });

  it("are only read by everyone else: the fields are off and there is no button", () => {
    const { html, text } = draw({ canEdit: false });
    expect(html).toMatch(/<fieldset[^>]*disabled/);
    expect(text).not.toContain("Save the return rules");
    expect(text).toContain("Only an owner can change these rules.");
  });
});
