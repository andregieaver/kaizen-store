import { describe, expect, it } from "vitest";

import { EMPTY_PASSPORT, passportInput, publishProblem, readPassport, recycledShare } from "./product-passport";
import { qrSvg } from "./qr";

describe("a product's passport (D554)", () => {
  it("takes what staff type and refuses materials over 100 % and addresses that are not https", () => {
    const ok = passportInput.safeParse({ materials: [{ name: "Cotton", percent: "60", recycledPercent: 50 }, { name: "Polyester", percent: 40, recycledPercent: 100 }], originCountry: "pt" });
    expect(ok.success && ok.data.originCountry).toBe("PT");
    expect(passportInput.safeParse({ materials: [{ name: "A", percent: 70 }, { name: "B", percent: 40 }] }).success).toBe(false);
    expect(passportInput.safeParse({ documents: [{ title: "Manual", url: "http://x.example" }] }).success).toBe(false);
    expect(passportInput.safeParse({ carbon: { kgCo2e: 3.2, method: "" } }).success).toBe(false);
  });

  it("works out the recycled share across the product", () => {
    const p = passportInput.parse({ materials: [{ name: "Cotton", percent: 60, recycledPercent: 50 }, { name: "Polyester", percent: 40, recycledPercent: 100 }] });
    expect(recycledShare(p)).toBe(70);
    expect(recycledShare(EMPTY_PASSPORT)).toBeNull();
  });

  it("asks for something before publishing, and reads a broken stored value as empty", () => {
    expect(publishProblem(EMPTY_PASSPORT)).not.toBeNull();
    expect(publishProblem({ ...EMPTY_PASSPORT, repair: "Spare zips are sold separately." })).toBeNull();
    expect(readPassport({ materials: "nonsense" })).toEqual(EMPTY_PASSPORT);
  });

  it("draws a scannable QR code as one path", () => {
    const svg = qrSvg("https://kaizenaflow.com/passport/5c2c8f0e-3a9d-4c7b-9e21-0d6f1a2b3c4d");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.match(/<path /g)).toHaveLength(1);
    expect(svg).toContain('fill="#fff"');
  });
});
