/**
 * A product's Digital Product Passport (D554), the pure parts: what a passport holds, as staff type it and as anyone reads it, and its QR code.
 *
 * The Ecodesign for Sustainable Products Regulation (EU 2024/1781, ESPR) makes a passport, reached through a data carrier on the product and
 * kept for the product's life, compulsory product group by product group as delegated acts say what each holds (batteries first, under the
 * Battery Regulation, then textiles, electronics and others). This holds the parts every such act draws on: the identifier, the manufacturer and
 * responsible person (from the product's safety details, D452), the materials with their recycled share, origin, substances of concern, care,
 * repair and spare parts, durability, end of life, certifications, an optional carbon footprint with its method, and documents. A group's own
 * required fields are added when its act is adopted. Pure.
 */

import { z } from "zod";

const text = (max: number) => z.string().trim().max(max, `At most ${max} characters.`).default("");
const httpsUrl = z.string().trim().max(500).regex(/^https:\/\/[^\s]{3,}$/, "An address starting with https://.");

export const passportInput = z
  .object({
    materials: z
      .array(
        z.object({
          name: z.string().trim().min(1, "Name each material.").max(80),
          percent: z.coerce.number().min(0).max(100),
          recycledPercent: z.coerce.number().min(0).max(100).default(0),
        }),
      )
      .max(20, "At most 20 materials.")
      .default([]),
    originCountry: z.string().trim().toUpperCase().regex(/^([A-Z]{2})?$/, "A country code such as NO.").default(""),
    substances: text(1000),
    care: text(2000),
    repair: text(2000),
    sparePartsYears: z.coerce.number().int().min(0).max(30).nullable().default(null),
    durabilityYears: z.coerce.number().int().min(0).max(100).nullable().default(null),
    endOfLife: text(2000),
    certifications: z
      .array(z.object({ name: z.string().trim().min(1).max(120), number: text(80), url: httpsUrl.or(z.literal("")).default("") }))
      .max(10)
      .default([]),
    carbon: z.object({ kgCo2e: z.coerce.number().positive().max(1_000_000), method: z.string().trim().min(3, "Say how it was worked out.").max(200) }).nullable().default(null),
    documents: z.array(z.object({ title: z.string().trim().min(1).max(120), url: httpsUrl })).max(10).default([]),
  })
  .superRefine((p, ctx) => {
    const total = p.materials.reduce((sum, m) => sum + m.percent, 0);
    if (total > 100.5) ctx.addIssue({ code: "custom", path: ["materials"], message: "The materials add up to more than 100 %." });
    for (const [i, m] of p.materials.entries()) {
      if (m.recycledPercent > 100) ctx.addIssue({ code: "custom", path: ["materials", i, "recycledPercent"], message: "At most 100 %." });
    }
  });

export type Passport = z.output<typeof passportInput>;

export const EMPTY_PASSPORT: Passport = passportInput.parse({});

/** A stored passport read back: what does not fit today's shape is dropped to the empty value rather than shown wrong. */
export function readPassport(raw: unknown): Passport {
  const parsed = passportInput.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_PASSPORT;
}

/** What a passport must hold before it is published: at least the materials or a care, repair or end-of-life text. */
export function publishProblem(p: Passport): string | null {
  if (p.materials.length === 0 && !p.care && !p.repair && !p.endOfLife) return "Add the materials, or how to care for, repair or recycle it, before publishing.";
  return null;
}

/** The share of recycled material across the whole product, as the materials say it (percent of the product, one decimal). */
export function recycledShare(p: Passport): number | null {
  if (p.materials.length === 0) return null;
  const share = p.materials.reduce((sum, m) => sum + (m.percent * m.recycledPercent) / 100, 0);
  return Math.round(share * 10) / 10;
}

/** The passport's public address on the platform (stable for the product's life). */
export const passportPath = (id: string): string => `/passport/${id}`;


export type PassportWords = {
  title: string;
  intro: string;
  identifiers: string;
  manufacturer: string;
  responsible: string;
  materials: string;
  recycled: string;
  recycledTotal: string;
  origin: string;
  substances: string;
  care: string;
  repair: string;
  spareParts: string;
  durability: string;
  endOfLife: string;
  certifications: string;
  carbon: string;
  documents: string;
  seller: string;
  updated: string;
  years: (n: number) => string;
  json: string;
};

const PASSPORT_WORDS: Record<"en" | "nb" | "sv" | "da", PassportWords> = {
  en: {
    title: "Product passport",
    intro: "What this product is made of, and how to look after, repair and recycle it.",
    identifiers: "Identifiers",
    manufacturer: "Manufacturer",
    responsible: "Responsible person in the EU",
    materials: "Materials",
    recycled: "recycled",
    recycledTotal: "Recycled material in all",
    origin: "Made in",
    substances: "Substances of concern",
    care: "Care",
    repair: "Repair",
    spareParts: "Spare parts available for",
    durability: "Expected to last",
    endOfLife: "When you no longer need it",
    certifications: "Certifications and labels",
    carbon: "Carbon footprint",
    documents: "Documents",
    seller: "Sold by",
    updated: "Last updated",
    years: (n) => `${n} ${n === 1 ? "year" : "years"}`,
    json: "This passport as data (JSON)",
  },
  nb: {
    title: "Produktpass",
    intro: "Hva produktet er laget av, og hvordan du tar vare på, reparerer og resirkulerer det.",
    identifiers: "Identifikatorer",
    manufacturer: "Produsent",
    responsible: "Ansvarlig person i EØS",
    materials: "Materialer",
    recycled: "resirkulert",
    recycledTotal: "Resirkulert materiale totalt",
    origin: "Produsert i",
    substances: "Stoffer som gir grunn til bekymring",
    care: "Vedlikehold",
    repair: "Reparasjon",
    spareParts: "Reservedeler tilgjengelig i",
    durability: "Forventet levetid",
    endOfLife: "Når du ikke trenger det lenger",
    certifications: "Sertifiseringer og merker",
    carbon: "Klimaavtrykk",
    documents: "Dokumenter",
    seller: "Solgt av",
    updated: "Sist oppdatert",
    years: (n) => `${n} år`,
    json: "Passet som data (JSON)",
  },
  sv: {
    title: "Produktpass",
    intro: "Vad produkten är gjord av, och hur du sköter, reparerar och återvinner den.",
    identifiers: "Identifierare",
    manufacturer: "Tillverkare",
    responsible: "Ansvarig person i EU",
    materials: "Material",
    recycled: "återvunnet",
    recycledTotal: "Återvunnet material totalt",
    origin: "Tillverkad i",
    substances: "Ämnen som inger betänkligheter",
    care: "Skötsel",
    repair: "Reparation",
    spareParts: "Reservdelar tillgängliga i",
    durability: "Förväntad livslängd",
    endOfLife: "När du inte längre behöver den",
    certifications: "Certifieringar och märkningar",
    carbon: "Klimatavtryck",
    documents: "Dokument",
    seller: "Säljs av",
    updated: "Senast uppdaterad",
    years: (n) => `${n} år`,
    json: "Passet som data (JSON)",
  },
  da: {
    title: "Produktpas",
    intro: "Hvad produktet er lavet af, og hvordan du passer på, reparerer og genanvender det.",
    identifiers: "Identifikatorer",
    manufacturer: "Producent",
    responsible: "Ansvarlig person i EU",
    materials: "Materialer",
    recycled: "genanvendt",
    recycledTotal: "Genanvendt materiale i alt",
    origin: "Fremstillet i",
    substances: "Problematiske stoffer",
    care: "Pleje",
    repair: "Reparation",
    spareParts: "Reservedele tilgængelige i",
    durability: "Forventet levetid",
    endOfLife: "Når du ikke længere har brug for det",
    certifications: "Certificeringer og mærker",
    carbon: "Klimaaftryk",
    documents: "Dokumenter",
    seller: "Sælges af",
    updated: "Senest opdateret",
    years: (n) => `${n} år`,
    json: "Passet som data (JSON)",
  },
};

/** A passport page's words in a language (English for any other). */
export const passportWords = (lang: string): PassportWords => PASSPORT_WORDS[(lang in PASSPORT_WORDS ? lang : "en") as keyof typeof PASSPORT_WORDS];
