/**
 * The modules a store can switch on (`stores.modules`, under Features): each
 * is an optional area of the admin and storefront. The database check
 * `stores_modules` allows exactly these; `store.bookingsOn`, `deliveriesOn` and
 * `workOn` read them.
 */
export const MODULES = ["bookings", "deliveries", "work"] as const;

export type StoreModule = (typeof MODULES)[number];

export const isModule = (value: string): value is StoreModule => (MODULES as readonly string[]).includes(value);
