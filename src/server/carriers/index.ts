import "server-only";

import type { CarrierId, ShippingCarrierAdapter } from "@/lib/shipping-carriers";

import { createBringAdapter } from "./bring";
import { createDhlAdapter } from "./dhl";
import { createHelthjemAdapter } from "./helthjem";
import { createInstaboxAdapter } from "./instabox";
import { createPorterbuddyAdapter } from "./porterbuddy";
import { createPostnordAdapter } from "./postnord";
import { createUpsAdapter } from "./ups";

/** The carriers whose connections are built (D133, D134, D136, D137, D138, D457). */
const ADAPTERS: Partial<Record<CarrierId, () => ShippingCarrierAdapter>> = {
  bring: () => createBringAdapter(),
  postnord: () => createPostnordAdapter(),
  porterbuddy: () => createPorterbuddyAdapter(),
  helthjem: () => createHelthjemAdapter(),
  instabox: () => createInstaboxAdapter(),
  dhl: () => createDhlAdapter(),
  ups: () => createUpsAdapter(),
};

export const adapterFor = (carrier: CarrierId): ShippingCarrierAdapter | null => ADAPTERS[carrier]?.() ?? null;
