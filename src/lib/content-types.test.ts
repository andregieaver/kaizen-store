import { describe, expect, it } from "vitest";

import {
  CONTENT_TYPE_PRESETS,
  EMPTY_ENTRY,
  contentTypeInput,
  emptyType,
  entryInput,
  entrySeoIn,
  entrySlugOf,
  entryStatus,
  entryTitle,
  publishProblems,
  readEntryContent,
  removedFieldIds,
  retypedFields,
  sameContent,
  typeFromPreset,
  typeSlugOf,
  typeSlugProblem,
  withoutFields,
  type EntryContent,
} from "./content-types";
import { fieldGroupInput, newField, type FieldDef } from "./custom-fields";

/** Content types (wave 6 unit H, D326): the shapes, checks and helpers shared by the admin and the server. */

const title: FieldDef = { id: "f_title000001", name: "title", label: "Title", type: "text", access: "public", width: 100, required: true };
const body: FieldDef = { id: "f_body0000001", name: "body", label: "Body", type: "richText", access: "public", width: 100 };
const photo: FieldDef = { id: "f_photo000001", name: "photo", label: "Photo", type: "image", access: "public", width: 100 };
const type = { id: null, name: "Team", slug: "team", fields: [title, body, photo], titleField: title.id, summaryField: body.id, pictureField: photo.id, hasPages: true };

const content = (values: Record<string, unknown>, translations: Record<string, Record<string, unknown>> = {}): EntryContent => ({
  ...EMPTY_ENTRY,
  data: { values: values as EntryContent["data"]["values"], translations: translations as EntryContent["data"]["translations"] },
});

describe("a content type's definition", () => {
  it("takes fields as a group's are, with a text title and fitting summary and picture", () => {
    expect(contentTypeInput.safeParse(type).success).toBe(true);
    expect(contentTypeInput.safeParse({ ...type, titleField: body.id }).success).toBe(false);
    expect(contentTypeInput.safeParse({ ...type, summaryField: photo.id }).success).toBe(false);
    expect(contentTypeInput.safeParse({ ...type, pictureField: title.id }).success).toBe(false);
    expect(contentTypeInput.safeParse({ ...type, fields: [] }).success).toBe(false);
  });

  it("checks its fields with the same schema as a group, so a repeated name is refused in both", () => {
    const twice = [title, { ...body, name: "title" }];
    const asType = contentTypeInput.safeParse({ ...type, fields: twice });
    const asGroup = fieldGroupInput.safeParse({ name: "G", slug: "g", entities: ["product"], fields: twice });
    expect(asType.success).toBe(false);
    expect(asGroup.success).toBe(false);
    if (!asType.success && !asGroup.success) expect(asType.error.issues[0].message).toBe(asGroup.error.issues[0].message);
  });

  it("never takes a web name the site uses for itself", () => {
    expect(typeSlugProblem("team")).toBeNull();
    expect(typeSlugProblem("cart")).not.toBeNull();
    expect(typeSlugProblem("Team")).not.toBeNull();
    expect(typeSlugProblem("a--b")).not.toBeNull();
    expect(typeSlugOf("Team members!")).toBe("team-members");
  });

  it("says which fields a change took away and which changed type", () => {
    expect(removedFieldIds([title, body], [title])).toEqual([body.id]);
    expect(retypedFields([title, body], [title, { ...body, type: "textarea" }]).map((f) => f.id)).toEqual([body.id]);
  });
});

describe("starting points", () => {
  it("are each a type the server would take, in English and Norwegian", () => {
    for (const preset of CONTENT_TYPE_PRESETS) {
      for (const lang of ["en", "nb"] as const) {
        const made = typeFromPreset(preset.key, lang);
        expect(made, preset.key).not.toBeNull();
        expect(contentTypeInput.safeParse(made).success, `${preset.key} ${lang}`).toBe(true);
      }
    }
    expect(typeFromPreset("team", "nb")!.fields[0].label).toBe("Navn");
    expect(typeFromPreset("team", "en", ["team"])!.slug).toBe("team-2");
    expect(typeFromPreset("nope", "en")).toBeNull();
  });

  it("start an empty type with a title field", () => {
    const empty = emptyType("en");
    expect(contentTypeInput.safeParse({ ...empty, name: "Things" }).success).toBe(true);
  });
});

describe("an entry", () => {
  it("is a draft, published, or published with changes not yet published", () => {
    const draft = content({});
    expect(entryStatus({ draft, published: null })).toBe("draft");
    expect(entryStatus({ draft, published: content({}) })).toBe("published");
    expect(entryStatus({ draft: content({ [title.id]: "x" }), published: content({}) })).toBe("changed");
    // The order keys were written in does not matter.
    expect(sameContent({ seo: { description: "", title: "" }, seoTranslations: {}, data: { translations: {}, values: {} } }, EMPTY_ENTRY)).toBe(true);
  });

  it("takes its title from its title field, in a language or the main one", () => {
    const data = content({}, { "nb-NO": { [title.id]: "Kari" }, en: { [title.id]: "Kari (en)" } }).data;
    expect(entryTitle(type, data, "nb-NO", "nb-NO")).toBe("Kari");
    expect(entryTitle(type, data, "en", "nb-NO")).toBe("Kari (en)");
    expect(entryTitle(type, data, "sv", "nb-NO")).toBe("Kari");
    expect(publishProblems(type, content({}), "nb-NO")).toHaveLength(1);
    expect(publishProblems(type, content({}, { "nb-NO": { [title.id]: "Kari" } }), "nb-NO")).toEqual([]);
  });

  it("keeps search texts per language over the main language's", () => {
    const c: EntryContent = { ...EMPTY_ENTRY, seo: { title: "T", description: "D" }, seoTranslations: { en: { title: "TE", description: "" } } };
    expect(entrySeoIn(c, "nb-NO", "nb-NO")).toEqual({ title: "T", description: "D" });
    expect(entrySeoIn(c, "en", "nb-NO")).toEqual({ title: "TE", description: "D" });
  });

  it("loses a removed field's values in every language", () => {
    const c = content({ [photo.id]: { url: "x", thumbnailUrl: null, alt: "" } }, { "nb-NO": { [title.id]: "Kari", [body.id]: "x" }, en: { [body.id]: "y" } });
    const next = withoutFields(c, [body.id]);
    expect(next.data.translations).toEqual({ "nb-NO": { [title.id]: "Kari" } });
    expect(next.data.values).toEqual(c.data.values);
  });

  it("is read without trusting what is kept", () => {
    expect(readEntryContent(null)).toEqual(EMPTY_ENTRY);
    expect(readEntryContent({ data: { values: [], translations: { en: "x" } }, seo: { title: 3 } }).data).toEqual({ values: {}, translations: { en: {} } });
  });

  it("has an address made from its title, never ab", () => {
    expect(entrySlugOf("Kari Nordmann")).toBe("kari-nordmann");
    expect(entrySlugOf("")).toBe("entry");
    expect(entryInput.safeParse({ typeId: "11111111-2222-4333-8444-555555555555", slug: "ab", fields: {} }).success).toBe(false);
    expect(entryInput.safeParse({ typeId: "11111111-2222-4333-8444-555555555555", slug: "kari", fields: {} }).success).toBe(true);
  });

  it("gets its fields made public by the editor (a new field is private in a group)", () => {
    expect(newField("text").access).toBe("private");
  });
});
