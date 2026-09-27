import { describe, expect, it } from "vitest";

import {
  canWrite,
  cleanWritten,
  fieldsFor,
  plainText,
  productFacts,
  writingMessages,
  writtenFindings,
  type ProductFacts,
} from "./product-writing";

const facts: ProductFacts = productFacts.parse({
  kind: "goods",
  title: "Keramikkopp",
  description: "Kopp i steingods. Tåler oppvaskmaskin.",
  categories: ["Kjøkken"],
  options: [{ name: "Farge", values: ["Hvit", "Blå"] }],
});

describe("AI product texts (D76)", () => {
  it("asks for the fields each kind of suggestion fills", () => {
    expect(fieldsFor("write", facts)).toEqual(["description"]);
    expect(fieldsFor("seo", facts)).toEqual(["seoTitle", "seoDescription"]);
    expect(fieldsFor("translate", facts)).toEqual(["title", "description"]);
    expect(fieldsFor("translate", { ...facts, seoTitle: "Kopp" })).toEqual(["title", "description", "seoTitle"]);
    expect(canWrite("improve", { ...facts, description: "" })).toBe(false);
    expect(canWrite("write", { ...facts, title: "" })).toBe(false);
  });

  it("tells the model the rules and gives it the product's facts only", () => {
    const [system, user] = writingMessages({ kind: "write", language: "Norwegian Bokmål", fromLanguage: "", facts });
    expect(system.content).toContain("in Norwegian Bokmål");
    expect(system.content).toContain("Never add a fact that is not given");
    expect(system.content).toContain("Never mention prices, discounts, offers, delivery times or stock.");
    expect(system.content).toMatch(/environmental claims.*urgency.*best or lowest price/);
    expect(user.content).toContain('"categories": [\n    "Kjøkken"\n  ]');
    expect(user.content).not.toMatch(/price|stock/i);
    const [, translate] = writingMessages({ kind: "translate", language: "Swedish", fromLanguage: "Norwegian Bokmål", facts });
    expect(translate.content).toContain("Translate the title, description from Norwegian Bokmål into Swedish.");
  });

  it("keeps the answer as plain text within each field's limit", () => {
    expect(plainText("## Kopp\n\n**Solid** <b>kopp</b>.\n\n\n\n- tåler oppvask", 1000)).toBe("Kopp\n\nSolid kopp.\n\ntåler oppvask");
    const long = plainText(`${"ord ".repeat(100)}slutt`, 50);
    expect(long.length).toBeLessThanOrEqual(50);
    expect(long.endsWith("ord")).toBe(true);
    expect(cleanWritten({ description: " <p>En kopp.</p> " }, "write", facts)).toEqual({ description: "En kopp." });
    expect(cleanWritten({ seoTitle: "x".repeat(500), seoDescription: "Kopp" }, "seo", facts)?.seoTitle).toHaveLength(120);
    // Missing or empty fields, or not JSON: nothing to suggest.
    expect(cleanWritten({ title: "Kopp" }, "translate", facts)).toBeNull();
    expect(cleanWritten({ description: "  " }, "write", facts)).toBeNull();
    expect(cleanWritten(null, "write", facts)).toBeNull();
  });

  it("lists what the claims filter finds, field by field", () => {
    expect(writtenFindings({ description: "En solid kopp." })).toEqual({});
    const found = writtenFindings({ title: "Kopp", description: "En miljøvennlig kopp, kun 199 kr." });
    expect(Object.keys(found)).toEqual(["description"]);
    expect(found.description?.map((f) => f.kind)).toEqual(["green", "price"]);
  });
});
