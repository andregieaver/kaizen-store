import { describe, expect, it } from "vitest";

import { FILED_TEXT_MAX, filedText, forwardedAddresses, participantsOf } from "./filed-email";
import { routeOf } from "./inbound-email";

describe("a mail copied or forwarded to a store's filing address", () => {
  it("is routed by its bcc address beside the desk's and the reply addresses", () => {
    expect(routeOf(["Lisa <lisa@shop.no>", "bcc-abcdefghijkl12@in.example.com"], "in.example.com")).toEqual({ kind: "filing", key: "abcdefghijkl12" });
    expect(routeOf(["desk-abcdefghijkl12@in.example.com"], "in.example.com")).toEqual({ kind: "desk", key: "abcdefghijkl12" });
    expect(routeOf(["bcc-short@in.example.com"], "in.example.com")).toBeNull();
  });

  it("is about the addresses its forwarded headers name, in English and Norwegian", () => {
    const text = [
      "See below.",
      "",
      "---------- Forwarded message ---------",
      "From: Kari Nordmann <Kari@Kunde.no>",
      "Date: Thu, 5 Nov 2026",
      "To: Lisa <lisa@shop.no>",
      "Cc: ola@kunde.no; per@kunde.no",
      "",
      "> Fra: Ingrid Berg <ingrid@annen.no>",
      "> Til: kari@kunde.no",
    ].join("\n");
    expect(forwardedAddresses(text)).toEqual(["kari@kunde.no", "lisa@shop.no", "ola@kunde.no", "per@kunde.no", "ingrid@annen.no"]);
  });

  it("is about everyone it went to and its forwarded people, less the team and the receiving domain", () => {
    const people = participantsOf(
      { from: "Lisa <lisa@shop.no>", to: ["Kari <kari@kunde.no>"], cc: ["bcc-abcdefghijkl12@in.example.com", "ola@kunde.no"], text: "From: Ingrid <ingrid@annen.no>" },
      { team: new Set(["lisa@shop.no"]), domain: "in.example.com" },
    );
    expect(people).toEqual(["kari@kunde.no", "ola@kunde.no", "ingrid@annen.no"]);
  });

  it("keeps its words whole, forwarded part and all, as text from HTML when it has no text part, and cut to the most kept", () => {
    expect(filedText({ text: "Hi Kari,\r\n\r\n\r\n\r\nthanks.\n\n> earlier words", html: null })).toEqual({ text: "Hi Kari,\n\nthanks.\n\n> earlier words", cut: false });
    expect(filedText({ text: null, html: "<p>Hello <b>Kari</b></p>" }).text).toContain("Hello Kari");
    expect(filedText({ text: "x".repeat(FILED_TEXT_MAX + 5), html: null })).toMatchObject({ cut: true });
  });
});
