import { describe, expect, it } from "vitest";

import * as limits from "./shipping-limits";

/** Every number of `docs/wave-3-shipping-methods.md` 4.8, pinned: a change here is a reviewed change to the spec, the database's checks and the screens. */
describe("the shipping limits", () => {
  it("are the spec's numbers", () => {
    expect({ ...limits }).toEqual({
      PROFILES_MAX: 20,
      ZONES_MAX: 20,
      METHODS_MAX: 10,
      TIERS_MAX: 10,
      PATTERNS_MAX: 1_000,
      PATTERN_CHARS_MAX: 3_000,
      PATTERN_LENGTH_MAX: 10,
      AREAS_PER_PLACE_MAX: 10,
      AREAS_MAX: 30,
      RADIUS_KM_MAX: 160,
      RADIUS_KM_MIN: 1,
      READY_HOURS_MAX: 720,
      INSTRUCTIONS_MAX: 1_000,
      INFO_MAX: 500,
      NOTE_MAX: 500,
      ESTIMATE_DAYS_MAX: 60,
      DEFAULT_WEIGHT_GRAMS: 500,
      WEIGHT_GRAMS_MAX: 35_000,
      NAME_MAX: 60,
      POSTAL_CODE_MAX: 12,
      EARTH_RADIUS_KM: 6_371.0088,
    });
  });
});
