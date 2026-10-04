import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EraseForm } from "./erase-form";
import { ExtendForm, RefuseForm } from "./request-actions";
import { LogRequestForm } from "./request-form";
import { ChangeRuleForm } from "./retention-forms";
import { BAD, noop, plain } from "./test-fixtures";

const text = (el: Parameters<typeof renderToString>[0]) => {
  const html = renderToString(el);
  expect(plain(html)).not.toMatch(BAD);
  return html;
};

describe("the logging form", () => {
  const html = text(h(LogRequestForm, { action: noop, today: "2026-10-04" }));

  it("asks for the kind, the address, the day received (not in the future) and a note", () => {
    expect(html).toContain('name="kind"');
    expect(html).toContain('type="email"');
    expect(html).toContain('name="receivedOn"');
    expect(html).toContain('value="2026-10-04"');
    expect(html).toContain('max="2026-10-04"');
    expect(html).toContain('name="note"');
  });

  it("says the month runs from receipt", () => {
    expect(plain(html)).toContain("The month runs from receipt");
  });
});

describe("the erase confirmation", () => {
  it("asks for the customer's email typed again", () => {
    const out = plain(text(h(EraseForm, { email: "kari@example.com", action: noop })));
    expect(out).toContain("Type kari@example.com to confirm");
  });

  it("asks for the word ERASE when there is no address", () => {
    expect(plain(text(h(EraseForm, { email: null, action: noop })))).toContain("Type ERASE to confirm");
  });

  it("has a required, unspellchecked field", () => {
    const html = text(h(EraseForm, { email: "kari@example.com", action: noop }));
    expect(html).toContain("required");
    expect(html).toMatch(/autocomplete="off"/i);
  });
});

describe("the extend and refuse forms", () => {
  it("need a reason", () => {
    expect(text(h(ExtendForm, { action: noop }))).toContain("required");
    const refuse = text(h(RefuseForm, { action: noop }));
    expect(refuse).toContain('name="reason"');
    expect(refuse).toContain("required");
  });
});

describe("the retention change form", () => {
  it("offers every field the database needs", () => {
    const html = text(h(ChangeRuleForm, { action: noop, today: "2026-10-04", kinds: [{ value: "carts", label: "Carts" }] }));
    for (const name of ["kind", "country", "periodValue", "periodUnit", "countsFrom", "validFrom", "source", "sourceUrl", "basis", "checkedOn", "note"]) {
      expect(html, name).toContain(`name="${name}"`);
    }
  });
});

describe("the privacy components use the admin's tokens, never a fixed colour", () => {
  const dir = __dirname;
  const files = readdirSync(dir).filter((f) => f.endsWith(".tsx") || f === "styles.ts");

  it("has no hex colour and no palette class", () => {
    for (const file of files) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?![^"]*font)/);
      expect(source, file).not.toMatch(/\b(?:bg|text|border)-(?:white|black|gray|slate|zinc|neutral|stone)\b/);
      // Red is only the error colour of the admin's own forms: every light shade has its dark one beside it.
      const light = [...source.matchAll(/(?<!dark:)\b(?:text|border)-red-\d+/g)].length;
      const dark = [...source.matchAll(/dark:(?:text|border)-red-\d+/g)].length;
      expect(light, file).toBe(dark);
    }
  });

  it("never has a max-w-*xl root (the admin's pages use the whole width)", () => {
    for (const file of files.filter((f) => /view|detail|card|form/.test(f))) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source, file).not.toMatch(/<div className="[^"]*max-w-\d?xl[^"]*">\s*\n?\s*<(?:div|h1)/);
    }
  });
});
