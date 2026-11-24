import "server-only";

import { sql, type SQL } from "drizzle-orm";

/**
 * A column of a typed-in organisation number as nine digits (`NO 923 609 016 MVA` → `923609016`), null when it holds no digits (D891): how
 * a store's business customer, a store's own business and the register's rows (`register_companies`) are joined. Its own module, so the
 * staff alerts, the Home's counts and the platform's briefing read it without the register's calls.
 */
export const orgNumberSql = (column: SQL) => sql`nullif(regexp_replace(regexp_replace(upper(${column}), '^NO|MVA$', '', 'g'), '[^0-9]', '', 'g'), '')`;
