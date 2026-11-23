import { describe, expect, it } from "vitest";

import { fieldStyleAttrs, trimFieldStyle } from "./form-field-style";
import { fieldStyleSchema } from "./form-field-style-schema";
import { newPageContent, pageInput } from "./page-content";

describe("a form's field style (D878)", () => {
  it("gives a form left as it was nothing, so it looks as it did", () => {
    expect(fieldStyleAttrs(undefined)).toEqual({ data: {}, vars: {} });
    expect(fieldStyleAttrs({})).toEqual({ data: {}, vars: {} });
  });

  it("turns the owner's choices into attributes and custom properties", () => {
    const { data, vars } = fieldStyleAttrs({
      labels: "animated",
      look: "underline",
      focus: "#2f6b55",
      placeholder: "#8d958f",
      radius: 12,
      gap: 24,
      motion: { case: "switch", align: "text", duration: 400, easing: "bounce", movedSize: 10.5, spacing: 0.12, lift: 8, placeholder: false },
    });
    expect(data).toEqual({
      "data-kf-labels": "animated",
      "data-kf-look": "underline",
      "data-kf-focus": "",
      "data-kf-phc": "",
      "data-kf-case": "switch",
      "data-kf-align": "text",
      "data-kf-ph": "hidden",
    });
    expect(vars).toEqual({
      "--kf-focus": "#2f6b55",
      "--kf-ph": "#8d958f",
      "--kf-radius": "12px",
      "--kf-gap": "24px",
      "--kf-dur": "400ms",
      "--kf-ease": "cubic-bezier(.34,1.56,.64,1)",
      "--kf-moved": "10.5px",
      "--kf-track": "0.12em",
      "--kf-lift": "8px",
    });
  });

  it("draws no motion unless the labels are animated", () => {
    expect(fieldStyleAttrs({ labels: "placeholder", motion: { duration: 400 } })).toEqual({ data: { "data-kf-labels": "placeholder" }, vars: {}, labels: "placeholder" });
  });

  it("stores only what differs from the defaults", () => {
    expect(trimFieldStyle({ labels: undefined, motion: { duration: 220, movedSize: 11, spacing: 0.08, lift: 6 } })).toBeUndefined();
    expect(trimFieldStyle({ labels: "animated", motion: { duration: 300, lift: 6 } })).toEqual({ labels: "animated", motion: { duration: 300 } });
  });

  it("refuses settings out of bounds or of unknown kinds", () => {
    expect(fieldStyleSchema.safeParse({ labels: "animated", radius: 12, motion: { movedSize: 10.5 } }).success).toBe(true);
    expect(fieldStyleSchema.safeParse({ radius: 99 }).error?.issues[0].message).toBe("A field's corner radius is at most 32.");
    expect(fieldStyleSchema.safeParse({ labels: "sideways" }).success).toBe(false);
    expect(fieldStyleSchema.safeParse({ background: "red" }).success).toBe(false);
    expect(fieldStyleSchema.safeParse({ motion: { duration: 50 } }).success).toBe(false);
  });

  it("is kept on a page's form component", () => {
    const page = pageInput.parse({
      ...newPageContent(),
      title: "Workshops",
      slug: "workshops",
      rows: [{ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks: [{ id: "f1", type: "form", formId: null, fieldStyle: { labels: "animated", look: "filled" } }] }] }],
    });
    const block = page.rows[0].columns[0].blocks[0];
    expect(block.type === "form" && block.fieldStyle).toEqual({ labels: "animated", look: "filled" });
  });
});
