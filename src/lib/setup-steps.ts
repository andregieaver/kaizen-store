/**
 * The setup wizard's steps (`/admin/{store}/setup/{step}`), pure. Since D178 step 6 the wizard follows the store's features: it asks first
 * what the store will sell (`features`), and the steps that need the online shop (payments, products) are left out for a website, while the
 * bookings step is there only while Appointments or Stays and rentals is on. Progress is read from the store's data (`getSetupProgress()`),
 * never stored.
 */

import { featureOn, type FeatureSource } from "./store-features";

export const SETUP_STEPS = [
  { id: "features", title: "What you sell" },
  { id: "details", title: "Your business" },
  { id: "countries", title: "Where you sell" },
  { id: "bookings", title: "Bookings" },
  { id: "payments", title: "Payments" },
  { id: "products", title: "Products" },
  { id: "launch", title: "Open your store" },
] as const;

export type SetupStepId = (typeof SETUP_STEPS)[number]["id"];
export type SetupStep = { id: SetupStepId; title: string };

export function isSetupStep(value: string): value is SetupStepId {
  return SETUP_STEPS.some((step) => step.id === value);
}

/** Whether a step belongs in the wizard of a store with these features. */
export function stepApplies(id: SetupStepId, features: FeatureSource): boolean {
  switch (id) {
    case "payments":
    case "products":
      return featureOn(features, "shop");
    case "bookings":
      return featureOn(features, "appointments") || featureOn(features, "bookings");
    default:
      return true;
  }
}

/** The wizard's steps for a store with these features, in order (a website's "Where you sell" is its country). */
export function setupStepsFor(features: FeatureSource): SetupStep[] {
  return SETUP_STEPS.filter((step) => stepApplies(step.id, features)).map(
    (step): SetupStep => (step.id === "countries" && !featureOn(features, "shop") ? { id: step.id, title: "Your country" } : { id: step.id, title: step.title }),
  );
}

/** The step after this one in a store with these features ("launch" at the end, and for a step the store does not have). */
export function nextSetupStep(step: SetupStepId, features: FeatureSource): SetupStepId {
  const steps = setupStepsFor(features);
  const index = steps.findIndex((s) => s.id === step);
  return index >= 0 && steps[index + 1] ? steps[index + 1].id : "launch";
}

/** Where the wizard resumes: the first step of the store's that is not done (the launch step when all are). */
export function firstOpenStep(features: FeatureSource, done: Partial<Record<SetupStepId, boolean>>): SetupStepId {
  return setupStepsFor(features).find((step) => step.id !== "launch" && !done[step.id])?.id ?? "launch";
}
