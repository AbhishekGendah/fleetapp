import { createServer, type Server } from "node:http";

import { freePort } from "./processes";

/** A made-up address the stand-in offers for anything typed. */
export const FAKE_ADDRESS = {
  placeId: "e2e-place-1",
  mainText: "1 Example Street",
  secondaryText: "Perth WA, Australia",
  street: "1 Example Street",
  suburb: "Perth",
  state: "WA",
  postcode: "6000",
} as const;

const AUTOCOMPLETE_PATH = "/v1/places:autocomplete";
const PLACE_PATH_PREFIX = "/v1/places/";

function addressComponents() {
  return [
    { longText: "1", shortText: "1", types: ["street_number"] },
    { longText: "Example Street", shortText: "Example St", types: ["route"] },
    { longText: FAKE_ADDRESS.suburb, shortText: FAKE_ADDRESS.suburb, types: ["locality"] },
    {
      longText: "Western Australia",
      shortText: FAKE_ADDRESS.state,
      types: ["administrative_area_level_1"],
    },
    { longText: FAKE_ADDRESS.postcode, shortText: FAKE_ADDRESS.postcode, types: ["postal_code"] },
    { longText: "Australia", shortText: "AU", types: ["country"] },
  ];
}

function bodyFor(path: string): unknown {
  if (path === AUTOCOMPLETE_PATH) {
    return {
      suggestions: [
        {
          placePrediction: {
            placeId: FAKE_ADDRESS.placeId,
            text: { text: `${FAKE_ADDRESS.mainText}, ${FAKE_ADDRESS.secondaryText}` },
            structuredFormat: {
              mainText: { text: FAKE_ADDRESS.mainText },
              secondaryText: { text: FAKE_ADDRESS.secondaryText },
            },
          },
        },
      ],
    };
  }
  return path.startsWith(PLACE_PATH_PREFIX) ? { addressComponents: addressComponents() } : null;
}

/** A stand-in for Google Places (New): one address for any search, so no real key or call. */
export async function startFakePlaces(): Promise<{ url: string; stop(): Promise<void> }> {
  const port = await freePort();
  const server: Server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const body = bodyFor(path);
    response.writeHead(body ? 200 : 404, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body ?? { error: "not found" }));
  });
  await new Promise<void>((resolve) => server.listen(port, resolve));
  return {
    url: `http://localhost:${port}`,
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
