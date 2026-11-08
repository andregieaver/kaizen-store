import grouping from "@/data/ledger/no-grouping.json";

import { NO_TAX_CODES, UNCARRIED_RESULT_ACCOUNT, entryName, isVatAccount, standardAccount } from "./ledger";
import { VAT_RETURN_CODES } from "./vat-return";

/**
 * SAF-T Financial (B5 step 2 of `docs/own-books-and-sales.md`, D497): a year of the store's own books as the file Skatteetaten asks for
 * in an audit, and the one an accountant moves books between systems with. Pure: the code from Skatteetaten's business statement each
 * account reports under (*næringsspesifikasjon*, `src/data/ledger/no-grouping.json`), the accounts' and the customers' and suppliers'
 * balances at the start and end of the selection, and the file (`AuditFile`, schema `Norwegian_SAF-T_Financial_Schema` v1.30, and v1.40
 * for periods from 2027: the file uses only what both have; github.com/Skatteetaten/saf-t, read 8 November 2026).
 *
 * The file's rules, from the schema and Skatteetaten's example: every account has its grouping category and code; a balance is written as
 * a debit or a credit, never negative; a line's amount the same; a line with a VAT code has its VAT on it (`TaxInformation`: the code,
 * rate, base and VAT), the VAT account's own line none; a line on a customer or supplier account names the customer or supplier, who is
 * in the master files with what they owed at the start and the end. Amounts are in kroner and øre, two decimals.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Grouping codes
// ---------------------------------------------------------------------------------------------------------------------

/** A code of Skatteetaten's business statement: the code, its category (the file's `GroupingCategory`) and its names. */
export type GroupingCode = { code: string; category: string; nb: string; en: string };

export const NO_GROUPING_CODES: readonly GroupingCode[] = grouping.codes;

const groupingByCode = new Map(NO_GROUPING_CODES.map((g) => [g.code, g]));

/**
 * The code each standard account reports under, by its four digits: `[first, last, code]`, in order, covering 1000 to 8999 without a gap.
 * No ready mapping exists: this one was made account by account from the standard accounts' names and the codes' names (8 November 2026),
 * the business statement's own number where an account has it and means the same, else the code that says what the account holds (bank
 * and card fees, 7770, are other costs, 7700; the VAT accounts, 2700 to 2769, are VAT owed, 2740, as Skatteetaten's example has them).
 * The petroleum, bank and insurance codes are left out: a store is none of these.
 */
export const NO_GROUPING_RANGES: readonly (readonly [number, number, number])[] = [
  // Intangible and fixed assets
  [1000, 1009, 1000],
  [1010, 1069, 1020],
  [1070, 1079, 1070],
  [1080, 1089, 1080],
  [1090, 1099, 1020],
  [1100, 1109, 1115],
  [1110, 1114, 1120],
  [1115, 1116, 1115],
  [1117, 1119, 1117],
  [1120, 1129, 1115],
  [1130, 1139, 1130],
  [1140, 1149, 1140],
  [1150, 1159, 1150],
  [1160, 1169, 1160],
  [1170, 1179, 1115],
  [1180, 1189, 1180],
  [1190, 1199, 1290],
  [1200, 1209, 1205],
  [1210, 1219, 1130],
  [1220, 1224, 1221],
  [1225, 1229, 1225],
  [1230, 1234, 1205],
  [1235, 1239, 1238],
  [1240, 1259, 1205],
  [1260, 1269, 1120],
  [1270, 1279, 1205],
  [1280, 1288, 1280],
  [1289, 1299, 1290],
  // Financial fixed assets
  [1300, 1304, 1313],
  [1305, 1305, 1312],
  [1306, 1311, 1313],
  [1312, 1312, 1312],
  [1313, 1314, 1313],
  [1315, 1315, 1312],
  [1316, 1319, 1313],
  [1320, 1329, 1320],
  [1330, 1330, 1332],
  [1331, 1331, 1331],
  [1332, 1339, 1332],
  [1340, 1349, 1340],
  [1350, 1359, 1350],
  [1360, 1368, 1360],
  [1369, 1369, 1390],
  [1370, 1379, 1370],
  [1380, 1389, 1380],
  [1390, 1393, 1390],
  [1394, 1394, 1395],
  [1395, 1399, 1390],
  // Current assets
  [1400, 1479, 1400],
  [1480, 1489, 1570],
  [1490, 1498, 1490],
  [1499, 1499, 1400],
  [1500, 1529, 1500],
  [1530, 1549, 1530],
  [1550, 1559, 1501],
  [1560, 1564, 1560],
  [1565, 1569, 1565],
  [1570, 1573, 1570],
  [1574, 1576, 1565],
  [1577, 1749, 1570],
  [1750, 1759, 1530],
  [1760, 1779, 1570],
  [1780, 1789, 1780],
  [1790, 1799, 1570],
  [1800, 1809, 1800],
  [1810, 1819, 1810],
  [1820, 1829, 1800],
  [1830, 1839, 1830],
  [1840, 1849, 1840],
  [1850, 1859, 1830],
  [1860, 1869, 1840],
  [1870, 1889, 1880],
  [1890, 1899, 1895],
  [1900, 1919, 1900],
  [1920, 1949, 1920],
  [1950, 1959, 1950],
  [1960, 1999, 1920],
  // Equity
  [2000, 2009, 2000],
  [2010, 2014, 2010],
  [2015, 2019, 2015],
  [2020, 2029, 2020],
  [2030, 2039, 2030],
  [2040, 2040, 2043],
  [2041, 2041, 2041],
  [2042, 2044, 2043],
  [2045, 2049, 2045],
  [2050, 2054, 2050],
  [2055, 2059, 2055],
  [2060, 2079, 2050],
  [2080, 2094, 2080],
  [2095, 2099, 2050],
  // Long-term liabilities
  [2100, 2119, 2100],
  [2120, 2129, 2120],
  [2130, 2159, 2130],
  [2160, 2179, 2160],
  [2180, 2184, 2180],
  [2185, 2187, 2185],
  [2188, 2199, 2180],
  [2200, 2209, 2200],
  [2210, 2219, 2210],
  [2220, 2249, 2220],
  [2250, 2259, 2250],
  [2260, 2279, 2260],
  [2280, 2289, 2280],
  [2290, 2299, 2290],
  // Short-term liabilities
  [2300, 2319, 2310],
  [2320, 2329, 2320],
  [2330, 2339, 2330],
  [2340, 2399, 2380],
  [2400, 2459, 2400],
  [2460, 2469, 2460],
  [2470, 2499, 2400],
  [2500, 2509, 2500],
  [2510, 2539, 2510],
  [2540, 2599, 2500],
  [2600, 2699, 2600],
  [2700, 2769, 2740],
  [2770, 2789, 2770],
  [2790, 2799, 2790],
  [2800, 2899, 2800],
  [2900, 2909, 2900],
  [2910, 2919, 2910],
  [2920, 2929, 2920],
  [2930, 2949, 2949],
  [2950, 2959, 2950],
  [2960, 2964, 2990],
  [2965, 2979, 2970],
  [2980, 2989, 2980],
  [2990, 2999, 2990],
  // Income
  [3000, 3099, 3000],
  [3100, 3199, 3100],
  [3200, 3299, 3200],
  [3300, 3399, 3300],
  [3400, 3499, 3400],
  [3500, 3599, 3500],
  [3600, 3609, 3600],
  [3610, 3649, 3695],
  [3650, 3694, 3650],
  [3695, 3699, 3695],
  [3700, 3799, 3700],
  [3800, 3849, 3880],
  [3850, 3869, 3850],
  [3870, 3879, 3870],
  [3880, 3884, 3880],
  [3885, 3885, 3885],
  [3886, 3889, 3880],
  [3890, 3899, 3885],
  [3900, 3999, 3900],
  // Cost of goods
  [4000, 4289, 4005],
  [4290, 4299, 4295],
  [4300, 4499, 4005],
  [4500, 4599, 4500],
  [4600, 4989, 4005],
  [4990, 4999, 4995],
  // Payroll
  [5000, 5299, 5000],
  [5300, 5399, 5300],
  [5400, 5419, 5400],
  [5420, 5429, 5420],
  [5430, 5499, 5400],
  [5500, 5599, 5300],
  [5600, 5699, 5600],
  [5700, 5819, 5000],
  [5820, 5829, 5400],
  [5830, 5899, 5000],
  [5900, 5949, 5900],
  [5950, 5989, 5950],
  [5990, 5999, 5900],
  // Other operating costs
  [6000, 6019, 6000],
  [6020, 6049, 6004],
  [6050, 6059, 6050],
  [6060, 6069, 6054],
  [6070, 6099, 6050],
  [6100, 6199, 6100],
  [6200, 6299, 6200],
  [6300, 6319, 6300],
  [6320, 6339, 6395],
  [6340, 6349, 6340],
  [6350, 6359, 6350],
  [6360, 6399, 6395],
  [6400, 6439, 6400],
  [6440, 6449, 6440],
  [6450, 6499, 6400],
  [6500, 6551, 6500],
  [6552, 6553, 6350],
  [6554, 6599, 6500],
  [6600, 6619, 6600],
  [6620, 6699, 6695],
  [6700, 6749, 6700],
  [6750, 6750, 6350],
  [6751, 6799, 6700],
  [6800, 6859, 6995],
  [6860, 6869, 7700],
  [6870, 6997, 6995],
  [6998, 6998, 6998],
  [6999, 6999, 6995],
  [7000, 7019, 7000],
  [7020, 7039, 7020],
  [7040, 7079, 7040],
  [7080, 7089, 7080],
  [7090, 7098, 7020],
  [7099, 7099, 7099],
  [7100, 7139, 7155],
  [7140, 7149, 7165],
  [7150, 7159, 7155],
  [7160, 7189, 7165],
  [7190, 7199, 5300],
  [7200, 7299, 7295],
  [7300, 7349, 7330],
  [7350, 7359, 7350],
  [7360, 7389, 7370],
  [7390, 7399, 7330],
  [7400, 7409, 7400],
  [7410, 7419, 7490],
  [7420, 7429, 7420],
  [7430, 7489, 7440],
  [7490, 7499, 7490],
  [7500, 7549, 7500],
  [7550, 7599, 7565],
  [7600, 7649, 7600],
  [7650, 7699, 7650],
  [7700, 7799, 7700],
  [7800, 7859, 7830],
  [7860, 7879, 7860],
  [7880, 7884, 7880],
  [7885, 7885, 7885],
  [7886, 7889, 7880],
  [7890, 7899, 7885],
  [7900, 7999, 7700],
  // Financial income and costs, tax, the year's result
  [8000, 8004, 8090],
  [8005, 8006, 8005],
  [8007, 8008, 8074],
  [8009, 8016, 8090],
  [8017, 8018, 8074],
  [8019, 8024, 8090],
  [8025, 8026, 8005],
  [8027, 8028, 8074],
  [8029, 8029, 8090],
  [8030, 8039, 8030],
  [8040, 8059, 8050],
  [8060, 8069, 8060],
  [8070, 8074, 8090],
  [8075, 8076, 8075],
  [8077, 8078, 8074],
  [8079, 8079, 8079],
  [8080, 8089, 8080],
  [8090, 8099, 8090],
  [8100, 8109, 8100],
  [8110, 8129, 8115],
  [8130, 8139, 8130],
  [8140, 8159, 8150],
  [8160, 8169, 8160],
  [8170, 8176, 8179],
  [8177, 8178, 8174],
  [8179, 8299, 8179],
  [8300, 8308, 8300],
  [8309, 8309, 8323],
  [8310, 8320, 8321],
  [8321, 8399, 8300],
  [8400, 8799, 8179],
  [8800, 8999, 8800],
];

/**
 * The business statement's code an account reports under: by its standard account (`standard`, four digits) where it has one, else by its
 * own first four digits (a sub-account, `15001`, reports as 1500). Null outside 1000 to 8999.
 */
export function groupingOf(account: number, standard?: string | null): GroupingCode | null {
  const four = Number(standard && /^\d{4}$/.test(standard) ? standard : String(account).slice(0, 4));
  if (!Number.isInteger(four) || four < 1000 || four > 8999) return null;
  const range = NO_GROUPING_RANGES.find(([first, last]) => four >= first && four <= last);
  return range ? (groupingByCode.get(String(range[2])) ?? null) : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------------------------------------------------

/** Classes 1 and 2: the balance sheet, whose balances carry over from year to year. */
const onBalanceSheet = (account: number) => String(account)[0] === "1" || String(account)[0] === "2";

/** What an account's lines sum to: before the selection's year, in its year before the selection, and in the selection. */
export type SaftSums = { account: number; beforeYear: number; inYearBefore: number; inSelection: number };

export type SaftBalance = { account: number; opening: number; closing: number };

/**
 * Each account's balance at the start and end of the selection (one year or part of one). A balance sheet account holds all that came
 * before; a profit and loss account only its year's (the year starts at nought). A result of earlier years that no entry carried to equity
 * is on other equity (`UNCARRIED_RESULT_ACCOUNT`), as the opening balance from another system has it (`openingBalanceOf()`), so the
 * balances at either end sum to nought as the books do.
 */
export function saftBalances(sums: readonly SaftSums[]): SaftBalance[] {
  const byAccount = new Map<number, SaftBalance>();
  let uncarried = 0;
  for (const s of sums) {
    const sheet = onBalanceSheet(s.account);
    if (!sheet) uncarried += s.beforeYear;
    const opening = (sheet ? s.beforeYear : 0) + s.inYearBefore;
    const held = byAccount.get(s.account) ?? { account: s.account, opening: 0, closing: 0 };
    byAccount.set(s.account, { account: s.account, opening: held.opening + opening, closing: held.closing + opening + s.inSelection });
  }
  if (uncarried !== 0) {
    const held = byAccount.get(UNCARRIED_RESULT_ACCOUNT) ?? { account: UNCARRIED_RESULT_ACCOUNT, opening: 0, closing: 0 };
    byAccount.set(UNCARRIED_RESULT_ACCOUNT, { account: UNCARRIED_RESULT_ACCOUNT, opening: held.opening + uncarried, closing: held.closing + uncarried });
  }
  return [...byAccount.values()].sort((a, b) => a.account - b.account);
}

// ---------------------------------------------------------------------------------------------------------------------
// Customers and suppliers
// ---------------------------------------------------------------------------------------------------------------------

/** Accounts of the customer ledger (1500 to 1529) and of the supplier ledger (2400 to 2459), sub-accounts by their first four digits. */
const fourOf = (account: number) => Number(String(account).slice(0, 4));
export const isCustomerAccount = (account: number): boolean => fourOf(account) >= 1500 && fourOf(account) <= 1529;
export const isSupplierAccount = (account: number): boolean => fourOf(account) >= 2400 && fourOf(account) <= 2459;

/** The customer the shop's own sales are owed by: the shop's buyers paid at checkout, kept together as a cash sale is. */
export const SHOP_CUSTOMER_ID = "NETTBUTIKK";

/** A customer's or supplier's id in the file: our id without its dashes (32 characters; the file takes 35). */
export const partyId = (uuid: string): string => uuid.replace(/-/g, "").toLowerCase();

export type SaftAddress = { street: string | null; postalCode: string | null; city: string | null; country: string | null };
export type SaftParty = { id: string; name: string; registrationNumber: string | null; address: SaftAddress | null; balances: SaftBalance[] };

/** The lines on a customer's or a supplier's account, with whose they are: summed to what each owed at the selection's start and end. */
export function partyBalances(lines: readonly { party: string; account: number; amount: number; date: string }[], from: string, to: string): Map<string, SaftBalance[]> {
  const sums = new Map<string, Map<number, SaftBalance>>();
  for (const l of lines) {
    if (l.date > to) continue;
    const accounts = sums.get(l.party) ?? new Map<number, SaftBalance>();
    const held = accounts.get(l.account) ?? { account: l.account, opening: 0, closing: 0 };
    accounts.set(l.account, { account: l.account, opening: held.opening + (l.date < from ? l.amount : 0), closing: held.closing + l.amount });
    sums.set(l.party, accounts);
  }
  return new Map([...sums.entries()].map(([party, accounts]) => [party, [...accounts.values()].sort((a, b) => a.account - b.account)]));
}

// ---------------------------------------------------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------------------------------------------------

export type SaftLine = { line: number; account: number; amount: number; vatCode: string | null; text: string | null; customerId: string | null; supplierId: string | null };

export type SaftEntry = {
  series: string;
  year: number;
  number: number;
  date: string;
  /** The day it was posted (the file's `SystemEntryDate`). */
  postedOn: string;
  text: string;
  sourceKind: string | null;
  /** A reversing entry. */
  reversal: boolean;
  lines: SaftLine[];
};

export type SaftAccount = { number: number; name: string; standard: string | null; createdOn: string | null; opening: number; closing: number };

export type SaftInput = {
  company: {
    organisationNumber: string;
    name: string;
    address: SaftAddress | null;
    /** The person to ask: who made the file. */
    contact: { firstName: string; lastName: string; email: string | null };
  };
  currency: string;
  /** The day the file was made. */
  createdOn: string;
  /** The days it covers: within one year. */
  from: string;
  to: string;
  software: { name: string; version: string };
  accounts: SaftAccount[];
  customers: SaftParty[];
  suppliers: SaftParty[];
  entries: SaftEntry[];
};

/** The schema version for a selection: 1.30 for periods to 2026, 1.40 from 2027 (backward compatible; this file is valid in both). */
export const saftVersion = (from: string): string => (from >= "2027-01-01" ? "1.40" : "1.30");

/** The accounts the file cannot report: without a code of the business statement (none in Norway's chart; a guard). */
export const ungroupedAccounts = (accounts: readonly Pick<SaftAccount, "number" | "standard">[]): number[] =>
  accounts.filter((a) => groupingOf(a.number, a.standard) === null).map((a) => a.number);

/** The journals, one for each series, named as people read them; another series by its letters. */
const JOURNALS: Record<string, string> = { S: "Salg", B: "Bank", M: "Manuelle bilag", IB: "Inngående balanse", L: "Leverandørfakturaer og kjøp" };
const SERIES_ORDER = ["IB", "S", "L", "B", "M"];

/** What kind of voucher an entry is, by what it was posted from. */
const VOUCHER_TYPES: Record<string, string> = {
  work_invoice: "Faktura",
  shop_invoice: "Faktura",
  work_credit_note: "Kreditnota",
  shop_credit_note: "Kreditnota",
  work_payment: "Innbetaling",
  shop_payment: "Innbetaling",
  shop_refund: "Tilbakebetaling",
  payout: "Utbetaling fra betalingsleverandør",
  dispute: "Innsigelse på kortbetaling",
  opening_balance: "Inngående balanse",
  supplier_invoice: "Leverandørfaktura",
  bank_line: "Bankbilag",
};

/** A tax code's rate from Skatteetaten's list: the return's own table first, else the rate's name. */
export function taxPercentOf(code: string): number {
  const known = VAT_RETURN_CODES[code];
  if (known) return known.rate;
  const rate = NO_TAX_CODES.find((c) => c.code === code)?.rate ?? "";
  if (rate === "Regular rate") return 25;
  if (rate === "Reduced rate, middle") return 15;
  if (rate === "Reduced rate, raw fish") return 11.11;
  if (rate === "Reduced rate, low") return 12;
  return 0;
}

/** Text as the schema takes it: no control characters XML forbids, escaped, and no longer than the element allows (in characters). */
function text(value: string, max: number): string {
  const clean = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "").trim();
  return Array.from(clean)
    .slice(0, max)
    .join("")
    .trim()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** An amount in minor units (hundredths in every currency the books keep, `money.ts`) as the schema's decimal: two places, never negative. */
export function saftAmount(minor: number): string {
  const s = BigInt(Math.abs(Math.round(minor)))
    .toString()
    .padStart(3, "0");
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

const rateText = (rate: number) => (Number.isInteger(rate) ? String(rate) : rate.toFixed(2));

/** The VAT on each line with a VAT code: the entry's VAT for that code (its VAT accounts' lines) shared by the lines' bases, the rest on the last. */
export function lineVat(lines: readonly SaftLine[]): Map<number, number> {
  const result = new Map<number, number>();
  const codes = new Set(lines.filter((l) => l.vatCode !== null && !isVatAccount(l.account)).map((l) => l.vatCode as string));
  for (const code of codes) {
    const bases = lines.filter((l) => l.vatCode === code && !isVatAccount(l.account));
    const known = VAT_RETURN_CODES[code];
    if (known?.kind === "reverse") {
      // Reverse charge: the VAT is reckoned on the base (its due and deducted halves may net to nought on the VAT accounts).
      for (const l of bases) result.set(l.line, Math.round((Math.abs(l.amount) * known.rate) / 100) * Math.sign(l.amount));
      continue;
    }
    const vat = lines.filter((l) => l.vatCode === code && isVatAccount(l.account)).reduce((sum, l) => sum + l.amount, 0);
    const total = bases.reduce((sum, l) => sum + Math.abs(l.amount), 0);
    let left = vat;
    bases.forEach((l, i) => {
      const share = i === bases.length - 1 || total === 0 ? left : Math.round((vat * Math.abs(l.amount)) / total);
      result.set(l.line, share);
      left -= share;
    });
  }
  return result;
}

const monthOf = (day: string) => Number(day.slice(5, 7));
const yearOf = (day: string) => Number(day.slice(0, 4));

/** A balance as the schema's choice of debit or credit (nought is a debit). */
function balance(prefix: "Opening" | "Closing", minor: number, indent: string): string {
  return `${indent}<${prefix}${minor < 0 ? "Credit" : "Debit"}Balance>${saftAmount(minor)}</${prefix}${minor < 0 ? "Credit" : "Debit"}Balance>`;
}

function addressXml(address: SaftAddress | null, indent: string): string[] {
  if (!address) return [];
  const parts = [
    address.street ? `${indent}  <StreetName>${text(address.street, 256)}</StreetName>` : null,
    address.city ? `${indent}  <City>${text(address.city, 256)}</City>` : null,
    address.postalCode ? `${indent}  <PostalCode>${text(address.postalCode, 70)}</PostalCode>` : null,
    address.country && /^[A-Z]{2}$/.test(address.country) ? `${indent}  <Country>${address.country}</Country>` : null,
  ].filter((x): x is string => x !== null);
  return parts.length === 0 ? [] : [`${indent}<Address>`, ...parts, `${indent}</Address>`];
}

function partyXml(kind: "Customer" | "Supplier", party: SaftParty): string[] {
  const reg = party.registrationNumber ? party.registrationNumber.replace(/\s/g, "") : "";
  return [
    `      <${kind}>`,
    reg ? `        <RegistrationNumber>${text(reg, 35)}</RegistrationNumber>` : null,
    `        <Name>${text(party.name, 256)}</Name>`,
    ...addressXml(party.address, "        "),
    `        <${kind}ID>${text(party.id, 35)}</${kind}ID>`,
    ...party.balances.flatMap((b) => [
      "        <BalanceAccount>",
      `          <AccountID>${b.account}</AccountID>`,
      balance("Opening", b.opening, "          "),
      balance("Closing", b.closing, "          "),
      "        </BalanceAccount>",
    ]),
    `      </${kind}>`,
  ].filter((x): x is string => x !== null);
}

/**
 * The file: the header (the company, who to ask, the selection by months), the master files (every account with its code and balances,
 * the customers and suppliers with theirs, the VAT codes used), and the entries of the selection, a journal for each series.
 */
export function saftXml(input: SaftInput): string {
  const cur = input.currency;
  const org = input.company.organisationNumber.replace(/\D/g, "");
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<AuditFile xmlns="urn:StandardAuditFile-Taxation-Financial:NO">',
    "  <Header>",
    `    <AuditFileVersion>${saftVersion(input.from)}</AuditFileVersion>`,
    "    <AuditFileCountry>NO</AuditFileCountry>",
    `    <AuditFileDateCreated>${input.createdOn}</AuditFileDateCreated>`,
    `    <SoftwareCompanyName>${text(input.software.name, 70)}</SoftwareCompanyName>`,
    `    <SoftwareID>${text(input.software.name, 256)}</SoftwareID>`,
    `    <SoftwareVersion>${text(input.software.version, 18)}</SoftwareVersion>`,
    "    <Company>",
    `      <RegistrationNumber>${org}</RegistrationNumber>`,
    `      <Name>${text(input.company.name, 256)}</Name>`,
    ...addressXml(input.company.address, "      "),
    "      <Contact>",
    "        <ContactPerson>",
    `          <FirstName>${text(input.company.contact.firstName, 35)}</FirstName>`,
    `          <LastName>${text(input.company.contact.lastName, 70)}</LastName>`,
    "        </ContactPerson>",
    input.company.contact.email ? `        <Email>${text(input.company.contact.email, 70)}</Email>` : "",
    "      </Contact>",
    "      <TaxRegistration>",
    `        <TaxRegistrationNumber>${org}</TaxRegistrationNumber>`,
    "        <TaxAuthority>Skatteetaten</TaxAuthority>",
    "      </TaxRegistration>",
    "    </Company>",
    `    <DefaultCurrencyCode>${cur}</DefaultCurrencyCode>`,
    "    <SelectionCriteria>",
    `      <PeriodStart>${monthOf(input.from)}</PeriodStart>`,
    `      <PeriodStartYear>${yearOf(input.from)}</PeriodStartYear>`,
    `      <PeriodEnd>${monthOf(input.to)}</PeriodEnd>`,
    `      <PeriodEndYear>${yearOf(input.to)}</PeriodEndYear>`,
    "    </SelectionCriteria>",
    "    <TaxAccountingBasis>A</TaxAccountingBasis>",
    "  </Header>",
    "  <MasterFiles>",
    "    <GeneralLedgerAccounts>",
  ];
  for (const a of [...input.accounts].sort((x, y) => x.number - y.number)) {
    const g = groupingOf(a.number, a.standard);
    if (!g) throw new Error(`saft: account ${a.number} has no grouping code`);
    out.push(
      "      <Account>",
      `        <AccountID>${a.number}</AccountID>`,
      `        <AccountDescription>${text(a.name, 256)}</AccountDescription>`,
      `        <GroupingCategory>${g.category}</GroupingCategory>`,
      `        <GroupingCode>${g.code}</GroupingCode>`,
      "        <AccountType>GL</AccountType>",
      a.createdOn ? `        <AccountCreationDate>${a.createdOn}</AccountCreationDate>` : "",
      balance("Opening", a.opening, "        "),
      balance("Closing", a.closing, "        "),
      "      </Account>",
    );
  }
  out.push("    </GeneralLedgerAccounts>");
  if (input.customers.length > 0) out.push("    <Customers>", ...input.customers.flatMap((c) => partyXml("Customer", c)), "    </Customers>");
  if (input.suppliers.length > 0) out.push("    <Suppliers>", ...input.suppliers.flatMap((s) => partyXml("Supplier", s)), "    </Suppliers>");
  const codes = [...new Set(input.entries.flatMap((e) => e.lines.filter((l) => l.vatCode !== null && !isVatAccount(l.account)).map((l) => l.vatCode as string)))].sort(
    (a, b) => Number(a) - Number(b),
  );
  if (codes.length > 0) {
    out.push("    <TaxTable>", "      <TaxTableEntry>", "        <TaxType>MVA</TaxType>", "        <Description>Merverdiavgift</Description>");
    for (const code of codes) {
      const known = NO_TAX_CODES.find((c) => c.code === code);
      out.push(
        "        <TaxCodeDetails>",
        `          <TaxCode>${code}</TaxCode>`,
        known ? `          <Description>${text(known.nb, 256)}</Description>` : "",
        `          <TaxPercentage>${rateText(taxPercentOf(code))}</TaxPercentage>`,
        "          <Country>NO</Country>",
        `          <StandardTaxCode>${code}</StandardTaxCode>`,
        "          <BaseRate>100</BaseRate>",
        "        </TaxCodeDetails>",
      );
    }
    out.push("      </TaxTableEntry>", "    </TaxTable>");
  }
  out.push("  </MasterFiles>");

  const entries = [...input.entries].sort((a, b) => (a.date === b.date ? a.number - b.number : a.date < b.date ? -1 : 1));
  let debit = 0;
  let credit = 0;
  for (const e of entries) {
    for (const l of e.lines) {
      if (l.amount > 0) debit += l.amount;
      else credit -= l.amount;
    }
  }
  out.push(
    "  <GeneralLedgerEntries>",
    `    <NumberOfEntries>${entries.length}</NumberOfEntries>`,
    `    <TotalDebit>${saftAmount(debit)}</TotalDebit>`,
    `    <TotalCredit>${saftAmount(credit)}</TotalCredit>`,
  );
  const series = [...new Set(entries.map((e) => e.series))].sort((a, b) => {
    const ia = SERIES_ORDER.indexOf(a);
    const ib = SERIES_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  for (const s of series) {
    out.push("    <Journal>", `      <JournalID>${text(s, 18)}</JournalID>`, `      <Description>${text(JOURNALS[s] ?? `Serie ${s}`, 256)}</Description>`, `      <Type>${text(s, 9)}</Type>`);
    for (const e of entries.filter((x) => x.series === s)) {
      const vat = lineVat(e.lines);
      const voucher = e.reversal ? "Tilbakeføring" : e.sourceKind ? VOUCHER_TYPES[e.sourceKind] : "Manuelt bilag";
      out.push(
        "      <Transaction>",
        `        <TransactionID>${text(entryName(e.series, e.year, e.number), 70)}</TransactionID>`,
        `        <Period>${monthOf(e.date)}</Period>`,
        `        <PeriodYear>${yearOf(e.date)}</PeriodYear>`,
        `        <TransactionDate>${e.date}</TransactionDate>`,
        voucher ? `        <VoucherType>${text(voucher, 70)}</VoucherType>` : "",
        `        <Description>${text(e.text, 256)}</Description>`,
        `        <SystemEntryDate>${e.postedOn}</SystemEntryDate>`,
        `        <GLPostingDate>${e.date}</GLPostingDate>`,
      );
      for (const l of [...e.lines].sort((a, b) => a.line - b.line)) {
        const side = l.amount < 0 ? "Credit" : "Debit";
        const lineVatMinor = vat.get(l.line);
        out.push(
          "        <Line>",
          `          <RecordID>${l.line}</RecordID>`,
          `          <AccountID>${l.account}</AccountID>`,
          l.customerId ? `          <CustomerID>${text(l.customerId, 35)}</CustomerID>` : "",
          l.supplierId ? `          <SupplierID>${text(l.supplierId, 35)}</SupplierID>` : "",
          `          <Description>${text(l.text ?? e.text, 256) || text(e.text, 256)}</Description>`,
          `          <${side}Amount>`,
          `            <Amount>${saftAmount(l.amount)}</Amount>`,
          `          </${side}Amount>`,
        );
        if (l.vatCode !== null && lineVatMinor !== undefined) {
          const taxSide = lineVatMinor < 0 || (lineVatMinor === 0 && l.amount < 0) ? "Credit" : "Debit";
          out.push(
            "          <TaxInformation>",
            "            <TaxType>MVA</TaxType>",
            `            <TaxCode>${l.vatCode}</TaxCode>`,
            `            <TaxPercentage>${rateText(taxPercentOf(l.vatCode))}</TaxPercentage>`,
            "            <Country>NO</Country>",
            `            <TaxBase>${saftAmount(l.amount)}</TaxBase>`,
            `            <${taxSide}TaxAmount>`,
            `              <Amount>${saftAmount(lineVatMinor)}</Amount>`,
            `            </${taxSide}TaxAmount>`,
            "          </TaxInformation>",
          );
        }
        out.push("        </Line>");
      }
      out.push("      </Transaction>");
    }
    out.push("    </Journal>");
  }
  out.push("  </GeneralLedgerEntries>", "</AuditFile>");
  return out.filter((x) => x !== "").join("\n") + "\n";
}

/** The file's name as Skatteetaten names its examples: `SAF-T Financial_<organisation number>_<made, YYYYMMDDhhmmss>.xml`. */
export const saftFileName = (organisationNumber: string, stamp: string): string => `SAF-T Financial_${organisationNumber.replace(/\D/g, "")}_${stamp}.xml`;

/** A contact's first and last names from one name as people write it (the last word last; a dash for a part not known), else the email before its @. */
export function contactNames(name: string | null | undefined, email: string | null | undefined): { firstName: string; lastName: string } {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return { firstName: words.slice(0, -1).join(" "), lastName: words[words.length - 1] };
  if (words.length === 1) return { firstName: words[0], lastName: "-" };
  const local = (email ?? "").split("@")[0] ?? "";
  return { firstName: local || "-", lastName: "-" };
}

/** An address written on one line, `Storgata 1, 0150 Oslo`, in its parts where it reads so; else all of it as the street. */
export function addressOfLine(line: string | null | undefined, country: string | null): SaftAddress | null {
  const value = (line ?? "").trim();
  if (!value) return country ? { street: null, postalCode: null, city: null, country } : null;
  const m = /^(.*?),\s*(\d{4})\s+(.+)$/.exec(value);
  return m ? { street: m[1].trim() || null, postalCode: m[2], city: m[3].trim(), country } : { street: value, postalCode: null, city: null, country };
}

/** The standard account's name, for an account the file needs that the chart lacks (other equity carrying an earlier year's result). */
export const standardName = (account: number): string => standardAccount(String(account))?.nb ?? String(account);

/** The years a book can give a file for, newest first: from the year it opened to today's (or the year it closed), each only its days. */
export function saftYears(openedOn: string, closedOn: string | null, today: string): { year: number; from: string; to: string }[] {
  const last = Number((closedOn && closedOn < today ? closedOn : today).slice(0, 4));
  const years: { year: number; from: string; to: string }[] = [];
  for (let year = last; year >= Number(openedOn.slice(0, 4)); year--) {
    const from = `${year}-01-01` < openedOn ? openedOn : `${year}-01-01`;
    const to = closedOn && closedOn < `${year}-12-31` ? closedOn : `${year}-12-31`;
    if (from <= to) years.push({ year, from, to });
  }
  return years;
}
