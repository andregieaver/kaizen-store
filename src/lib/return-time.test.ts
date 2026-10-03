import { describe, expect, it } from "vitest";

import { formatDeclaration, formatStoreDay, utcOffset } from "./return-time";

describe("the moment of a declaration", () => {
  it("gives the offset of the store's zone, winter and summer", () => {
    expect(utcOffset("2026-01-15T12:00:00Z", "Europe/Oslo")).toBe("UTC+01:00");
    expect(utcOffset("2026-07-15T12:00:00Z", "Europe/Oslo")).toBe("UTC+02:00");
    expect(utcOffset("2026-07-15T12:00:00Z", "UTC")).toBe("UTC+00:00");
    expect(utcOffset("2026-01-15T12:00:00Z", "America/St_Johns")).toBe("UTC-03:30");
  });

  it("writes the date and time in the store's zone with the offset and the zone's name", () => {
    const text = formatDeclaration("2026-10-02T20:30:00Z", "en-GB", "Europe/Oslo");
    expect(text).toContain("2 October 2026");
    expect(text).toContain("22:30");
    expect(text).toContain("(UTC+02:00, Europe/Oslo)");
  });

  it("falls back to English for a locale it does not know", () => {
    expect(formatDeclaration("2026-10-02T20:30:00Z", "xx-invalid-@", "Europe/Oslo")).toContain("October");
  });

  it("writes a store day long", () => {
    expect(formatStoreDay("2026-10-16", "en-GB")).toBe("16 October 2026");
    expect(formatStoreDay("2026-10-16", "nb-NO")).toBe("16. oktober 2026");
  });
});
