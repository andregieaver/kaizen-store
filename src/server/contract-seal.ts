import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import signpdf from "@signpdf/signpdf";
import { P12Signer } from "@signpdf/signer-p12";
import { sql } from "drizzle-orm";
import forge from "node-forge";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";

import { db } from "@/db/client";
import { decryptSecret, encryptSecret, parseKey } from "@/lib/secret-box";

import { col, typedRow } from "./typed-rows";

/**
 * Kaizena Flow's seal on a signed contract (D695 step 3, `docs/contracts.md` 5): a PAdES signature over the whole file with a certificate
 * of its own, so a PDF reader shows the file unchanged since it was sealed (and its signer as not on the reader's trusted list: the
 * owner's choice of 17 November 2026, until a trusted provider's certificate comes with BankID). The certificate and its key are made on
 * first use and kept in `commerce.contract_seals`, the key encrypted with `SETTINGS_ENCRYPTION_KEY`; no new secret is needed.
 */

export type Seal = { certificatePem: string; keyPem: string; fingerprint: string };

const sealRow = z.object({ certificate_pem: col.text, key_encrypted: col.text, fingerprint: col.text });
const settingsKey = () => parseKey(process.env.SETTINGS_ENCRYPTION_KEY);

/** A new self-made certificate: RSA 2048, ten years, for signing documents only. */
export function makeSeal(now: Date = new Date()): Seal {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = `01${randomBytes(15).toString("hex")}`;
  cert.validity.notBefore = now;
  cert.validity.notAfter = new Date(now.getTime() + 10 * 365 * 86_400_000);
  const subject = [
    { name: "commonName", value: "Kaizena Flow contract seal" },
    { name: "organizationName", value: "Kaizena Flow" },
    { name: "countryName", value: "NO" },
  ];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, nonRepudiation: true },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const certificatePem = forge.pki.certificateToPem(cert);
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  return { certificatePem, keyPem: forge.pki.privateKeyToPem(keys.privateKey), fingerprint: createHash("sha256").update(Buffer.from(der, "binary")).digest("hex") };
}

/** The platform's seal: the one kept, or a new one made and kept now (two at once keep one). Null without `SETTINGS_ENCRYPTION_KEY`. */
export async function platformSeal(): Promise<Seal | null> {
  const key = settingsKey();
  if (!key) return null;
  const read = async () => typedRow(sealRow, sql`select certificate_pem, key_encrypted, fingerprint from commerce.contract_seals where id = 1`);
  let row = await read();
  if (!row) {
    const made = makeSeal();
    await db().execute(sql`
      insert into commerce.contract_seals (id, certificate_pem, key_encrypted, fingerprint, valid_until)
      values (1, ${made.certificatePem}, ${encryptSecret(made.keyPem, key)}, ${made.fingerprint}, now() + interval '10 years')
      on conflict (id) do nothing
    `);
    row = await read();
  }
  if (!row) return null;
  return { certificatePem: row.certificate_pem, keyPem: decryptSecret(row.key_encrypted, key), fingerprint: row.fingerprint };
}

/** The seal as the PKCS#12 bundle the signer reads, with a passphrase made for this one use. */
function bundle(seal: Seal): { p12: Buffer; passphrase: string } {
  const passphrase = randomBytes(16).toString("hex");
  const asn1 = forge.pkcs12.toPkcs12Asn1(forge.pki.privateKeyFromPem(seal.keyPem), [forge.pki.certificateFromPem(seal.certificatePem)], passphrase, {
    algorithm: "aes256",
  });
  return { p12: Buffer.from(forge.asn1.toDer(asn1).getBytes(), "binary"), passphrase };
}

/** Seals a PDF: a signature field over the whole file, signed with the seal; any later change breaks it in a reader. */
export async function sealPdf(pdf: Uint8Array, seal: Seal, info: { reason: string; location: string; signingTime: Date }): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf);
  pdflibAddPlaceholder({
    pdfDoc: doc,
    reason: info.reason,
    contactInfo: "kaizenaflow.com",
    name: "Kaizena Flow",
    location: info.location,
    signingTime: info.signingTime,
    appName: "Kaizena Flow",
  });
  const withPlaceholder = await doc.save({ useObjectStreams: false });
  const { p12, passphrase } = bundle(seal);
  const signed = await signpdf.sign(Buffer.from(withPlaceholder), new P12Signer(p12, { passphrase }), info.signingTime);
  return new Uint8Array(signed);
}

/** The sent PDF with the signing record's pages after it, as one file (not yet sealed). */
export async function appendPages(sent: Uint8Array, record: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(sent);
  const extra = await PDFDocument.load(record);
  const pages = await doc.copyPages(extra, extra.getPageIndices());
  for (const page of pages) doc.addPage(page);
  return doc.save({ useObjectStreams: false });
}
