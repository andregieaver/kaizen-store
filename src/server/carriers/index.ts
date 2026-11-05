import "server-only";

import type { CarrierId, ShippingCarrierAdapter } from "@/lib/shipping-carriers";

import { createBringAdapter } from "./bring";
import { createDhlAdapter } from "./dhl";
import { createDhlPaketAdapter } from "./dhl-paket";
import { createHelthjemAdapter } from "./helthjem";
import { createInstaboxAdapter } from "./instabox";
import { createNshiftAdapter } from "./nshift";
import { createPorterbuddyAdapter } from "./porterbuddy";
import { createPostnordAdapter } from "./postnord";
import { createSendcloudAdapter } from "./sendcloud";
import { createUpsAdapter } from "./ups";

/** The carriers whose connections are built (D133, D134, D136, D137, D138, D458, D459; Sendcloud's first step, D483). */
const ADAPTERS: Partial<Record<CarrierId, () => ShippingCarrierAdapter>> = {
  bring: () => createBringAdapter(),
  postnord: () => createPostnordAdapter(),
  porterbuddy: () => createPorterbuddyAdapter(),
  helthjem: () => createHelthjemAdapter(),
  instabox: () => createInstaboxAdapter(),
  dhl: () => createDhlAdapter(),
  ups: () => createUpsAdapter(),
  dhl_paket: () => createDhlPaketAdapter(),
  nshift: () => createNshiftAdapter(),
  sendcloud: () => createSendcloudAdapter(),
};

export const adapterFor = (carrier: CarrierId): ShippingCarrierAdapter | null => ADAPTERS[carrier]?.() ?? null;
