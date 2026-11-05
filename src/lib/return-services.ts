import { BRING_RETURN_DEFAULT, BRING_RETURN_SERVICES } from "./bring";
import { DHL_PAKET_RETURN_DEFAULT, DHL_PAKET_RETURN_SERVICES } from "./dhl-paket";
import { INSTABOX_RETURN_DEFAULT, INSTABOX_RETURN_SERVICES } from "./instabox";
import { POSTNORD_RETURN_DEFAULT, POSTNORD_RETURN_SERVICES } from "./postnord";
import { UPS_RETURN_DEFAULT, UPS_RETURN_SERVICES } from "./ups";
import type { CarrierId } from "./shipping-carriers";

/**
 * The return services each carrier books return labels with (D239, D458): the store chooses one in its return settings, or the carrier's default.
 * Only carriers whose connection has `bookReturn()` and `return_labels` in `available` are here. Pure, for the settings form and the server's checks.
 */
export type ReturnService = { id: string; name: string; confirmed: boolean };

export const RETURN_SERVICES: Partial<Record<CarrierId, { services: ReturnService[]; default: string }>> = {
  bring: { services: BRING_RETURN_SERVICES, default: BRING_RETURN_DEFAULT },
  postnord: { services: POSTNORD_RETURN_SERVICES, default: POSTNORD_RETURN_DEFAULT },
  instabox: { services: INSTABOX_RETURN_SERVICES, default: INSTABOX_RETURN_DEFAULT },
  ups: { services: UPS_RETURN_SERVICES, default: UPS_RETURN_DEFAULT },
  dhl_paket: { services: DHL_PAKET_RETURN_SERVICES, default: DHL_PAKET_RETURN_DEFAULT },
};

/** The service a return label is booked with: the one chosen, else the carrier's default; "" for a carrier with none. */
export const returnServiceFor = (carrier: CarrierId, chosen: string | null | undefined): string => chosen || RETURN_SERVICES[carrier]?.default || "";

/** Whether a service is one of the carrier's return services. */
export const isReturnService = (carrier: string, service: string): boolean => Boolean(RETURN_SERVICES[carrier as CarrierId]?.services.some((s) => s.id === service));
