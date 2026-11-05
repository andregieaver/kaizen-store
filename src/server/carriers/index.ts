import "server-only";

import type { CarrierId, ShippingCarrierAdapter } from "@/lib/shipping-carriers";

import { createBringAdapter } from "./bring";
import { createHelthjemAdapter } from "./helthjem";
import { createPorterbuddyAdapter } from "./porterbuddy";
import { createPostnordAdapter } from "./postnord";
import { createSendcloudAdapter } from "./sendcloud";

/** The carriers whose connections are built (D133, D134, D136, D137, D138; Sendcloud's first step, D454); the others are still being prepared. */
const ADAPTERS: Partial<Record<CarrierId, () => ShippingCarrierAdapter>> = {
  bring: () => createBringAdapter(),
  postnord: () => createPostnordAdapter(),
  porterbuddy: () => createPorterbuddyAdapter(),
  helthjem: () => createHelthjemAdapter(),
  sendcloud: () => createSendcloudAdapter(),
};

export const adapterFor = (carrier: CarrierId): ShippingCarrierAdapter | null => ADAPTERS[carrier]?.() ?? null;
