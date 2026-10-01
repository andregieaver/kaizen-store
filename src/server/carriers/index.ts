import "server-only";

import type { CarrierId, ShippingCarrierAdapter } from "@/lib/shipping-carriers";

import { createBringAdapter } from "./bring";
import { createPostnordAdapter } from "./postnord";

/** The carriers whose connections are built (D133, D134, D136); the others are still being prepared. */
const ADAPTERS: Partial<Record<CarrierId, () => ShippingCarrierAdapter>> = {
  bring: () => createBringAdapter(),
  postnord: () => createPostnordAdapter(),
};

export const adapterFor = (carrier: CarrierId): ShippingCarrierAdapter | null => ADAPTERS[carrier]?.() ?? null;
