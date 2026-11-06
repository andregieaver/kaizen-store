import { describe, expect, it } from "vitest";

import { base32, participantIdentifier, participantOf, serviceUrl, smlName, smpUrlOf, type NaptrRecord } from "./peppol";

const naptr = (regexp: string, extra: Partial<NaptrRecord> = {}): NaptrRecord => ({ flags: "U", service: "Meta:SMP", regexp, replacement: "", order: 100, preference: 10, ...extra });

describe("a business on Peppol", () => {
  it("is its country's scheme and its organisation number, checked", () => {
    expect(participantOf("NO", "923 609 016")).toBe("0192:923609016");
    expect(participantOf("no", "NO984851006MVA")).toBe("0192:984851006");
    expect(participantOf("SE", "556036-0793")).toBe("0007:5560360793");
    expect(participantOf("DK", "DK 10150817")).toBe("0184:10150817");
  });

  it("is nobody without a scheme for its country, a number of the right length or, in Norway, the right check digit", () => {
    expect(participantOf("DE", "123456789")).toBeNull();
    expect(participantOf("NO", "12345678")).toBeNull();
    expect(participantOf("NO", "923609017")).toBeNull();
    expect(participantOf(null, "923609016")).toBeNull();
    expect(participantOf("NO", null)).toBeNull();
    expect(participantIdentifier("0192:923609016")).toBe("iso6523-actorid-upis::0192:923609016");
  });
});

describe("the SML's DNS name", () => {
  it("is base32 of the SHA-256 of the lowercased value, without padding (the migration process's own example)", () => {
    expect(smlName("0088:123abc")).toBe("Y7DZFXAF3D4CJZ4KCGRXTEC6TWVCGA4KY7ZWA5BOIF6MSWD4TDRQ.iso6523-actorid-upis.edelivery.tech.ec.europa.eu");
    expect(smlName("0088:123ABC")).toBe(smlName("0088:123abc"));
    expect(smlName("0192:923609016", "acc.edelivery.tech.ec.europa.eu")).toMatch(/^[A-Z2-7]{52}\.iso6523-actorid-upis\.acc\.edelivery\.tech\.ec\.europa\.eu$/);
  });

  it("encodes base32 as RFC 4648 does", () => {
    expect(base32(new TextEncoder().encode("foobar"))).toBe("MZXW6YTBOI");
    expect(base32(new TextEncoder().encode("f"))).toBe("MY");
  });
});

describe("the SMP's address", () => {
  it("is the regexp's replacement of the Meta:SMP record, the lowest order first", () => {
    expect(smpUrlOf([naptr("!^.*$!https://smp.example.org/!")])).toBe("https://smp.example.org");
    expect(
      smpUrlOf([naptr("!^.*$!https://second.example.org!", { order: 200 }), naptr("!^.*$!https://first.example.org/smp/!", { order: 100 })]),
    ).toBe("https://first.example.org/smp");
  });

  it("is none for another service, plain http, a query or a user", () => {
    expect(smpUrlOf([naptr("!^.*$!https://smp.example.org!", { service: "Meta:Other" })])).toBeNull();
    expect(smpUrlOf([naptr("!^.*$!http://smp.example.org!")])).toBeNull();
    expect(smpUrlOf([naptr("!^.*$!https://smp.example.org/?a=1!")])).toBeNull();
    expect(smpUrlOf([naptr("!^.*$!https://user:pw@smp.example.org!")])).toBeNull();
    expect(smpUrlOf([])).toBeNull();
  });

  it("asks for a document type by the participant's and the type's identifiers, encoded", () => {
    expect(serviceUrl("https://smp.example.org/", "0192:923609016", "invoice")).toBe(
      "https://smp.example.org/iso6523-actorid-upis%3A%3A0192%3A923609016/services/busdox-docid-qns%3A%3Aurn%3Aoasis%3Anames%3Aspecification%3Aubl%3Aschema%3Axsd%3AInvoice-2%3A%3AInvoice%23%23urn%3Acen.eu%3Aen16931%3A2017%23compliant%23urn%3Afdc%3Apeppol.eu%3A2017%3Apoacc%3Abilling%3A3.0%3A%3A2.1",
    );
  });
});
