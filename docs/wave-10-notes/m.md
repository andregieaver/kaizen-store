# Wave 10 unit M (D376): reduced VAT rates with their sources

Notes for the custom migration that runs `m.sql`: 130 `commerce.set_vat_rate()` calls, one per (country, category)
pair that has no row today, every one read from an official source on 2026-10-28, none verified (`verified_at` is
set by a platform admin through `commerce.verify_vat_rate()`, never by code). `m.sql` applies cleanly on a fresh
`scripts/db-setup.mjs --seed` database (checked on 2026-10-28: 130 rows added, all with `checked_on` 2026-10-28 and
`verified_at` null).

## Sources read

| Source | Address | What it is | Read |
|---|---|---|---|
| European Commission, *VAT rates* | https://taxation-customs.ec.europa.eu/taxation/vat/vat-directive/vat-rates_en | The Commission's VAT rates page. It links no PDF: it says "The VAT rates applied in each Member State can be consulted in the Taxes in Europe Database (TEDB)", with the note that the information "is provided by EU Member States themselves". | 2026-10-28 |
| European Commission, *Taxes in Europe Database (TEDB)*, VAT search | https://ec.europa.eu/taxation_customs/tedb/ (the page's own API: `POST https://ec.europa.eu/taxation_customs/tedb/rest-api/vatSearch` with the member states, a date and one TEDB category id; the categories from `GET …/rest-api/vatHistorySearch`) | The main source. Searched for 28 October 2026, which returns each country's latest *situation*: 1 July 2026 for 24 countries, 1 January 2026 for CY, EL (Greece) and PT. Searched again for 1 January 2026 to find rates that changed during 2026. | 2026-10-28 |
| Agencia Tributaria, *Tipos impositivos en el IVA 2026* | https://sede.agenciatributaria.gob.es/static_files/Sede/Tema/IVA/IVA_reperc/Tipos_IVA_2026_26_02_2026.pdf | Spain's official table of 2026 rates (PDF, title "Tipos impositivos en el IVA 2026", file dated 26 February 2026, PDF metadata March 2026). Used for Spain's books, periodicals and medicines, which TEDB lists only as an uncategorised 4 % entry ("Exemptions and super-reduced rates (Article 105a(1))"). | 2026-10-28 |
| Revenue (Ireland), *Clothing* and *Footwear* | https://www.revenue.ie/en/vat/vat-on-goods/clothing-footwear/clothing.aspx and https://www.revenue.ie/en/vat/vat-on-goods/clothing-footwear/footwear.aspx | Ireland's official pages (both "Published: 11 November 2025"): the zero rate for clothing for children under 11 and for children's personal footwear. TEDB lists no rate for children's clothing in Ireland. | 2026-10-28 |
| Skatteetaten, *Value added tax* (rates) | https://www.skatteetaten.no/en/rates/value-added-tax/ | Norway (not in the EU): 2026 rates. Read only to check the existing Norwegian rows; it adds none. | 2026-10-28 |

The Commission's PDF *VAT rates applied in the Member States of the European Union* is no longer published: the Commission's
page above links none and points to TEDB, and search results for the document found only old editions (to 2021) and third-party
copies, which were not used. TEDB's own disclaimer applies to every row: the data is the Member States' and is not a legal
reference.

## How each EC column was mapped

TEDB has a category per column of the old PDF; a country's entries in it each carry a rate, a kind (*Reduced rate*,
*Super-reduced rate*, *Exempted*), CN codes and a comment. Entries of the category *Special reduced rate for specific regions*
(Corsica, the French overseas departments, Madeira, the Azores, Jungholz, the Aegean islands, …) were left out everywhere.

| EC / TEDB column | TEDB category id | Our category | Rule |
|---|---|---|---|
| Foodstuffs | 246 | `food` | Where a country has several rates, the one covering most foodstuffs: the rate whose entries list the most CN codes, read against the comments (SK: TEDB's 19 % entry says "All foodstuffs except the selected items taxed at 5 %"). A country whose only food rate is for a narrow list (BG: baby food; LV: certain fresh bread, milk, poultry, eggs, fruit and vegetables) gets no row. |
| Books (*Supply, including on loan by libraries, of books, newspapers and periodicals*) | 252 (and 575 *Books* for CY) | `books` | Printed books' rate. |
| Newspapers; Periodicals | 253; 254 (and 252 where a country lists them there) | `periodicals` | The rate TEDB gives under *Periodicals*, else under *Newspapers*, else the combined books entry where its CN codes include 4902. Where newspapers and periodicals differ, the periodicals' rate, with the newspapers' in the note. |
| Pharmaceutical products | 248 | `medicines` | Medicines' rate. A country whose only entry is for contraceptives, hygiene products or nappies gets no row (AT, BG, DE). Where reimbursed and other medicines differ, the rate of medicines bought without reimbursement (FR 10 %, not 2.1 %); a rate only for reimbursed or prescribed medicines gets no row (LT). |
| Admission to cultural services (*Admission to shows, theatres, circuses, fairs, amusement parks, concerts, museums, zoos, cinemas, exhibitions…*) | 255 | `culture_events` | The rate for shows (theatre, concerts); an exemption that depends on who organises it is not a rate (DK, LV); a rate for one narrow thing gets no row (HU: open-air festivals only). |
| Children's clothing and footwear; children's car seats | 599, 624, 639, 676; 250 | `children_goods` | Only where the country has a reduced rate for children's clothing: LU (639) and IE (Revenue). Car seats alone (CY 5, CZ 12, EL 13, HR 13, PL 5 %) give no row, as the category is for clothing, footwear and car seats together. |
| Hotel accommodation | 262 | `accommodation` | Hotel accommodation's rate; NL gets none, as TEDB's only Dutch entry describes camping (Tabel I b.10), not hotel rooms. |

Where TEDB lists a country's entry as *Exempted* at 0 % and its comment says zero rate or "exempt with credit" (IE food, books,
medicines; MT food and medicines), the row is 0 %. Czech books are listed as *Exempted* with no such comment: the row is 0 % and its
note asks the verifier to check that the right of deduction applies.

`valid_from` is 2026-01-01 everywhere except Belgian accommodation. The 1 January 2026 search differs from the latest one in four
places: Austrian food (a 4.9 % super-reduced rate for Annex 3 foodstuffs from 1 July 2026, beside the 10 % kept here), Irish
restaurant food (not a category of ours), Swedish food (12 % → 6 %, already in the database from 1 April 2026) and **Belgian
accommodation (6 % → 12 %)**. TEDB does not say when the Belgian change happened; the row starts on 2026-07-01, the first situation that
shows it, and its note says that secondary sources (not official texts read) give 1 March 2026. As rates apply to new carts only,
the start date matters only for the record.

## Rows after the migration

`*` an existing row (not added), `†` read from a national source (AEAT, Revenue) rather than TEDB, `–` no row (the standard rate
applies).

| Country | food | books | periodicals | medicines | culture_events | accommodation | children_goods |
|---|---|---|---|---|---|---|---|
| AT | 10 | 10 | 10 | – | 13 | 10 | – |
| BE | 6 | 6 | 6 | 6 | 6 | 12 (from 2026-07-01) | – |
| BG | – | 9 | 9 | – | – | 9 | – |
| CY | 5 | 3 | 3 | 5 | 5 | 9 | – |
| CZ | 12 | 0 | 12 | 12 | 12 | 12 | – |
| DE | 7* | 7* | 7* | – | 7 | 7* | – |
| DK | – | – | – | – | – | – | – |
| EE | – | 9 | 9 | 9 | – | 13 | – |
| ES | 10 | 4† | 4† | 4† | 10 | 10 | – |
| FI | 13.5* | 13.5 | 10* | 13.5 | 13.5 | 13.5 | – |
| FR | 5.5 | 5.5 | 2.1 | 10 | 5.5 | 10 | – |
| GR | 13 | 6 | 6 | 6 | 6 | 13 | – |
| HR | 5 | 5 | 13 | 5 | 5 | 13 | – |
| HU | 5 | 5 | 5 | 5 | – | 5 | – |
| IE | 0 | 0 | 9 | 0 | 13.5 | 13.5 | 0† |
| IT | 10 | 4 | 4 | 10 | 10 | 10 | – |
| LT | – | 5 | 5 | – | 12 | 12 | – |
| LU | 3 | 3 | 3 | 3 | – | – | 3 |
| LV | – | 5 | 5 | 12 | – | 12 | – |
| MT | 0 | 5 | 5 | 0 | 5 | 7 | – |
| NL | 9 | 9 | 9 | 9 | 9 | – | – |
| NO | 15* | 0* | 0* | – | 12* | 12* | – |
| PL | 5 | 5 | 8 | 8 | 8 | 8 | – |
| PT | 6 | 6 | 6 | 6 | – | 6 | – |
| RO | 11 | 11 | 11 | 11 | 11 | 11 | – |
| SE | 12* → 6* (1 Apr) | 6* | 6* | – | 6 | 12* | – |
| SI | 9.5 | 5 | 5 | 9.5 | 9.5 | 9.5 | – |
| SK | 19 | 5 | – | 5 | 5 | 5 | – |

Added: food 19, books 24, periodicals 22, medicines 21, culture_events 20, accommodation 22, children_goods 2 (130). Greece is `GR`
in `commerce.countries` and `EL` in TEDB; the SQL writes `GR` and the source names `EL (Greece)`. Each row's note keeps the
caveats that matter (narrower scope, another rate for part of the category); read them before verifying.

## Existing rows against the sources

| Row | Database | Source read 2026-10-28 | Agrees |
|---|---|---|---|
| DE food | 7 % | TEDB *Foodstuffs*: 7 % | Yes |
| DE books | 7 % | TEDB 252: 7 % | Yes |
| DE periodicals | 7 % | TEDB *Newspapers*, *Periodicals*: 7 % | Yes |
| DE accommodation | 7 % | TEDB 262: 7 % (short-term accommodation only) | Yes |
| FI food | 13.5 % | TEDB *Foodstuffs*: 13.5 % | Yes |
| FI periodicals | 10 % | TEDB *Newspapers*, *Periodicals*: 10 % | Yes |
| SE food | 12 % to 2026-04-01, then 6 % | TEDB *Foodstuffs*: 12 % on 1 January 2026, 6 % on 1 July 2026 | Yes (TEDB does not give the April date) |
| SE books | 6 % | TEDB 252: 6 % | Yes |
| SE periodicals | 6 % | TEDB 252: 6 % (books, newspapers etc.) | Yes |
| SE accommodation | 12 % | TEDB 262: 12 % | Yes |
| NO food | 15 % | Skatteetaten: "Foodstuffs 15 %" | Yes |
| NO accommodation | 12 % | Skatteetaten: "letting of rooms … 12 %" (accommodation) | Yes |
| NO culture_events | 12 % | Skatteetaten: 12 % for "entry to cinemas, sporting events, amusement parks and activity centres" | Yes for those; the page does not name theatres or concerts, which the existing row's category also covers |
| NO books, periodicals | 0 % | Not on the rates page read (the rows cite the VAT Act's exemption) | Not checked against a source today |

No existing row disagrees with what was read.

## Left out, and why

- **Denmark, every category**: TEDB lists no reduced rate (only exemptions for cultural activities of certain bodies, which depend
  on the supplier, not the goods). Denmark's zero rate for newspapers is not in TEDB and was not read elsewhere.
- **food**: BG (9 % only for baby food and special milk formulas), LV (12 % only for certain fresh bread, milk, poultry, eggs, fresh
  fruit, berries, vegetables and infant food), EE and LT (no entry).
- **books**: DK (no entry). (SK is added from TEDB's *Newspapers* entry, whose text is about printed books; see its note.)
- **periodicals**: SK (5 % only for newspapers appearing at least four times a week, CN 4902 10 00), DK (no entry).
- **medicines**: AT (TEDB's only entry is 0 % for contraceptives and feminine hygiene from 1 January 2026), BG (9 % only for baby
  nappies), DE (7 % only for hygiene products), LT (5 % only for reimbursed or prescribed medicines; medicines bought without a
  prescription are at the standard rate, so a 5 % row would under-charge a web shop's sales), DK, SE, NO (no entry).
- **culture_events**: DK and LV (exemptions, not a rate), HU (18 % only for open-air festivals), BG, EE, LU, PT (no entry outside
  the regional rates).
- **accommodation**: NL (TEDB's 9 % entry describes camping only; hotel accommodation was not read), LU, DK (no entry).
- **children_goods**: every country but LU and IE: no reduced rate for children's clothing in TEDB. Car-seat-only rates (CY 5 %,
  CZ 12 %, EL 13 %, HR 13 %, PL 5 %) are left out on purpose.
- Rates that apply to part of a category and differ from the row chosen (AT 4.9 % basic food from 1 July 2026, ES 4 % basic food,
  IT 4 % staples, SK 5 % basic food, FR 2.1 % reimbursed medicines, IE zero-rated newspapers, HR and PL lower rates for some
  periodicals, …) are not rows: our categories hold one rate per country, and the notes name them.

## D376 (for `docs/decisions.md`)

| D376 | **Reduced VAT rates with their sources (wave 10 unit M, `docs/wave-10-must-haves.md` 4, `docs/wave-10-notes/m.md`); built.** A custom migration enters 130 reduced rates through `commerce.set_vat_rate()` for the countries and categories that had none (food, books, periodicals, medicines, culture and events, accommodation, children's goods): 23 EU countries that had none and the missing categories of Germany, Finland and Sweden, while Denmark has no reduced rate for them and Norway needed none. Each was read on 2026-10-28 from an official source, named with its address in `source`: the European Commission's Taxes in Europe Database (its VAT search for each country's latest situation, 1 July 2026, or 1 January 2026 for Cyprus, Greece and Portugal; the Commission's VAT rates page links no other document), the Agencia Tributaria's 2026 table for Spain's books, periodicals and medicines, and Revenue's pages for Ireland's children's clothing and footwear. Where a country has several rates for a category, the row is the one covering most of it and the note names the others; a rate for only a narrow part of a category, an exemption that depends on the supplier, or no reduced rate gives no row, so the standard rate stays the fallback (Denmark has none; the rest are listed in the notes). Rates start on 1 January 2026, except Belgian accommodation (12 %, from 1 July 2026, the first situation that shows the change from 6 %). Every row's note begins *Unverified*: `verified_at` stays null until a platform admin checks it with an accountant, never by code, and the existing rows of Germany, Finland, Sweden and Norway agree with what was read. `checkout.eu-vat-by-destination-vat-inclusive-prices-reduced-rates` stays partial. Migration versions: (not yet applied). |

## Gap sentence for the parity row

Replace point (1) of the row's `gap` with:

> (1) the rate data is entered but unverified: since D376 (wave 10 unit M) every EU country has its reduced rates for food, books,
> periodicals, medicines, culture and accommodation (and Luxembourg's and Ireland's for children's clothing) where the country has
> one, 130 rows read on 2026-10-28 from the European Commission's Taxes in Europe Database (Spain's books, periodicals and medicines
> from the Agencia Tributaria, Ireland's children's clothing from Revenue), each with its source address and checked-on date
> (criterion 4); no row has `verified_at` set, which only a platform admin does after checking with an accountant, never code, and a
> category with several national rates holds the main one with the others named in its note, so the row stays partial until a person
> has verified them;

The rest of the gap ((2) shipping rules, (3) the cached VAT label) is unchanged.
