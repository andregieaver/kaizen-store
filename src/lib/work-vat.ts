import { ibanValid } from "./dac7";
import {
  computeInvoice,
  type InvoiceTotals,
  type LineAmounts,
  type LineInput,
  UNNAMED_LINE,
  convertMinor,
} from "./work-calc";
import { documentLanguage, type DocumentLanguage, type VatNoteKey, vatNoteText } from "./work-invoice-text";

/**
 * VAT on work invoices (docs/work.md 4.5), as pure rules over plain data: which
 * rate and category a line gets from the seller's registration and the
 * client's VAT treatment, which statutory notes the document must carry, and
 * what must be in place before a store may issue one.
 *
 * Kaizen is an invoicing tool, not certified bookkeeping. The rules here are
 * the conservative reading of 4.5 and need an accountant's sign-off per
 * country (Norway, Sweden and Denmark first); every "LEGAL" line in the
 * design applies. A line carries a category, never a free percentage, so a
 * wrong number cannot become a wrong tax document.
 */

/** What the owner chooses for a client (`work_clients.vat_treatment`). */
export const VAT_TREATMENTS = ["domestic", "reverse_charge", "outside_scope", "exempt"] as const;
export type VatTreatment = (typeof VAT_TREATMENTS)[number];

/** What a line can be (`work_invoice_lines.vat_category`); `standard` follows the client's treatment. */
export const VAT_LINE_CATEGORIES = ["standard", "exempt", "reverse_charge", "outside_scope"] as const;
export type VatLineCategory = (typeof VAT_LINE_CATEGORIES)[number];

export type { VatNoteKey };

export const VAT_TREATMENT_LABELS: Record<VatTreatment, { label: string; hint: string }> = {
  domestic: { label: "Domestic VAT", hint: "The store's country rate. Always used for private customers." },
  reverse_charge: {
    label: "Reverse charge",
    hint: "A business in another EU country with a VAT number. 0 % with a note; the buyer accounts for the VAT.",
  },
  outside_scope: {
    label: "Outside the scope of VAT",
    hint: "A customer outside your VAT territory, such as a business in the EU when you are in Norway. 0 % with a note.",
  },
  exempt: {
    label: "Exempt",
    hint: "Exempt services. 0 % with a note. Check with your accountant that it applies to you.",
  },
};

const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]); // prettier-ignore

/** Whether a country (ISO 3166-1 alpha-2) is in the EU's VAT area. Norway is not. */
export const isEuCountry = (country: string | null | undefined): boolean =>
  EU_COUNTRIES.has((country ?? "").trim().toUpperCase());

/**
 * The treatment to suggest for a new client; the owner can change it. A
 * private customer, or a client in the seller's own country, is domestic. A
 * business elsewhere is outside the scope when either side is outside the EU,
 * and reverse charge when both are in it and the client has a VAT number
 * (without one, VAT must still be charged). Never `exempt`: that is a fact
 * about the service, not the client.
 */
export function suggestTreatment(args: {
  sellerCountry: string;
  clientCountry: string | null;
  business: boolean;
  clientVatNumber: string | null;
}): VatTreatment {
  const seller = args.sellerCountry.trim().toUpperCase();
  const client = (args.clientCountry ?? "").trim().toUpperCase();
  if (!args.business || client === "" || client === seller) return "domestic";
  if (!isEuCountry(seller) || !isEuCountry(client)) return "outside_scope";
  return (args.clientVatNumber ?? "").trim() !== "" ? "reverse_charge" : "domestic";
}

export type VatContext = {
  /** `work_settings.vat_registered`: a store that is not registered charges no VAT at all. */
  sellerVatRegistered: boolean;
  clientTreatment: VatTreatment;
  /** A private customer always has domestic VAT and never reverse charge (4.5 4). */
  clientBusiness: boolean;
  /** The seller's standard rate as basis points, from `commerce.vat_rate(country, 'standard')`. */
  standardRateBp: number;
};

/**
 * The category and rate a line gets, before it is frozen on the invoice:
 *
 *  1. a seller that is not VAT registered: 0 % on every line (the note says why);
 *  2. a line the owner set to a category other than `standard` keeps it, at 0 %;
 *  3. `standard` follows the client: domestic is the store's rate, the other
 *     treatments are 0 % under their own category. A private customer is
 *     always domestic.
 */
export function resolveLineVat(
  ctx: VatContext,
  lineCategory: VatLineCategory,
): { category: VatLineCategory; vatBp: number } {
  if (!ctx.sellerVatRegistered) return { category: lineCategory, vatBp: 0 };
  if (lineCategory !== "standard") return { category: lineCategory, vatBp: 0 };
  const treatment: VatTreatment = ctx.clientBusiness ? ctx.clientTreatment : "domestic";
  if (treatment === "domestic") return { category: "standard", vatBp: ctx.standardRateBp };
  return { category: treatment, vatBp: 0 };
}

/**
 * The category a line must have for the client's VAT treatment (what the database's readiness check
 * demands): a domestic client's lines are standard or exempt, and every line for any other treatment
 * takes that treatment's own category. `standard` in the editor means "follow the client", so a change
 * of the client's treatment never leaves a draft that cannot be issued. A seller who is not VAT
 * registered charges no VAT on any line, so nothing is aligned. The server prices drafts with this and
 * the editor's live totals do too, so the two agree.
 */
export function alignCategory(ctx: VatContext, category: VatLineCategory): VatLineCategory {
  if (!ctx.sellerVatRegistered) return category;
  const treatment: VatTreatment = ctx.clientBusiness ? ctx.clientTreatment : "domestic";
  if (treatment === "domestic") return category === "exempt" ? "exempt" : "standard";
  return treatment;
}

export type PricedLineInput = {
  quantityHundredths: number;
  unitPriceMinor: number;
  discountBp: number;
  category: VatLineCategory;
};

/**
 * Lines with their VAT resolved, their amounts, the invoice's totals and the
 * notes it must carry: one call for the editor's live footer and for the
 * issue step, so what a treatment does to the totals is decided in one place.
 */
export function priceInvoice(
  ctx: VatContext,
  lines: readonly PricedLineInput[],
): { lines: (LineInput & LineAmounts)[]; totals: InvoiceTotals; noteKeys: VatNoteKey[] } {
  const resolved: LineInput[] = lines.map((l) => {
    const vat = resolveLineVat(ctx, l.category);
    return {
      quantityHundredths: l.quantityHundredths,
      unitPriceMinor: l.unitPriceMinor,
      discountBp: l.discountBp,
      vatBp: vat.vatBp,
      vatCategory: vat.category,
    };
  });
  const { lines: amounts, totals } = computeInvoice(resolved);
  return {
    lines: resolved.map((l, i) => ({ ...l, ...amounts[i] })),
    totals,
    noteKeys: vatNoteKeys(ctx.sellerVatRegistered, resolved),
  };
}

const NOTE_ORDER: VatNoteKey[] = ["not_registered", "reverse_charge", "outside_scope", "exempt"];

/**
 * Which statutory notes a document carries, from what is frozen on it: a
 * seller that is not VAT registered has one note whatever the lines say;
 * otherwise each special category in use adds its own. A registered seller's
 * standard lines need none.
 */
export function vatNoteKeys(
  sellerVatRegistered: boolean,
  lines: readonly { vatCategory: VatLineCategory }[],
): VatNoteKey[] {
  if (!sellerVatRegistered) return ["not_registered"];
  const used = new Set<VatNoteKey>();
  for (const l of lines) if (l.vatCategory !== "standard") used.add(l.vatCategory);
  return NOTE_ORDER.filter((k) => used.has(k));
}

/** The notes as text in the document's language (`locale` is the client's). */
export function vatNotesFor(
  noteKeys: readonly VatNoteKey[],
  locale: string | null | undefined,
  sellerCountry: string | null | undefined,
): { key: VatNoteKey; text: string }[] {
  const language: DocumentLanguage = documentLanguage(locale);
  const sellerInEu = isEuCountry(sellerCountry);
  return noteKeys.map((key) => ({ key, text: vatNoteText(key, language, { sellerInEu }) }));
}

/** A VAT number with spaces, dots and dashes taken out, in capitals. */
export const normaliseVatNumber = (value: string): string => value.replace(/[\s.\-]/g, "").toUpperCase();

/**
 * A lenient check that something looks like a VAT number for its country. It
 * catches typos and a missing country prefix, not a number that does not
 * exist (Kaizen does no VIES lookup, 4.5). Norway: nine digits, usually
 * followed by MVA; Sweden: SE and twelve digits; Denmark: eight digits.
 */
export function looksLikeVatNumber(country: string | null | undefined, value: string): boolean {
  const v = normaliseVatNumber(value);
  const c = (country ?? "").trim().toUpperCase();
  if (c === "NO") return /^(NO)?\d{9}(MVA)?$/.test(v);
  if (c === "SE") return /^(SE)?\d{12}$/.test(v);
  if (c === "DK") return /^(DK)?\d{8}$/.test(v);
  if (isEuCountry(c)) return /^[A-Z]{2}[A-Z0-9]{2,12}$/.test(v);
  return /^[A-Z0-9]{4,20}$/.test(v);
}

// --- Readiness: what a store must have before it may issue -------------------

/** The store's details as they will be frozen on the document (`stores` and `work_settings`). */
export type SellerDetails = {
  legalName: string | null;
  organisationNumber: string | null;
  postalAddress: string | null;
  country: string | null;
  vatRegistered: boolean;
  vatNumber: string | null;
  bankAccount: string | null;
};

/** The client as it will be frozen on the document (`work_clients`, the address written out as text). */
export type BuyerDetails = {
  name: string | null;
  address: string | null;
  country: string | null;
  business: boolean;
  vatNumber: string | null;
  vatTreatment: VatTreatment;
};

export type ReadinessCode =
  | "seller_legal_name"
  | "seller_organisation_number"
  | "seller_address"
  | "seller_country"
  | "seller_vat_number"
  | "seller_vat_number_format"
  | "seller_bank_account"
  | "seller_bank_account_invalid"
  | "buyer_name"
  | "buyer_address"
  | "buyer_country"
  | "buyer_vat_number"
  | "buyer_vat_number_format"
  | "reverse_charge_consumer"
  | "reverse_charge_domestic"
  | "reverse_charge_outside_eu"
  | "reverse_charge_seller_not_eu"
  | "vat_when_not_registered"
  | "vat_on_special_category"
  | "standard_rate_zero"
  | "vat_home_amount"
  | "no_lines"
  | "unnamed_line"
  | "line_without_amount";

export type ReadinessProblem = {
  code: ReadinessCode;
  /** `error` blocks issuing; `warning` is shown and can be confirmed. */
  severity: "error" | "warning";
  /** Where to fix it: the store's Company page, Work settings, the client, or the invoice. */
  where: "company" | "settings" | "client" | "invoice";
  /** The owner's words: English, like the rest of the admin. */
  message: string;
};

export type ReadinessInput = {
  seller: SellerDetails;
  buyer: BuyerDetails;
  currency: string;
  /** The currency of the seller's country, when the invoice may need VAT stated in it (4.5 6). Null skips the check. */
  sellerHomeCurrency: string | null;
  /** The reference rate for the VAT in that currency (`convertMinor`'s decimal), if it is set. */
  fxRate: string | null;
  lines: readonly { description: string; exclMinor: number; vatCategory: VatLineCategory; vatBp: number }[];
};

const blank = (value: string | null | undefined) => (value ?? "").trim() === "";

/**
 * Everything checked before a draft becomes a numbered document (4.5 6): the
 * seller's identity, VAT and bank details, the buyer's, the VAT treatment's
 * requirements, and the lines. The database repeats the checks it can
 * (`commerce.issue_work_invoice`); this is the list the owner sees, so they can
 * fix all of it at once. Pure: it takes plain data and returns the problems.
 */
export function workInvoiceReadiness(input: ReadinessInput): { ready: boolean; problems: ReadinessProblem[] } {
  const { seller, buyer } = input;
  const problems: ReadinessProblem[] = [];
  const add = (
    code: ReadinessCode,
    severity: ReadinessProblem["severity"],
    where: ReadinessProblem["where"],
    message: string,
  ) => problems.push({ code, severity, where, message });

  if (blank(seller.legalName))
    add("seller_legal_name", "error", "company", "Add your business's legal name on the Company page.");
  if (blank(seller.organisationNumber)) {
    add("seller_organisation_number", "error", "company", "Add your organisation number on the Company page.");
  }
  if (blank(seller.postalAddress))
    add("seller_address", "error", "company", "Add your business address on the Company page.");
  if (!/^[A-Za-z]{2}$/.test((seller.country ?? "").trim())) {
    add("seller_country", "error", "company", "Choose your business's country on the Company page.");
  }
  if (seller.vatRegistered) {
    if (blank(seller.vatNumber)) {
      add(
        "seller_vat_number",
        "error",
        "settings",
        "Add your VAT number in Work settings, or say that you are not VAT registered.",
      );
    } else if (!looksLikeVatNumber(seller.country, seller.vatNumber ?? "")) {
      add(
        "seller_vat_number_format",
        "warning",
        "settings",
        "Your VAT number does not look right for your country. Check it.",
      );
    }
  }
  const account = normaliseVatNumber(seller.bankAccount ?? "");
  if (account === "") {
    add("seller_bank_account", "error", "settings", "Add the bank account clients should pay to in Work settings.");
  } else if (/^[A-Z]{2}\d{2}/.test(account) && !ibanValid(account)) {
    add(
      "seller_bank_account_invalid",
      "error",
      "settings",
      "The IBAN in Work settings is not right. Check it against your bank's.",
    );
  }

  if (blank(buyer.name)) add("buyer_name", "error", "client", "The client needs a name.");
  if (blank(buyer.address)) add("buyer_address", "error", "client", "Add the client's billing address.");
  if (blank(buyer.country)) add("buyer_country", "error", "client", "Choose the client's country.");

  const hasReverseCharge = input.lines.some((l) => l.vatCategory === "reverse_charge");
  const reverseCharge =
    seller.vatRegistered && (hasReverseCharge || (buyer.business && buyer.vatTreatment === "reverse_charge"));
  if (seller.vatRegistered && reverseCharge) {
    if (!buyer.business) {
      add(
        "reverse_charge_consumer",
        "error",
        "client",
        "Reverse charge is only for businesses. A private customer is charged VAT.",
      );
    }
    if (blank(buyer.vatNumber)) {
      add("buyer_vat_number", "error", "client", "Reverse charge needs the client's VAT number on the document.");
    } else if (!looksLikeVatNumber(buyer.country, buyer.vatNumber ?? "")) {
      add(
        "buyer_vat_number_format",
        "warning",
        "client",
        "The client's VAT number does not look right for their country. Check it.",
      );
    }
    if (!blank(buyer.country) && (buyer.country ?? "").toUpperCase() === (seller.country ?? "").toUpperCase()) {
      add(
        "reverse_charge_domestic",
        "error",
        "client",
        "Reverse charge is for clients in another country. This client is in yours.",
      );
    } else if (!blank(buyer.country) && !isEuCountry(buyer.country)) {
      add(
        "reverse_charge_outside_eu",
        "warning",
        "client",
        "The client is outside the EU: outside the scope of VAT is usually the right choice.",
      );
    }
    if (!isEuCountry(seller.country)) {
      add(
        "reverse_charge_seller_not_eu",
        "warning",
        "client",
        "Your business is outside the EU: outside the scope of VAT is usually the right choice.",
      );
    }
  }

  if (input.lines.length === 0) add("no_lines", "error", "invoice", "Add at least one line.");
  if (input.lines.some((l) => l.description.trim() === "" || l.description === UNNAMED_LINE)) {
    add("unnamed_line", "warning", "invoice", "A line has no description.");
  }
  if (input.lines.some((l) => l.exclMinor === 0)) {
    add("line_without_amount", "warning", "invoice", "A line has no amount.");
  }
  if (!seller.vatRegistered && input.lines.some((l) => l.vatBp > 0)) {
    add("vat_when_not_registered", "error", "invoice", "A store that is not VAT registered cannot charge VAT.");
  }
  if (input.lines.some((l) => l.vatCategory !== "standard" && l.vatBp > 0)) {
    add(
      "vat_on_special_category",
      "error",
      "invoice",
      "A line that is exempt, reverse charge or outside the scope of VAT cannot carry VAT.",
    );
  }
  if (seller.vatRegistered && input.lines.some((l) => l.vatCategory === "standard" && l.vatBp === 0)) {
    add(
      "standard_rate_zero",
      "warning",
      "invoice",
      "A line at the standard rate has 0 % VAT. Check the VAT rate for your country.",
    );
  }
  const chargesVat = input.lines.some((l) => l.vatBp > 0);
  if (chargesVat && input.sellerHomeCurrency && input.currency !== input.sellerHomeCurrency) {
    let valid = false;
    if (input.fxRate) {
      try {
        convertMinor(0, input.fxRate);
        valid = true;
      } catch {
        valid = false;
      }
    }
    if (!valid) {
      add(
        "vat_home_amount",
        "error",
        "invoice",
        `The VAT must also be stated in ${input.sellerHomeCurrency}: set the exchange rate for the issue date.`,
      );
    }
  }

  return { ready: problems.every((p) => p.severity !== "error"), problems };
}
