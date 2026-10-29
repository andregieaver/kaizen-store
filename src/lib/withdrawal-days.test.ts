import { describe, expect, it } from "vitest";

import { closedDays, easterSunday, lastWorkingDay, movesOff } from "./withdrawal-days";

describe("Easter", () => {
  it("falls where the calendars say", () => {
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
    expect(easterSunday(2024)).toBe("2024-03-31");
  });
});

describe("the last day of the withdrawal period (D407 step 5)", () => {
  it("moves off a weekend to the Monday in the EU (Reg. 1182/71 Art. 3(4))", () => {
    expect(lastWorkingDay("2026-10-31", "DE")).toBe("2026-11-02"); // a Saturday
    expect(lastWorkingDay("2026-11-01", "FR")).toBe("2026-11-02"); // a Sunday
    expect(lastWorkingDay("2026-11-03", "DE")).toBe("2026-11-03"); // a Tuesday stays
  });

  it("moves off Denmark's days: Easter, Constitution Day, Christmas Eve and New Year's Eve", () => {
    // Maundy Thursday 2 April 2026 to Tuesday 7 April, past Good Friday, the weekend and Easter Monday.
    expect(lastWorkingDay("2026-04-02", "DK")).toBe("2026-04-07");
    expect(lastWorkingDay("2026-06-05", "DK")).toBe("2026-06-08"); // Friday, Constitution Day
    expect(lastWorkingDay("2026-12-24", "DK")).toBe("2026-12-28");
    expect(lastWorkingDay("2026-12-31", "DK")).toBe("2027-01-04");
    // Store Bededag (the fourth Friday after Easter) is a working day again from 2024.
    expect(movesOff("2026-05-01", "DK")).toBe(false);
  });

  it("moves off Sweden's days: Midsummer Eve, National Day, Epiphany and the eves", () => {
    expect(lastWorkingDay("2026-06-19", "SE")).toBe("2026-06-22"); // Midsummer Eve, a Friday
    expect(closedDays("SE", 2027).has("2027-06-25")).toBe(true); // Midsummer Eve 2027
    expect(movesOff("2026-01-06", "SE")).toBe(true);
    expect(movesOff("2026-05-01", "SE")).toBe(true);
    expect(lastWorkingDay("2026-12-24", "SE")).toBe("2026-12-28");
  });

  it("leaves Norway and countries outside the EU as they are", () => {
    expect(lastWorkingDay("2026-10-31", "NO")).toBe("2026-10-31");
    expect(lastWorkingDay("2026-10-31", null)).toBe("2026-10-31");
  });
});
