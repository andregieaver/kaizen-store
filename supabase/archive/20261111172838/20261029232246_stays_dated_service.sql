-- D407: a booked service keeps the right of withdrawal unless it is one the law exempts on a set date (CRD Art. 16(l);
-- angrerettloven § 22 m; distansavtalslagen 2 kap. 11 § 12; forbrugeraftaleloven § 18 stk. 2 nr. 12). Until now every booking
-- was recorded as exempt whatever the product said; from now the product's own exclusion decides. Stays are accommodation on set
-- dates, so they start exempt; appointments and rentals keep the right unless the owner marks them (car rental, catering, leisure).
-- Products' updated_at is left alone, so demo content (D260) is still recognised as untouched. The publishing check is held off for
-- this one statement: it changes no field that check reads, and a product that would fail it today must not stop the correction.
ALTER TABLE commerce.products DISABLE TRIGGER products_publishable;
--> statement-breakpoint
UPDATE commerce.products SET withdrawal_exclusion = 'dated_service' WHERE kind = 'stay' AND withdrawal_exclusion = 'none';
--> statement-breakpoint
-- The deferred checks the update queued run now, so the trigger can be switched back on in the same transaction.
SET CONSTRAINTS ALL IMMEDIATE;
--> statement-breakpoint
ALTER TABLE commerce.products ENABLE TRIGGER products_publishable;
