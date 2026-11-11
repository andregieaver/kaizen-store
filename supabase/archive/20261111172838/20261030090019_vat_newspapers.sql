-- D407 step 6 (docs/legal/check-2026-10-29.md section 5): newspapers apart from magazines, and the categories' words narrowed.
-- Rates only through commerce.set_vat_rate(), each with the source it was read from.

INSERT INTO commerce.vat_categories (code, name_en, description, sort, active, built_in) VALUES
  ('newspapers', 'Newspapers', 'Newspapers, also electronic, mainly text and still pictures, out at least monthly. Magazines are Newspapers and periodicals.', 39, true, false)
ON CONFLICT (code) DO NOTHING;

UPDATE commerce.vat_categories SET description =
  'Magazines and periodicals at a reduced rate. Norway: 0 % only if sold mainly to subscribers or members, or mainly political, literary or religious (mval § 6-3). Denmark: standard rate.'
WHERE code = 'periodicals';

UPDATE commerce.vat_categories SET description =
  'Admission to events and attractions at a reduced rate. Sweden: amusement parks take the standard rate. Norway: 12 % checked for cinemas, sport, amusement parks and activity centres only.'
WHERE code = 'culture_events';

SELECT commerce.set_vat_rate('DK', 'newspapers', 0.0000, DATE '2026-01-01',
  'Momsloven (LBK nr 209 af 27/02/2024) § 34 stk. 1 nr. 18, https://www.retsinformation.dk/eli/lta/2024/209/xml : "Levering af aviser, herunder aviser leveret elektronisk, som normalt udkommer med mindst ét nummer månedligt."',
  DATE '2026-10-29', 'Zero-rated (fritaget med fradragsret): no VAT in the price. Magazines take the standard rate.', NULL);
SELECT commerce.set_vat_rate('NO', 'newspapers', 0.0000, DATE '2026-01-01',
  'Merverdiavgiftsloven § 6-1, https://lovdata.no/dokument/NL/lov/2009-06-19-58/KAPITTEL_6 : "Omsetning av aviser, herunder elektroniske aviser, som inneholder en overveiende andel tekst og stillbilder" "er fritatt for merverdiavgift."',
  DATE '2026-10-30', 'Zero-rated: no VAT in the price. The ministry''s regulation on what counts as a newspaper was not read.', NULL);
SELECT commerce.set_vat_rate('SE', 'newspapers', 0.0600, DATE '2026-01-01',
  'Skatteverket, https://www.skatteverket.se/foretag/moms/saljavarorochtjanster/momssatsermedmera.4.58d555751259e4d66168000409.html (books, newspapers and periodicals 6 %)',
  DATE '2026-10-29', 'Publications mostly made of advertising are excluded.', NULL);

-- Every other country: the rate of its periodicals row, whose source was read for newspapers and periodicals together or for periodicals
-- alone; marked so, to be read for newspapers on their own.
SELECT commerce.set_vat_rate(r.country_code, 'newspapers', r.rate, r.valid_from, r.source, r.checked_on,
  'Unverified: copied on 2026-10-30 from this country''s rate for periodicals; newspapers were not read on their own.', NULL)
FROM commerce.vat_rates r
WHERE r.category = 'periodicals' AND r.valid_to IS NULL AND r.country_code NOT IN ('DK', 'NO', 'SE')
ORDER BY r.country_code;
