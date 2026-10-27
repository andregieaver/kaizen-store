-- Customs and duties (wave 7 unit I, D343, docs/wave-7-storefront.md section 4, I):
-- * `commerce.duty_rates` is the platform's own table of duty rates and thresholds (decision 2): kept by hand at /admin/platform/duty-rates,
--   written only by src/server/duty-rates.ts, read only by src/server/customs.ts. Every row cites the address it was read from; none is
--   verified until a person checks it, and every figure built on it is labelled an estimate.
-- * `commerce.customs_settings` is a store's DDP or DAP choice per country (no row: DAP), written only by src/server/customs.ts.
-- * Both have row-level security on and no policy, like every commerce table: the server reaches them through its own connection.
--
-- The starter rows below are only those whose figures were read on 2026-10-27 at the address each cites; all unverified. Not added, for want of
-- a source that could be read or a rate the table can express: Switzerland (its duties are charged by gross weight, not as a share of the value),
-- United States heading rates (the general rates are on hts.usitc.gov, but the additional duties of 2025-2026 are not settled enough to state
-- here), Norway's heading rates and its rules for sellers outside VOEC (tolltariffen.toll.no could not be read), and the EU's heading rates.

ALTER TABLE commerce.duty_rates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.customs_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
INSERT INTO commerce.duty_rates
  (destination, hs_prefix, origin, applies_to, duty_rate_bps, per_item_minor, threshold_minor, vat_threshold_minor, threshold_currency, threshold_per,
   import_vat_bps, shipping_in_value, source, note, checked_on, verified, valid_from, valid_to)
VALUES
  -- United Kingdom: no customs duty on non-excise goods worth 135 GBP or less, and the seller includes UK VAT in the price (gov.uk).
  ('GB', '', NULL, 'any', NULL, NULL, 13500, 13500, 'GBP', 'consignment', NULL, true,
   'https://www.gov.uk/goods-sent-from-abroad/tax-and-duty',
   'Non-excise goods worth 135 GBP or less: no customs duty, VAT included by the seller. Above it, import VAT and duty are paid to the delivery company. Excise goods and gifts are not modelled. Whether shipping is part of the value is not read there.',
   '2026-10-27', false, NULL, NULL),
  -- T-shirts, singlets and other vests of cotton (6109.10): third-country duty 12 %, and 0 % for goods originating in the EU, Norway or Switzerland.
  ('GB', '610910', NULL, 'any', 1200, NULL, NULL, NULL, NULL, 'consignment', NULL, true,
   'https://www.trade-tariff.service.gov.uk/commodities/6109100010',
   'Third-country duty (ERGA OMNES), measure type 103, from 2021-01-01, as the Trade Tariff API answered for 6109100010.',
   '2026-10-27', false, NULL, NULL),
  ('GB', '610910', 'EU', 'any', 0, NULL, NULL, NULL, NULL, 'consignment', NULL, true,
   'https://www.trade-tariff.service.gov.uk/commodities/6109100010',
   'Tariff preference (measure type 142) for goods originating in the European Union, from 2021-01-01; needs a statement of origin.',
   '2026-10-27', false, NULL, NULL),
  ('GB', '610910', 'NO', 'any', 0, NULL, NULL, NULL, NULL, 'consignment', NULL, true,
   'https://www.trade-tariff.service.gov.uk/commodities/6109100010',
   'Tariff preference (measure type 142) for goods originating in Norway, from 2021-12-01; needs a statement of origin.',
   '2026-10-27', false, NULL, NULL),
  ('GB', '610910', 'CH', 'any', 0, NULL, NULL, NULL, NULL, 'consignment', NULL, true,
   'https://www.trade-tariff.service.gov.uk/commodities/6109100010',
   'Tariff preference (measure type 142) for goods originating in Switzerland, from 2021-01-01; needs a statement of origin.',
   '2026-10-27', false, NULL, NULL),
  -- United States: the de minimis exemption for 800 USD or less is suspended indefinitely (all modes but post; post in 2026-21600). No VAT.
  ('US', '', NULL, 'any', NULL, NULL, NULL, NULL, NULL, 'consignment', 0, false,
   'https://www.federalregister.gov/documents/2026/06/24/2026-12670/indefinite-suspension-of-the-de-minimis-exemption-for-merchandise-arriving-through-all-modes-other',
   'No de minimis: every import pays its duty. The United States has no VAT, so no import VAT. That the customs value leaves out the international freight is not read here.',
   '2026-10-27', false, NULL, NULL),
  -- Norway, a seller registered in VOEC: goods under 3000 NOK each are free of customs duty and VAT is paid to the shop (toll.no).
  ('NO', '', NULL, 'scheme', NULL, NULL, 299999, 299999, 'NOK', 'item', NULL, true,
   'https://www.toll.no/no/netthandel/VOEC',
   'VOEC: each item under 3000 NOK (here at most 2999.99), several in one parcel; free of customs duty, VAT paid in the shop. Food, alcohol, tobacco, restricted goods and goods with excise duties are outside VOEC and are not modelled.',
   '2026-10-27', false, NULL, NULL),
  -- The EU: consignments of negligible value (an intrinsic value not exceeding 150 EUR) are free of import duties (Regulation 1186/2009 Art. 23),
  -- with the VAT collected at the sale under IOSS (the Commission's One Stop Shop page, D157) ...
  ('EU', '', NULL, 'scheme', NULL, NULL, 15000, 15000, 'EUR', 'consignment', NULL, true,
   'https://www.legislation.gov.uk/eur/2009/1186/article/23',
   'Art. 23: goods of negligible value (intrinsic value not exceeding 150 EUR per consignment) dispatched from a third country are admitted free of import duties. Read on legislation.gov.uk''s copy of the Regulation. The VAT threshold is the IOSS limit of 150 EUR.',
   '2026-10-27', false, NULL, '2026-06-30'),
  -- ... until 30 June 2026. From 1 July 2026 a fixed duty of 3 EUR applies to each different item (by tariff heading or sub-heading) in a parcel
  -- valued at less than 150 EUR whose seller uses IOSS (the Council's agreement of 12 December 2025, as reported).
  ('EU', '', NULL, 'scheme', NULL, 300, 15000, 15000, 'EUR', 'consignment', NULL, true,
   'https://www.spielwarenmesse.de/en/mag/toy-market-news/council-agrees-to-levy-customs-duty-on-small-parcels/',
   'A report of the Council''s agreement: a fixed 3 EUR per different item in parcels valued at less than 150 EUR, from 1 July 2026, for sellers registered in IOSS. The Council''s own page (consilium.europa.eu) could not be read; whether an item is counted by heading or by six-digit sub-heading, and whether exactly 150 EUR is inside, are to verify. Counted here by sub-heading, the threshold inclusive.',
   '2026-10-27', false, '2026-07-01', NULL),
  -- Consignments outside IOSS keep the relief (the 3 EUR applies only where IOSS is used, as reported); their import VAT is paid at the border.
  ('EU', '', NULL, 'no_scheme', NULL, NULL, 15000, NULL, 'EUR', 'consignment', NULL, true,
   'https://www.legislation.gov.uk/eur/2009/1186/article/23',
   'Art. 23 relief (not exceeding 150 EUR per consignment). That the relief stays for consignments outside IOSS after 1 July 2026 is from reports of the Council''s agreement, to verify. Import VAT is due at the border for every value.',
   '2026-10-27', false, NULL, NULL);
