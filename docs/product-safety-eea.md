# Product safety in the EU and the EEA (D452)

Which responsible person a product needs depends on where it is sold. This document says how Kaizena Flow decides, what the law said
when it was last checked, and how to change it when the law changes.

## 1. Two classifications, kept apart

`commerce.country_memberships` records each country's membership of the **EU** and of the **EEA** as two separate columns. Neither is
worked out from the other:

| Group | Countries | `eu` | `eea` |
|---|---|---|---|
| EU member states | the 27 | true | true |
| EEA EFTA states | Norway (NO), Iceland (IS), Liechtenstein (LI) | **false** | true |
| Anywhere else (Switzerland, the UK, China, …) | no row | false | false |

The table holds any country a company may be established in, whether or not a store can sell there. Iceland and Liechtenstein are in it
even though `commerce.countries` (the countries a store can sell to) does not list them. `countries.in_eu`, which VAT and the tax reports
read, must stay equal to `country_memberships.eu`. `src/db/commerce.test.ts` checks that.

## 2. A rule per destination, configured

`commerce.product_safety_rules` says, for each destination country, what the General Product Safety Regulation (GPSR, Regulation (EU)
2023/988) asks of a product whose manufacturer is established elsewhere:

| `responsible_person` | Meaning |
|---|---|
| `eu` | A responsible person established in the **EU** (GPSR Art. 16(1)). A company in Norway, Iceland or Liechtenstein does **not** satisfy it. |
| `eea` | A responsible person established in the **EEA**. For an EEA EFTA state once the GPSR is incorporated and in force there, if the Joint Committee decision adapts Art. 16 that way. |
| `none` | This regulation asks for none there. |

Each row also has `status` (`in_force`, `not_incorporated`, `incorporated_not_in_force`), `legal_basis`, `source`, `reviewed_on` and a
`note`. A rule whose status is not `in_force` must ask for `none` (a database check). An EU member state without a row is held to `eu`,
so the EU's rule never lapses for want of a row. Any other country without a row asks for nothing.

**How a product is checked.** The destinations are the countries the store sells to (its active markets). For each one whose rule asks
for a responsible person, and where the manufacturer is not itself established in the area the rule names, a responsible person
established in that area is required. A store that sells to Sweden and Norway, with a Norwegian maker, needs an **EU** responsible person,
because Sweden asks for one and Norway is not in the EU. The same rule runs in three places, and each is tested on the same cases:

- `src/lib/product-safety.ts` (pure): `responsibleAreas()`, `missingResponsible()`. Read by the product check `productProblems()` and by
  *Who makes your products?* (D445 step 6).
- `src/server/product-safety.ts`: `productSafety()` reads the two tables for the server.
- The database: `commerce.responsible_person_areas(store, maker_country)` and `commerce.is_established_in(area, country)`, used by the
  publish check `commerce.assert_product_publishable()`. The database refuses a product the code would refuse.

A product's per-country availability (D335) is not taken into account. The check uses every active market, so it can only be stricter.

Every physical product still needs a manufacturer, wherever it is sold. That rule is unchanged.

## 3. The law as last checked (3 November 2026)

| Destination | Rule seeded | Status | Basis and source |
|---|---|---|---|
| The 27 EU member states | `eu` | `in_force` | GPSR Art. 16(1) and 19, applies from 13 December 2024 ([EUR-Lex](https://eur-lex.europa.eu/eli/reg/2023/988/oj)) |
| Norway | `none` | `not_incorporated` | Not incorporated into the EEA Agreement. EEA-Lex lists it as under scrutiny ([EFTA](https://www.efta.int/eea-lex/32023r0988)). Norway's EEA note of 27 January 2026 says incorporation needs a change in law and the Storting's consent ([regjeringen.no](https://www.regjeringen.no/no/sub/eos-notatbasen/notatene/2024/juli/produktsikkerhetsforordningen/id3147443/)). DSB says produktkontrolloven, implementing Directive 2001/95/EC, still applies ([DSB](https://www.dsb.no/produkter-og-forbrukertjenester/aktuelt-produkter-og-forbrukertjenester/ny-produktsikkerhetsforordning-i-eu-gpsr/)). |
| Iceland | `none` | `not_incorporated` | Not incorporated into the EEA Agreement ([EFTA](https://www.efta.int/eea-lex/32023r0988)). |
| Liechtenstein | `none` | `not_incorporated` | Not incorporated into the EEA Agreement ([EFTA](https://www.efta.int/eea-lex/32023r0988)). |

**What `none` for Norway changes.** Before D452 the publish check asked an EU responsible person of every manufacturer outside the EU,
whatever the store sold to. A store selling **only** to Norway (or Iceland, or Liechtenstein) is now asked for none, because the GPSR is
not law there yet. A store selling to any EU country is asked exactly what it was asked before.

This is a reading of public sources, not legal advice. Have it checked before relying on it, and again whenever the status below changes.

## 4. Updating a rule

When the EEA Joint Committee incorporates the GPSR, read the decision. It may adapt Art. 16, for instance so that a responsible person
established in an EEA EFTA state is enough there. Then, once it is in force in a country:

1. Write a custom migration (`pnpm exec drizzle-kit generate --custom --name product_safety_<country>`), for example:

   ```sql
   UPDATE commerce.product_safety_rules
      SET responsible_person = 'eea', status = 'in_force',
          legal_basis = 'Regulation (EU) 2023/988 as incorporated by EEA Joint Committee Decision No …/…, in force …',
          source = 'https://www.efta.int/eea-lex/32023r0988', reviewed_on = DATE '…', updated_at = now()
    WHERE destination = 'NO';
   ```

   If it is incorporated but not yet in force, set `status = 'incorporated_not_in_force'` and keep `responsible_person = 'none'`.
2. Update the table in section 3 and the D452 row in `docs/decisions.md`.
3. Push. CI applies the migration before the deploy. Nothing in the code changes. `src/db/commerce.test.ts` already tests the `eea` rule
   for Norway ("follows the configured rule once the GPSR is incorporated for Norway").

A new country that can be sold to (a row in `commerce.countries`) needs a `country_memberships` row with the same `eu` value as its
`in_eu`, and a rule if the GPSR or a law like it applies there.
