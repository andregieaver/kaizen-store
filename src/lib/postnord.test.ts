import { describe, expect, it } from "vitest";

import {
  applicationIdOf,
  basicServiceCode,
  bookingProblems,
  ediBody,
  ediLabelsUrl,
  issuerCode,
  labelAddress,
  messageIdOf,
  parseBooking,
  parsePickup,
  parseServicePoints,
  parseTracking,
  pickupBody,
  postnordError,
  postnordHost,
  postnordProblem,
  postnordService,
  returnBody,
  servicePointsUrl,
  smsNumber,
  trackingUrl,
} from "./postnord";

// The answers below are written as PostNord's documentation describes its Business Location v5 and Track and Trace v5 answers.
const servicePoints = {
  servicePointInformationResponse: {
    servicePoints: [
      {
        servicePointId: "NO-1001",
        name: "Kiwi Sentrum",
        routeDistance: 320,
        visitingAddress: { streetName: "Storgata", streetNumber: "9", postalCode: "0155", city: "OSLO", countryCode: "NO" },
        deliveryAddress: { streetName: "Postboks", streetNumber: "1", postalCode: "0001", city: "OSLO", countryCode: "NO" },
        openingHours: [
          { day: "MO", from1: "0900", to1: "1800" },
          { day: "TU", from1: "0900", to1: "1800" },
        ],
      },
      { servicePointId: "NO-1002", name: "Joker", distance: "1400", deliveryAddress: { streetName: "Lillegata", postalCode: "0156", city: "OSLO", countryCode: "NO" } },
      { name: "No id" },
    ],
  },
};

describe("PostNord's hosts and addresses", () => {
  it("uses the sandbox unless the store is live", () => {
    expect(postnordHost("live")).toBe("https://api2.postnord.com");
    expect(postnordHost("test")).toBe("https://atapi2.postnord.com");
  });

  it("builds the service point search and the tracking address with the key as apikey", () => {
    const url = new URL(servicePointsUrl("https://api2.postnord.com", "k e y", "no", "0150", 3));
    expect(url.pathname).toBe("/rest/businesslocation/v5/servicepoints/nearest/byaddress");
    expect(Object.fromEntries(url.searchParams)).toEqual({ apikey: "k e y", returnType: "json", countryCode: "NO", postalCode: "0150", numberOfServicePoints: "3" });
    const track = new URL(trackingUrl("https://atapi2.postnord.com", "key", "84971563697SE"));
    expect(track.pathname).toBe("/rest/shipment/v5/trackandtrace/findByIdentifier.json");
    expect(track.searchParams.get("id")).toBe("84971563697SE");
  });

  it("knows its services by PostNord's own codes: 19 MyPack Collect to a service point, 17 MyPack Home, 18 Parcel", () => {
    expect(postnordService("19")).toMatchObject({ name: "PostNord MyPack Collect", needsPickupPoint: true });
    expect(postnordService("17")).toMatchObject({ name: "PostNord MyPack Home", needsPickupPoint: false });
    expect(postnordService("18")).toMatchObject({ name: "PostNord Parcel", needsPickupPoint: false });
    expect(postnordService("999")).toBeNull();
  });
});

describe("service points", () => {
  it("are read with their address, distance and opening hours, and those without an id are left out", () => {
    const points = parseServicePoints(servicePoints);
    expect(points.map((p) => p.id)).toEqual(["NO-1001", "NO-1002"]);
    expect(points[0]).toEqual({
      id: "NO-1001",
      name: "Kiwi Sentrum",
      address: { name: "Kiwi Sentrum", street: "Storgata 9", postalCode: "0155", city: "OSLO", country: "NO" },
      openingHours: "Mon 09:00–18:00, Tue 09:00–18:00",
      distanceMeters: 320,
    });
    // The delivery address stands in when there is no visiting address; distance may be given as text.
    expect(points[1]).toMatchObject({ address: { street: "Lillegata", postalCode: "0156" }, distanceMeters: 1400 });
  });

  it("are none when the answer is empty or not what was expected", () => {
    expect(parseServicePoints(null)).toEqual([]);
    expect(parseServicePoints({ servicePointInformationResponse: {} })).toEqual([]);
    expect(parseServicePoints({ servicePoints: [{ servicePointId: "x", name: "Direct" }] })).toHaveLength(1);
  });
});

describe("tracking", () => {
  const answer = {
    TrackingInformationResponse: {
      shipments: [
        {
          items: [
            {
              events: [
                { eventTime: "2026-10-01T09:00:00", eventCode: "EN_ROUTE", eventDescription: "The parcel is on its way", location: { displayName: "Oslo terminal" } },
                { eventTime: "2026-10-02T08:30:00", eventCode: "DELIVERED", eventDescription: "Delivered", location: { city: "Bergen" } },
                { eventDescription: "No time" },
              ],
            },
          ],
        },
      ],
    },
  };

  it("lists events newest first, with where they were", () => {
    expect(parseTracking(answer)).toEqual([
      { at: "2026-10-02T08:30:00", status: "DELIVERED", description: "Delivered", location: "Bergen" },
      { at: "2026-10-01T09:00:00", status: "EN_ROUTE", description: "The parcel is on its way", location: "Oslo terminal" },
    ]);
  });

  it("has none for a number PostNord does not know", () => {
    expect(parseTracking({ TrackingInformationResponse: { shipments: [] } })).toEqual([]);
    expect(parseTracking("nonsense")).toEqual([]);
  });
});

describe("what to tell the owner", () => {
  it("is plain for each kind of failure", () => {
    expect(postnordProblem(403)).toMatch(/API key/);
    expect(postnordProblem(429)).toMatch(/slow down/);
    expect(postnordProblem(503)).toMatch(/not answering/);
    expect(postnordProblem(400)).toContain("400");
  });

  it("says what PostNord objected to, from a fault, a gateway error or a refused parcel", () => {
    const fault = { compositeFault: { faults: [{ faultCode: "API-400", explanationText: "Invalid postalCode for consignee" }] } };
    expect(postnordError(fault)).toBe("Invalid postalCode for consignee");
    expect(postnordError({ servicePointInformationResponse: fault })).toBe("Invalid postalCode for consignee");
    expect(postnordError({ error: { status_code: 403, message: "Invalid API Key" } })).toBe("Invalid API Key");
    expect(postnordProblem(400, fault)).toBe("PostNord did not accept the request: Invalid postalCode for consignee");
  });
});

const from = { name: "Butikk AS", street: "Akersgata 55", postalCode: "0180", city: "Oslo", country: "NO", phone: "22334455", email: "post@butikk.no" };
const to = { name: "Anna Svensson", street: "Upplandsgatan 42", postalCode: "113 27", city: "Stockholm", country: "SE", phone: "070-123 45 67", email: "anna@example.com" };
const now = new Date("2026-11-05T10:00:00Z");
const request = { orderReference: "1042", parcelReference: "1042-2", serviceId: "17", from, to, parcels: [{ weightGrams: 1730, lengthMm: 300, widthMm: 200, heightMm: 100 }] };
type Shipment = { service: unknown; parties: Record<string, unknown>; goodsItem: unknown; references: unknown; customsDeclarationCN23?: unknown; termsOfDelivery?: unknown; totalGrossWeight: unknown };
const shipmentOf = (body: Record<string, unknown>) => (body.shipment as Shipment[])[0];

describe("booking (Booking APIs v3)", () => {
  it("names the PostNord organisation of the customer number, and writes phone numbers with the country's code", () => {
    expect([issuerCode("dk"), issuerCode("SE"), issuerCode("NO"), issuerCode("FI"), issuerCode("DE")]).toEqual(["Z11", "Z12", "Z13", "Z14", null]);
    expect(smsNumber("070-123 45 67", "SE")).toBe("+46701234567");
    expect(smsNumber("0047 22334455", "NO")).toBe("+4722334455");
    expect(smsNumber("+4571111199", "SE")).toBe("+4571111199");
    expect(smsNumber("", "SE")).toBe("");
  });

  it("uses the store's application id, PostNord's example id in test, and none in live without one", () => {
    expect(applicationIdOf({ applicationId: "1438" }, "live")).toBe("1438");
    expect(applicationIdOf({}, "test")).toBe("9999");
    expect(applicationIdOf({ applicationId: "abc" }, "live")).toBeNull();
  });

  it("books a service point as MyPack Collect whichever code the order kept, and a code-19 order without a point as MyPack Home", () => {
    expect(basicServiceCode("19", "SP1")).toBe("19");
    expect(basicServiceCode("17", "SP1")).toBe("19");
    expect(basicServiceCode("19", null)).toBe("17");
    expect(basicServiceCode("17", null)).toBe("17");
    expect(basicServiceCode("18", undefined)).toBe("18");
  });

  it("writes MyPack Home as PostNord's example does: the consignor with the customer number, the recipient with email and SMS", () => {
    const { body, customs } = ediBody(request, { customerNumber: " 1111111111 ", applicationId: "9999", now });
    expect(customs).toBeNull();
    expect(body).toMatchObject({ messageDate: "2026-11-05T10:00:00.000Z", messageFunction: "Instruction", updateIndicator: "Original", application: { applicationId: 9999, name: "Kaizena Flow" } });
    expect(String(body.messageId).length).toBeLessThanOrEqual(14);
    const shipment = shipmentOf(body);
    expect(shipment.service).toEqual({ basicServiceCode: "17" });
    expect(shipment.references).toEqual([{ referenceNo: "1042", referenceType: "CU" }]);
    expect(shipment.totalGrossWeight).toEqual({ value: 1.73, unit: "KGM" });
    expect(shipment.parties).toEqual({
      consignor: {
        issuerCode: "Z13",
        partyIdentification: { partyId: "1111111111", partyIdType: "160" },
        party: {
          nameIdentification: { name: "Butikk AS" },
          address: { streets: ["Akersgata 55"], postalCode: "0180", city: "Oslo", countryCode: "NO" },
          contact: { contactName: "Butikk AS", emailAddress: "post@butikk.no", phoneNo: "+4722334455", smsNo: "+4722334455" },
        },
      },
      consignee: {
        party: {
          nameIdentification: { name: "Anna Svensson" },
          address: { streets: ["Upplandsgatan 42"], postalCode: "11327", city: "Stockholm", countryCode: "SE" },
          contact: { contactName: "Anna Svensson", emailAddress: "anna@example.com", phoneNo: "+46701234567", smsNo: "+46701234567" },
        },
      },
    });
    expect(shipment.goodsItem).toEqual([
      {
        packageTypeCode: "PC",
        items: [
          {
            itemIdentification: { itemId: "0", itemIdType: "SSCC" },
            dimensions: { height: { value: 10, unit: "CMT" }, width: { value: 20, unit: "CMT" }, length: { value: 30, unit: "CMT" } },
            grossWeight: { value: 1.73, unit: "KGM" },
          },
        ],
      },
    ]);
  });

  it("delivers MyPack Collect to the shopper's service point as the delivery party, with the optional service point add-on", () => {
    const point = { id: "588462", name: "Hemköp Sjövikshallen", address: { name: "Hemköp Sjövikshallen", street: "Sjövikstorget 17", postalCode: "11758", city: "STOCKHOLM", country: "SE" } };
    const shipment = shipmentOf(ediBody({ ...request, serviceId: "19", pickupPointId: "588462" }, { customerNumber: "1111111111", applicationId: "9999", servicePoint: point, now }).body);
    expect(shipment.service).toEqual({ basicServiceCode: "19", additionalServiceCode: ["A7"] });
    expect(shipment.parties.deliveryParty).toEqual({
      partyIdentification: { partyId: "588462", partyIdType: "156" },
      party: { nameIdentification: { name: "Hemköp Sjövikshallen" }, address: { streets: ["Sjövikstorget 17"], postalCode: "11758", city: "STOCKHOLM", countryCode: "SE" } },
    });
  });

  it("declares a parcel through customs on CN23 with up to five lines, and leaves more to PostNord's own tools", () => {
    const line = { hsCode: "61091000", origin: "PT", valueMinor: 39800, description: "T-shirt", quantity: 2, weightGrams: 400 };
    const customs = { incoterm: "DDP" as const, currency: "NOK", invoiceNumber: "F-77", invoiceDate: "2026-11-05", lines: [line] };
    const declared = ediBody({ ...request, customs }, { customerNumber: "1", applicationId: "9999", now });
    expect(declared.customs).toEqual({ declared: true, problem: null });
    const shipment = shipmentOf(declared.body);
    expect(shipment.termsOfDelivery).toEqual({ todConditionCode: "DDP", todConditionCodeList: "INCOTERMS" });
    expect(shipment.customsDeclarationCN23).toEqual({
      categoryOfItem: { categoryType: ["SALE OF GOODS"] },
      detailedDescription: [{ content: "T-shirt", quantity: { value: 2 }, grossWeight: { value: 0.4, unit: "KGM" }, value: { amount: 199, currency: "NOK" }, hsTariffNumber: "61091000", countryCode: "PT", rowNo: 1 }],
      totalGrossWeight: { value: 0.4, unit: "KGM" },
      totalValue: { amount: 398, currency: "NOK" },
    });
    const many = ediBody({ ...request, customs: { ...customs, lines: Array.from({ length: 6 }, () => line) } }, { customerNumber: "1", applicationId: "9999", now });
    expect(many.customs).toMatchObject({ declared: false, problem: expect.stringMatching(/at most 5 customs lines/) });
    expect(shipmentOf(many.body).customsDeclarationCN23).toBeUndefined();
  });

  it("says what is missing before calling PostNord", () => {
    const ok = { customerNumber: "1111111111", applicationId: "9999" };
    expect(bookingProblems(request, ok)).toEqual([]);
    expect(bookingProblems(request, { ...ok, applicationId: null })[0]).toMatch(/application id/);
    expect(bookingProblems({ ...request, from: { ...from, country: "DE" } }, ok)[0]).toMatch(/sender's country/);
    expect(bookingProblems({ ...request, to: { ...to, email: undefined, phone: undefined } }, ok)[0]).toMatch(/email or phone/);
    expect(bookingProblems(request, { ...ok, customerNumber: "" })[0]).toMatch(/customer number/);
  });

  it("asks for the label as one PDF on label-sized pages, not stored by PostNord", () => {
    const url = new URL(ediLabelsUrl("https://atapi2.postnord.com", "KEY"));
    expect(url.pathname).toBe("/rest/shipment/v3/edi/labels/pdf");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ apikey: "KEY", paperSize: "LABEL", multiPDF: "true", labelType: "standard", storeLabel: "false", processOffline: "false" });
  });

  it("reads the parcel's item id, the booking id, PostNord's tracking page and the PDF label from the answer", () => {
    const pdf = Buffer.from("%PDF-1.4 postnord").toString("base64");
    const answer = {
      bookingResponse: {
        bookingId: "0BQAS89SM5ZQ5K56U48IJXDZ8SGYFB",
        idInformation: [{ status: "OK", ids: [{ idType: "itemId", value: "00373501093057988987" }], urls: [{ type: "TRACKING", url: "https://attracking.postnord.com/se/?id=00373501093057988987" }] }],
      },
      labelPrintout: [{ itemIds: [{ itemIds: "00373501093057988987", status: "OK" }], printout: { labelFormat: "PDF", encoding: "base64", data: pdf } }],
    };
    const parsed = parseBooking(answer);
    expect(parsed.ok && { ...parsed, label: Buffer.from(parsed.label!).toString() }).toEqual({
      ok: true,
      itemId: "00373501093057988987",
      bookingId: "0BQAS89SM5ZQ5K56U48IJXDZ8SGYFB",
      trackingUrl: "https://attracking.postnord.com/se/?id=00373501093057988987",
      label: "%PDF-1.4 postnord",
    });
    // The plain EDI call answers without `bookingResponse` or a label; a tracking address elsewhere is not kept.
    expect(parseBooking({ bookingId: "B", idInformation: [{ status: "OK", ids: [{ idType: "itemId", value: "1" }], urls: [{ type: "TRACKING", url: "https://evil.example/" }] }] })).toEqual({ ok: true, itemId: "1", bookingId: "B", trackingUrl: null, label: null });
    expect(parseBooking({ bookingResponse: { idInformation: [{ status: "ERROR", message: "Invalid service point" }] } })).toEqual({ ok: false, problem: "PostNord did not accept the parcel: Invalid service point" });
    expect(parseBooking({})).toMatchObject({ ok: false });
    expect(labelAddress("https://api2.postnord.com", "00373501093057988987")).toBe("https://api2.postnord.com/rest/shipment/v3/labels/ids/pdf#00373501093057988987");
    expect(messageIdOf("1042-2", now)).toMatch(/^kf[0-9a-z]{1,8}0422$/);
  });
});

describe("return labels (Return Drop Off, 24)", () => {
  const ret = { returnReference: "1042-R1", serviceId: "24", from: to, to: from, parcels: [{ weightGrams: 900 }] };

  it("puts the customer number on the shopper who hands the parcel in, with their contact for PostNord's notices", () => {
    const body = returnBody(ret, { customerNumber: "1111111111", applicationId: "9999", storeCountry: "NO", now });
    const shipment = shipmentOf(body as unknown as Record<string, unknown>);
    expect(shipment.service).toEqual({ basicServiceCode: "24" });
    expect(shipment.parties.consignor).toMatchObject({ issuerCode: "Z13", partyIdentification: { partyId: "1111111111", partyIdType: "160" }, party: { nameIdentification: { name: "Anna Svensson" }, contact: { smsNo: "+46701234567" } } });
    expect(shipment.parties.consignee).toEqual({ party: expect.objectContaining({ nameIdentification: { name: "Butikk AS" } }) });
  });

  it("puts it on the store instead for a parcel handed in in Norway, as PostNord's guide says", () => {
    const shipment = shipmentOf(returnBody({ ...ret, from: { ...to, country: "NO", postalCode: "0566", city: "Oslo" } }, { customerNumber: "1", applicationId: "9999", storeCountry: "NO", now }) as unknown as Record<string, unknown>);
    expect(shipment.parties.consignor).not.toHaveProperty("partyIdentification");
    expect(shipment.parties.consignee).toMatchObject({ issuerCode: "Z13", partyIdentification: { partyId: "1", partyIdType: "160" } });
  });
});

describe("pickups", () => {
  it("asks for a pickup at the sender's business address in the window the parcel is ready, in the sender's own time", () => {
    const body = pickupBody({ ...request, from: { ...from, country: "SE" }, collection: { date: "2026-11-06", readyTime: "10:00", closeTime: "16:00" } }, { customerNumber: "1111111111", applicationId: "9999", now });
    expect(body).toMatchObject({ messageFunction: "PickupBooking", messageId: "pu10422" });
    const shipment = shipmentOf(body as unknown as Record<string, unknown>) as Shipment & { dateAndTimes: unknown; freeText: unknown };
    expect(shipment.dateAndTimes).toEqual({ earliestPickupDate: "2026-11-06T09:00:00.000Z", latestPickupDate: "2026-11-06T15:00:00.000Z" });
    expect(shipment.service).toEqual({ basicServiceCode: "0", additionalServiceCode: ["p1"] });
    expect(shipment.freeText).toEqual([{ usageCode: "ADS", text: "Order 1042" }]);
    expect(shipment.parties.consignor).toMatchObject({ issuerCode: "Z12", party: { contact: { emailAddress: "post@butikk.no" } } });
  });

  it("reads the pickup id PostNord gave", () => {
    expect(parsePickup({ bookingId: "B", idInformation: [{ status: "OK", ids: [{ idType: "pickupId", value: "CR511599F" }] }] })).toBe("CR511599F");
    expect(parsePickup({ idInformation: [{ status: "ERROR" }] })).toBeNull();
  });
});
