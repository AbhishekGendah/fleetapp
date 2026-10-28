import type { AustralianStateCode } from "./postcodes";

export interface MapPoint {
  latitude: number;
  longitude: number;
}

/** A box on the map, from its south-west corner to its north-east corner. */
export interface MapArea {
  southWest: MapPoint;
  northEast: MapPoint;
}

function area(south: number, west: number, north: number, east: number): MapArea {
  return {
    southWest: { latitude: south, longitude: west },
    northEast: { latitude: north, longitude: east },
  };
}

/**
 * A box around each state and territory, coastline to border. Rough on
 * purpose: used only to put an Operator's own state first in address
 * suggestions, never to refuse an address.
 */
export const STATE_AREAS: Readonly<Record<AustralianStateCode, MapArea>> = {
  WA: area(-35.2, 112.9, -13.6, 129.0),
  NT: area(-26.0, 129.0, -10.9, 138.0),
  SA: area(-38.1, 129.0, -26.0, 141.0),
  QLD: area(-29.2, 138.0, -10.0, 153.6),
  NSW: area(-37.5, 141.0, -28.1, 153.7),
  VIC: area(-39.2, 140.9, -33.9, 150.0),
  TAS: area(-43.7, 143.8, -39.5, 148.5),
  ACT: area(-35.95, 148.7, -35.1, 149.4),
};
