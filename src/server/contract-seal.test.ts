import { createHash } from "node:crypto";

import forge from "node-forge";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ db: () => ({}) }));

const { appendPages, makeSeal, sealPdf } = await import("./contract-seal");

/**
 * The seal on a signed contract (D695 step 3): a self-made certificate for signing documents, a PAdES signature over the whole file whose
 * digest is the file's own bytes outside the signature, so a change anywhere breaks it; and the signing record's pages appended after the
 * contract's.
 */

async function onePage(text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  page.drawText(text, { x: 50, y: 780, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
  return doc.save();
}

/** A DER value's whole length in bytes, from its tag and length bytes (short form, or long form with the count of length bytes). */
function derLength(bytes: string): number {
  const first = bytes.charCodeAt(1);
  if (first < 0x80) return 2 + first;
  const count = first & 0x7f;
  let length = 0;
  for (let i = 0; i < count; i++) length = length * 256 + bytes.charCodeAt(2 + i);
  return 2 + count + length;
}

/** The signed bytes and the signature of a sealed PDF, read as a reader does: by its /ByteRange. */
function signatureOf(pdf: Uint8Array) {
  const text = Buffer.from(pdf).toString("latin1");
  const range = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(text);
  if (!range) throw new Error("no /ByteRange");
  const [a, b, c, d] = range.slice(1).map(Number);
  const signed = Buffer.concat([Buffer.from(pdf.subarray(a, a + b)), Buffer.from(pdf.subarray(c, c + d))]);
  // The signature is DER in a placeholder padded with zeros: read it by its own length, never by stripping zeros, which would cut a
  // signature that happens to end in a zero digit (one run in sixteen, as the seal's key is new each run).
  const padded = forge.util.hexToBytes(text.slice(a + b + 1, c - 1));
  const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(padded.slice(0, derLength(padded)))) as forge.pkcs7.PkcsSignedData & {
    rawCapture: { authenticatedAttributes: forge.asn1.Asn1[] };
  };
  const digestAttr = p7.rawCapture.authenticatedAttributes.find((attr) => forge.asn1.derToOid((attr.value as forge.asn1.Asn1[])[0].value as string) === forge.pki.oids.messageDigest);
  const digest = ((digestAttr!.value as forge.asn1.Asn1[])[1].value as forge.asn1.Asn1[])[0].value as string;
  return { signed, digest: Buffer.from(digest, "binary").toString("hex"), cert: p7.certificates[0] };
}

describe("the platform's seal", () => {
  const seal = makeSeal(new Date("2026-11-17T00:00:00Z"));

  it("is a certificate for signing documents, Kaizena Flow's own, for ten years", () => {
    const cert = forge.pki.certificateFromPem(seal.certificatePem);
    expect(cert.subject.getField("CN").value).toBe("Kaizena Flow contract seal");
    expect(cert.validity.notAfter.getUTCFullYear()).toBe(2036);
    expect((cert.getExtension("keyUsage") as { digitalSignature: boolean }).digitalSignature).toBe(true);
    expect(seal.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("seals the whole file: the signature's digest is the file outside it, and a changed byte no longer matches", async () => {
    const pdf = await appendPages(await onePage("The contract"), await onePage("The signing record"));
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(2);
    const sealed = await sealPdf(pdf, seal, { reason: "Signed by all parties", location: "Norway", signingTime: new Date("2026-11-17T10:00:00Z") });
    const { signed, digest, cert } = signatureOf(sealed);
    expect(createHash("sha256").update(signed).digest("hex")).toBe(digest);
    expect(forge.pki.certificateToPem(cert)).toBe(seal.certificatePem);

    const tampered = Buffer.from(signed);
    tampered[200] = tampered[200] ^ 1;
    expect(createHash("sha256").update(tampered).digest("hex")).not.toBe(digest);
    expect((await PDFDocument.load(sealed)).getPageCount()).toBe(2);
  }, 60_000);
});
