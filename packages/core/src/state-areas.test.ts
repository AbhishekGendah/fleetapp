import { describe, expect, it } from "vitest";

import { AUSTRALIAN_STATE_CODES } from "./postcodes";
import { STATE_AREAS } from "./state-areas";
import { stateForTimezone } from "./timezones";

const CAPITAL_CITIES = {
  WA: { latitude: -31.95, longitude: 115.86 },
  NT: { latitude: -12.46, longitude: 130.84 },
  SA: { latitude: -34.93, longitude: 138.6 },
  QLD: { latitude: -27.47, longitude: 153.03 },
  NSW: { latitude: -33.87, longitude: 151.21 },
  VIC: { latitude: -37.81, longitude: 144.96 },
  TAS: { latitude: -42.88, longitude: 147.33 },
  ACT: { latitude: -35.28, longitude: 149.13 },
} as const;

describe("the area around each state", () => {
  it("contains that state's capital city", () => {
    for (const state of AUSTRALIAN_STATE_CODES) {
      const { southWest, northEast } = STATE_AREAS[state];
      const city = CAPITAL_CITIES[state];
      expect(city.latitude).toBeGreaterThan(southWest.latitude);
      expect(city.latitude).toBeLessThan(northEast.latitude);
      expect(city.longitude).toBeGreaterThan(southWest.longitude);
      expect(city.longitude).toBeLessThan(northEast.longitude);
    }
  });
});

describe("the state a timezone covers", () => {
  it("knows the usual and the odd ones", () => {
    expect(stateForTimezone("Australia/Perth")).toBe("WA");
    expect(stateForTimezone("Australia/Broken_Hill")).toBe("NSW");
    expect(stateForTimezone("Europe/London")).toBeNull();
  });
});
