import { describe, expect, it } from "vitest";

import {
  classifyQuery,
  clientPrefill,
  formatOrganisationNumber,
  isOrganisationNumber,
  norwegianVatNumber,
  organisationDigits,
  parseCompany,
  parseHits,
  readableName,
} from "./brreg";

// What the register answered for a large company (923609016), cut to the fields that matter.
const equinor = {
  organisasjonsnummer: "923609016",
  navn: "EQUINOR ASA",
  organisasjonsform: { kode: "ASA", beskrivelse: "Allmennaksjeselskap" },
  registrertIMvaregisteret: true,
  hjemmeside: "www.equinor.com",
  forretningsadresse: {
    adresse: ["Forusbeen 50"],
    postnummer: "4035",
    poststed: "STAVANGER",
    land: "Norge",
    landkode: "NO",
  },
  postadresse: { adresse: ["Postboks 8500"], postnummer: "4035", poststed: "STAVANGER", landkode: "NO" },
  konkurs: false,
  underAvvikling: false,
  underTvangsavviklingEllerTvangsopplosning: false,
};

describe("organisation numbers", () => {
  it("accepts the nine digits typed the ways people type them", () => {
    expect(organisationDigits("923609016")).toBe("923609016");
    expect(organisationDigits(" 923 609 016 ")).toBe("923609016");
    expect(organisationDigits("NO923609016MVA")).toBe("923609016");
    expect(organisationDigits("923.609.016")).toBe("923609016");
    expect(organisationDigits("92360901")).toBeNull();
    expect(organisationDigits("Equinor")).toBeNull();
  });

  it("checks the mod-11 check digit, so a mistyped number is caught before any call", () => {
    expect(isOrganisationNumber("923609016")).toBe(true);
    expect(isOrganisationNumber("995849364")).toBe(true);
    expect(isOrganisationNumber("923609017")).toBe(false);
    expect(isOrganisationNumber("123456789")).toBe(false);
    expect(isOrganisationNumber("12345")).toBe(false);
    expect(isOrganisationNumber("abcdefghi")).toBe(false);
  });

  it("writes a number the Norwegian way", () => {
    expect(formatOrganisationNumber("923609016")).toBe("923 609 016");
    expect(formatOrganisationNumber("12")).toBe("12");
  });

  it("states a VAT number only for a company in the VAT register", () => {
    expect(norwegianVatNumber("923609016", true)).toBe("NO923609016MVA");
    expect(norwegianVatNumber("923609016", false)).toBeNull();
    // Never for something that is not an organisation number.
    expect(norwegianVatNumber("123456789", true)).toBeNull();
  });
});

describe("what was typed", () => {
  it("tells a number from a name and from nothing", () => {
    expect(classifyQuery("   ")).toEqual({ kind: "empty" });
    expect(classifyQuery("923 609 016")).toEqual({ kind: "number", digits: "923609016", valid: true });
    expect(classifyQuery("923 609 017")).toEqual({ kind: "number", digits: "923609017", valid: false });
    expect(classifyQuery("Det   Norske Kaffehus")).toEqual({ kind: "name", text: "Det Norske Kaffehus" });
  });

  it("treats a number with the wrong length as a mistyped number, not a name to search for", () => {
    expect(classifyQuery("9236090")).toEqual({ kind: "number", digits: "9236090", valid: false });
  });

  it("cuts a very long name", () => {
    const query = classifyQuery("x".repeat(500));
    expect(query.kind === "name" && query.text.length).toBe(100);
  });
});

describe("names", () => {
  it("reads a name in capitals as a name and keeps legal forms in capitals", () => {
    expect(readableName("EQUINOR ASA")).toBe("Equinor ASA");
    expect(readableName("DET NORSKE KAFFEHUS AS")).toBe("Det Norske Kaffehus AS");
    expect(readableName("ØSTLANDSK BYGG-OG ANLEGG AS")).toBe("Østlandsk Bygg-Og Anlegg AS");
    expect(readableName("HUMAN WEB ANDRÉ GIÆVER")).toBe("Human Web André Giæver");
  });

  it("leaves a name that is not all capitals as it was written", () => {
    expect(readableName("Human Web ENK")).toBe("Human Web ENK");
    expect(readableName("iZettle AS")).toBe("iZettle AS");
  });

  it("keeps initials and words with digits", () => {
    expect(readableName("3M NORGE AS")).toBe("3M Norge AS");
    expect(readableName("A.S. HANDEL")).toBe("A.S. Handel");
  });
});

describe("a company from the register", () => {
  it("is read into the client's details, with the business address and a VAT number", () => {
    const company = parseCompany(equinor);
    expect(company).toMatchObject({
      organisationNumber: "923609016",
      legalName: "EQUINOR ASA",
      name: "Equinor ASA",
      organisationForm: "ASA",
      organisationFormName: "Allmennaksjeselskap",
      vatRegistered: true,
      vatNumber: "NO923609016MVA",
      website: "www.equinor.com",
      warnings: [],
      address: { line1: "Forusbeen 50", line2: "", postalCode: "4035", city: "Stavanger" },
    });
    expect(clientPrefill(company!)).toMatchObject({
      legalName: "EQUINOR ASA",
      organisationNumber: "923609016",
      vatNumber: "NO923609016MVA",
      country: "NO",
      line1: "Forusbeen 50",
      postalCode: "4035",
      city: "Stavanger",
    });
  });

  it("falls back to the postal address when there is no business address", () => {
    const company = parseCompany({ ...equinor, forretningsadresse: undefined });
    expect(company?.address).toMatchObject({ line1: "Postboks 8500", postalCode: "4035" });
  });

  it("joins the further address lines and copes with no address at all", () => {
    const many = parseCompany({
      ...equinor,
      forretningsadresse: { adresse: ["c/o Ola", "Storgata 1", "3. etasje"], postnummer: "0150", poststed: "OSLO" },
    });
    expect(many?.address).toEqual({
      line1: "c/o Ola",
      line2: "Storgata 1, 3. etasje",
      postalCode: "0150",
      city: "Oslo",
    });
    const none = parseCompany({ ...equinor, forretningsadresse: undefined, postadresse: undefined });
    expect(none?.address).toBeNull();
    expect(clientPrefill(none!)).toMatchObject({ line1: "", line2: "", postalCode: "", city: "" });
  });

  it("gives no VAT number to a company outside the VAT register", () => {
    const company = parseCompany({ ...equinor, registrertIMvaregisteret: false });
    expect(company).toMatchObject({ vatRegistered: false, vatNumber: null });
    expect(clientPrefill(company!).vatNumber).toBe("");
  });

  it("warns about a bankrupt, winding-up or deleted company, without refusing it", () => {
    const company = parseCompany({
      ...equinor,
      konkurs: true,
      underAvvikling: true,
      underTvangsavviklingEllerTvangsopplosning: true,
      slettedato: "2025-01-02",
    });
    expect(company?.warnings).toEqual([
      "This company has been deleted from the register.",
      "This company is bankrupt.",
      "This company is being wound up.",
      "This company is being forcibly dissolved.",
    ]);
  });

  it("reads a sole proprietorship, whose name is a person's, like any other", () => {
    const company = parseCompany({
      organisasjonsnummer: "995849364",
      navn: "ANDRE GIÆVER",
      organisasjonsform: { kode: "ENK", beskrivelse: "Enkeltpersonforetak" },
      registrertIMvaregisteret: true,
      forretningsadresse: { adresse: ["Skanselien 37"], postnummer: "5034", poststed: "BERGEN" },
    });
    expect(company).toMatchObject({ organisationForm: "ENK", name: "Andre Giæver" });
  });

  it("refuses anything that is not a company answer", () => {
    for (const bad of [
      null,
      undefined,
      "text",
      5,
      [],
      {},
      { organisasjonsnummer: "12" },
      { organisasjonsnummer: "923609016" },
    ]) {
      expect(parseCompany(bad)).toBeNull();
    }
  });

  it("takes a website only if it looks like one, never as markup", () => {
    expect(parseCompany({ ...equinor, hjemmeside: "javascript:alert(1)" })?.website).toBeNull();
    expect(parseCompany({ ...equinor, hjemmeside: "<b>x</b>" })?.website).toBeNull();
    expect(parseCompany({ ...equinor, hjemmeside: "https://equinor.com" })?.website).toBe("https://equinor.com");
  });
});

describe("a name search", () => {
  const answer = {
    _embedded: {
      enheter: [
        {
          organisasjonsnummer: "915262341",
          navn: "MAGNAT KAFFEHUS AS",
          organisasjonsform: { kode: "AS" },
          forretningsadresse: { poststed: "OSLO" },
        },
        {
          organisasjonsnummer: "996995305",
          navn: "ROGALAND KAFFEHUS AS",
          organisasjonsform: { kode: "AS" },
          postadresse: { poststed: "SANDNES" },
        },
        { organisasjonsnummer: "bad", navn: "NO NUMBER" },
        { organisasjonsnummer: "923714715", navn: "" },
      ],
    },
    page: { totalElements: 12 },
  };

  it("lists the companies found, with where they are, and skips what is not one", () => {
    expect(parseHits(answer)).toEqual([
      { organisationNumber: "915262341", legalName: "MAGNAT KAFFEHUS AS", organisationForm: "AS", place: "Oslo" },
      { organisationNumber: "996995305", legalName: "ROGALAND KAFFEHUS AS", organisationForm: "AS", place: "Sandnes" },
    ]);
  });

  it("caps the list and copes with nothing found", () => {
    expect(parseHits(answer, 1)).toHaveLength(1);
    expect(parseHits({ page: { totalElements: 0 } })).toEqual([]);
    expect(parseHits(null)).toEqual([]);
  });
});
