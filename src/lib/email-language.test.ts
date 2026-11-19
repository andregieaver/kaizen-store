import { describe, expect, it } from "vitest";

import { emailLanguage } from "./email-language";

describe("the language an email is written in (D332)", () => {
  it("knows Norwegian from English among the site's languages", () => {
    expect(emailLanguage("testing\n\nHei\n\nVil du svare på denne eposten?\n\n//André", ["en", "nb"])).toBe("nb");
    expect(emailLanguage("Vedr. Nettsider\n\nHei!\n\nHvor mange nettsider har jeg registrert hos dere?", ["en-GB", "nb-NO"])).toBe("nb");
    expect(emailLanguage("Hi, how many websites do I have with you?", ["en", "nb"])).toBe("en");
  });

  it("says nothing when it is not clear or the site has one language", () => {
    expect(emailLanguage("Test", ["en", "nb"])).toBeNull();
    expect(emailLanguage("Hei", ["en", "nb"])).toBeNull();
    expect(emailLanguage("Hvor mange nettsider har jeg?", ["nb"])).toBeNull();
    // A language the site does not offer is never chosen.
    expect(emailLanguage("Hej, hur många beställningar har jag?", ["en", "nb"])).not.toBe("sv");
  });

  it("tells Swedish and German apart where a store offers them", () => {
    expect(emailLanguage("Hej! Var är min beställning? Tack och hälsningar", ["sv", "de", "en"])).toBe("sv");
    expect(emailLanguage("Hallo, wo ist meine Bestellung? Danke und Grüße", ["sv", "de", "en"])).toBe("de");
  });
});
