import { describe, expect, it } from "vitest";

import type { ShownField, ShownGroup } from "./custom-fields";
import {
  customFieldsShow,
  drawable,
  drawableRows,
  fieldHeading,
  fileKind,
  isSafeAddress,
  linksOf,
  repeaterColumns,
  fieldToShow,
  groupHeading,
  groupsToShow,
  mailAddress,
  phoneNumber,
} from "./field-parts";

const field = (over: Partial<ShownField> & Pick<ShownField, "id" | "type" | "value">): ShownField => ({
  name: over.id,
  label: over.id,
  text: typeof over.value === "string" ? over.value : "",
  ...over,
});

const material = field({ id: "f_material", label: "Material", type: "text", value: "Oak" });
const empty = field({ id: "f_blank", label: "Blank", type: "text", value: "  ", text: "  " });
const badLink = field({
  id: "f_link",
  label: "Link",
  type: "url",
  value: "javascript:alert(1)",
  text: "javascript:alert(1)",
});
const picture = field({
  id: "f_pic",
  label: "Picture",
  type: "image",
  value: { url: "https://cdn.example.com/a.webp", thumbnailUrl: null, alt: "Oak" },
  text: "https://cdn.example.com/a.webp",
});
const badPicture = field({
  id: "f_bad",
  label: "Bad",
  type: "image",
  value: { url: "javascript:alert(1)", thumbnailUrl: null, alt: "" },
  text: "",
});
const video = field({
  id: "f_video",
  label: "Video",
  type: "video",
  value: { source: "youtube", link: "https://youtu.be/dQw4w9WgXcQ" },
  text: "",
});
const badVideo = field({
  id: "f_bv",
  label: "Bad video",
  type: "video",
  value: { source: "youtube", link: "https://example.com/x" },
  text: "",
});
const options = field({
  id: "f_opts",
  label: "Options",
  type: "checkbox",
  value: ["a", "b"],
  text: "A, B",
  items: ["A", "B"],
});

const specs: ShownGroup = {
  id: "g1",
  name: "Specifications",
  slug: "specifications",
  position: "main",
  fields: [material, empty, picture],
};
const care: ShownGroup = { id: "g2", name: "Care", slug: "care", position: "main", fields: [options, badPicture] };
const nothing: ShownGroup = { id: "g3", name: "Nothing", slug: "nothing", position: "main", fields: [empty, badLink] };

describe("custom fields in templates (D118)", () => {
  it("draws a value only when it is fit to draw", () => {
    expect(drawable(material)).toBe(true);
    expect(drawable(empty)).toBe(false);
    expect(drawable(picture)).toBe(true);
    expect(drawable(badPicture)).toBe(false);
    expect(drawable(video)).toBe(true);
    expect(drawable(badVideo)).toBe(false);
    expect(drawable(options)).toBe(true);
    expect(drawable({ ...options, items: [] })).toBe(false);
    // A web address that is not one is drawn as text, not as a link, so it still counts.
    expect(drawable(badLink)).toBe(true);
  });

  it("makes links only of addresses that are addresses", () => {
    expect(mailAddress(" hello@example.com ")).toBe("hello@example.com");
    expect(mailAddress('a"b@example.com')).toBeNull();
    expect(mailAddress("not an address")).toBeNull();
    expect(phoneNumber("+47 22 33 44 55")).toBe("+4722334455");
    expect(phoneNumber("12")).toBeNull();
  });

  it("shows the group chosen, else all the groups that have something to draw", () => {
    const all = [specs, care, nothing];
    expect(groupsToShow(all).map((g) => g.id)).toEqual(["g1", "g2", "g3"]);
    expect(groupsToShow(all, "g2").map((g) => g.id)).toEqual(["g2"]);
    expect(groupsToShow(all, "gone")).toEqual([]);
    // Fields with nothing to draw are left out of the group.
    expect(groupsToShow(all, "g1")[0].fields.map((f) => f.id)).toEqual(["f_material", "f_pic"]);
    expect(groupsToShow(all, "g2")[0].fields.map((f) => f.id)).toEqual(["f_opts"]);
    expect(groupsToShow([{ ...nothing, fields: [empty] }])).toEqual([]);
  });

  it("finds a single field in whichever group has it", () => {
    expect(fieldToShow([specs, care], "f_opts")).toBe(options);
    expect(fieldToShow([specs, care], "f_blank")).toBeNull();
    expect(fieldToShow([specs, care], "f_gone")).toBeNull();
    expect(fieldToShow([specs, care])).toBeNull();
  });

  it("says whether a component has anything to show", () => {
    expect(customFieldsShow({}, [specs])).toBe(true);
    expect(customFieldsShow({}, [{ ...nothing, fields: [empty] }])).toBe(false);
    expect(customFieldsShow({ groupId: "g2" }, [specs])).toBe(false);
    expect(customFieldsShow({ fieldId: "f_material" }, [specs])).toBe(true);
    expect(customFieldsShow({ fieldId: "f_blank" }, [specs])).toBe(false);
  });

  it("puts a group's name over it unless switched off, and the owner's own words only over the one group chosen", () => {
    expect(groupHeading({}, specs, false)).toBe("Specifications");
    expect(groupHeading({ heading: "Facts" }, specs, false)).toBe("Specifications");
    expect(groupHeading({ heading: " Facts " }, specs, true)).toBe("Facts");
    expect(groupHeading({ showHeading: false, heading: "Facts" }, specs, true)).toBeNull();
    // A single field has a heading only when one was written.
    expect(fieldHeading({})).toBeNull();
    expect(fieldHeading({ heading: "Made of" })).toBe("Made of");
    expect(fieldHeading({ showHeading: false, heading: "Made of" })).toBeNull();
  });

  describe("files, links, relations, groups and repeaters", () => {
    const link = (href: string, label = "Words") => ({ label, href });
    const withLinks = (type: ShownField["type"], links: ShownField["links"]) =>
      field({ id: `f_${type}`, type, value: "", text: "", links });

    it("accepts web addresses and site paths, never script or protocol-relative ones", () => {
      for (const good of ["https://example.com/a", "http://example.com", "/s/shop/no/products", " /about "]) {
        expect(isSafeAddress(good)).toBe(true);
      }
      for (const bad of ["javascript:alert(1)", "data:text/html,x", "//evil.example", "/\\evil.example", "about", "", "/a b", "mailto:a@b.no"]) {
        expect(isSafeAddress(bad)).toBe(false);
      }
    });

    it("draws a file, link or relation only with a safe address", () => {
      for (const type of ["file", "link", "product", "page", "term"] as const) {
        expect(drawable(withLinks(type, [link("/a")]))).toBe(true);
        expect(drawable(withLinks(type, [link("javascript:alert(1)")]))).toBe(false);
        expect(drawable(withLinks(type, [link("javascript:alert(1)"), link("https://example.com")]))).toBe(true);
        expect(drawable(withLinks(type, []))).toBe(false);
        expect(drawable(withLinks(type, undefined))).toBe(false);
      }
      expect(linksOf(withLinks("link", [link("javascript:x"), link(" /a ", "  ")]))).toEqual([
        { label: "/a", href: "/a", image: null },
      ]);
    });

    it("keeps a relation's picture only when it is a picture address", () => {
      const [good, bad] = linksOf(
        withLinks("product", [
          { label: "A", href: "/a", image: "https://cdn.example.com/a.webp" },
          { label: "B", href: "/b", image: "javascript:alert(1)" },
        ]),
      );
      expect(good.image).toBe("https://cdn.example.com/a.webp");
      expect(bad.image).toBeNull();
    });

    it("draws a group when one child is, and a repeater when one row has a drawable field", () => {
      const group = (children: ShownField[]) => field({ id: "f_g", type: "group", value: {}, text: "", children });
      expect(drawable(group([empty, material]))).toBe(true);
      expect(drawable(group([empty, badPicture]))).toBe(false);
      expect(drawable(group([]))).toBe(false);
      expect(drawable(field({ id: "f_g", type: "group", value: {}, text: "" }))).toBe(false);
      // A group of a group counts by what is inside.
      expect(drawable(group([group([empty])]))).toBe(false);
      expect(drawable(group([group([material])]))).toBe(true);

      const repeater = (rows: ShownField[][]) => field({ id: "f_r", type: "repeater", value: [], text: "", rows });
      expect(drawable(repeater([[empty], [badPicture, material]]))).toBe(true);
      expect(drawable(repeater([[empty], [badPicture]]))).toBe(false);
      expect(drawable(repeater([]))).toBe(false);
      expect(drawableRows(repeater([[empty], [badPicture, material]]))).toEqual([[material]]);
    });

    it("decides a component's contents with the same rule", () => {
      const dead = field({ id: "f_dead", type: "group", value: {}, text: "", children: [empty] });
      const live = field({ id: "f_live", type: "file", value: {}, text: "", links: [link("https://example.com/a.pdf")] });
      const g: ShownGroup = { id: "g", name: "G", slug: "g", position: "main", fields: [dead, live] };
      expect(groupsToShow([g])[0].fields.map((f) => f.id)).toEqual(["f_live"]);
      expect(customFieldsShow({ fieldId: "f_dead" }, [g])).toBe(false);
      expect(customFieldsShow({ fieldId: "f_live" }, [g])).toBe(true);
    });

    it("makes repeater columns from every field the rows have, in order", () => {
      const a = field({ id: "f_a", label: "A", type: "text", value: "1" });
      const b = field({ id: "f_b", label: "B", type: "text", value: "2" });
      const c = field({ id: "f_c", label: "C", type: "text", value: "3" });
      expect(repeaterColumns([[a], [b, c], [a, c]])).toEqual([
        { id: "f_a", label: "A" },
        { id: "f_b", label: "B" },
        { id: "f_c", label: "C" },
      ]);
    });

    it("names a file's kind from its type, else its ending", () => {
      expect(fileKind("application/pdf", "sheet")).toBe("PDF");
      expect(fileKind("application/octet-stream", "sheet.docx")).toBe("DOCX");
      expect(fileKind(undefined, "readme")).toBeNull();
    });
  });
});
