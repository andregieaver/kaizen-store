import { describe, expect, it } from "vitest";

import type { ShownField, ShownGroup } from "./custom-fields";
import {
  customFieldsShow,
  drawable,
  fieldHeading,
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
});
