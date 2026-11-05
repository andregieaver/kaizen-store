import { describe, expect, it } from "vitest";

import { nextPage, parseSenders, SENDCLOUD_API, sendcloudAuthorization, sendcloudHeaders, sendcloudProblem, senderLabel, senderProblem } from "./sendcloud";

/** The shape of `GET /api/v3/addresses/sender-addresses` (sendcloud.dev, read 5 November 2026). */
const answer = {
  data: [
    {
      id: 1,
      name: "Gerda Weber",
      company_name: "Gerdas Laden",
      address_line_1: "Hauptstraße",
      house_number: "12",
      address_line_2: "",
      postal_code: "10115",
      city: "Berlin",
      po_box: null,
      state_province_code: "",
      country_code: "DE",
      email: "gerda@example.com",
      phone_number: "+49301234567",
      signature: { full_name: "Gerda Weber", initials: "GW" },
      tax_numbers: [{ name: "VAT", country_code: "DE", value: "DE123456789" }],
    },
    { id: 2, name: "Warehouse", company_name: "", address_line_1: "Kade", house_number: "3", postal_code: "1011 AB", city: "Amsterdam", country_code: "nl" },
  ],
};

describe("Sendcloud's connection, the pure parts (D454)", () => {
  it("talks to API v3 with the shop's keys as Basic auth, and Flow's partner id only when there is one", () => {
    expect(SENDCLOUD_API).toBe("https://panel.sendcloud.sc/api/v3");
    expect(sendcloudAuthorization("pub", "sec")).toBe(`Basic ${Buffer.from("pub:sec").toString("base64")}`);
    expect(sendcloudHeaders({ publicKey: "pub", secretKey: "sec" }, null)).toEqual({ Authorization: sendcloudAuthorization("pub", "sec"), Accept: "application/json" });
    expect(sendcloudHeaders({ publicKey: "pub", secretKey: "sec" }, "0f0f0f0f-0000-4000-8000-000000000000")["Sendcloud-Partner-Id"]).toBe(
      "0f0f0f0f-0000-4000-8000-000000000000",
    );
  });

  it("reads the sender addresses as the admin offers them, in one line each", () => {
    expect(parseSenders(answer)).toEqual([
      { id: "1", label: "Gerdas Laden, Hauptstraße 12, 10115 Berlin, DE", country: "DE" },
      { id: "2", label: "Warehouse, Kade 3, 1011 AB Amsterdam, NL", country: "NL" },
    ]);
    expect(senderLabel({ name: "Only a name", country_code: "be" })).toBe("Only a name, BE");
  });

  it("leaves out an address without an id or a country, and refuses an answer that is not a list", () => {
    expect(parseSenders({ data: [{ id: "3", country_code: "DE" }, { id: 4 }, { id: 0, country_code: "DE" }, null] })).toEqual([]);
    expect(parseSenders({ data: [] })).toEqual([]);
    expect(parseSenders({ results: [] })).toBeNull();
    expect(parseSenders(null)).toBeNull();
  });

  it("follows the next page only on Sendcloud's own host over https", () => {
    const next = `${SENDCLOUD_API}/addresses/sender-addresses?cursor=cj0xJnA9MzAw&page_size=100`;
    expect(nextPage(`<${next}>; rel="next", <${SENDCLOUD_API}/addresses/sender-addresses?cursor=x>; rel="prev"`)).toBe(next);
    expect(nextPage(`<${SENDCLOUD_API}/x>; rel="prev"`)).toBeNull();
    expect(nextPage('<https://evil.example/steal>; rel="next"')).toBeNull();
    expect(nextPage('<http://panel.sendcloud.sc/api/v3/x>; rel="next"')).toBeNull();
    expect(nextPage("<not a url>; rel=next")).toBeNull();
    expect(nextPage(null)).toBeNull();
  });

  it("says plainly why Sendcloud refused, by status first and in its own words when it gave some", () => {
    expect(sendcloudProblem(401)).toMatch(/did not accept these keys/);
    expect(sendcloudProblem(403)).toMatch(/plan includes the API/);
    expect(sendcloudProblem(429)).toMatch(/busy/);
    expect(sendcloudProblem(502)).toMatch(/on its side/);
    expect(sendcloudProblem(400, { errors: [{ status: 400, code: "invalid", detail: "Postal code is invalid." }] })).toBe("Sendcloud said: Postal code is invalid.");
    expect(sendcloudProblem(404, { errors: [{ status: "404", code: "not_found" }] })).toBe("Sendcloud said: not_found");
    expect(sendcloudProblem(400, "<html>")).toBe("Sendcloud refused the request (status 400).");
  });

  it("knows whether the store's chosen sender address is still in its Sendcloud account", () => {
    const senders = parseSenders(answer)!;
    expect(senderProblem(senders, "2")).toBeNull();
    expect(senderProblem(senders, undefined)).toMatch(/choose the sender address/);
    expect(senderProblem(senders, "9")).toMatch(/no longer in your Sendcloud account/);
    expect(senderProblem([], "1")).toMatch(/no sender address yet/);
  });
});
