import { describe, expect, it } from "vitest";

import { addressFromComponents } from "../src/lib/address-lookup/address-from-components";
import { createGooglePlacesClient } from "../src/lib/address-lookup/google-places";
import {
  addressChoiceInputSchema,
  addressSearchInputSchema,
} from "../src/lib/address-lookup/lookup-input";

const SESSION_TOKEN = "6f1c2f7e-3b7a-4c1e-9d2a-1b2c3d4e5f60";

function component(types: string[], longText: string, shortText = longText) {
  return { types, longText, shortText };
}

const UNIT_ADDRESS = [
  component(["subpremise"], "3"),
  component(["street_number"], "12"),
  component(["route"], "Hay Street", "Hay St"),
  component(["locality", "political"], "Perth"),
  component(["administrative_area_level_1", "political"], "Western Australia", "WA"),
  component(["country", "political"], "Australia", "AU"),
  component(["postal_code"], "6000"),
];

describe("turning Google's address parts into an Australian address", () => {
  it("writes a unit before the street number with a slash", () => {
    expect(addressFromComponents(UNIT_ADDRESS)).toEqual({
      addressLine1: "3/12 Hay Street",
      suburb: "Perth",
      state: "WA",
      postcode: "6000",
    });
  });

  it("leaves blank whatever Google did not have", () => {
    expect(addressFromComponents([component(["route"], "Hay Street")])).toEqual({
      addressLine1: "Hay Street",
      suburb: "",
      state: "",
      postcode: "",
    });
  });

  it("ignores a state that is not an Australian one", () => {
    const address = addressFromComponents([
      component(["administrative_area_level_1"], "Auckland", "AUK"),
    ]);
    expect(address.state).toBe("");
  });
});

describe("what the browser may ask for", () => {
  it("needs at least 3 letters and a real session token", () => {
    expect(
      addressSearchInputSchema.safeParse({ query: "12", sessionToken: SESSION_TOKEN }).success,
    ).toBe(false);
    expect(addressSearchInputSchema.safeParse({ query: "12 Hay", sessionToken: "x" }).success).toBe(
      false,
    );
    expect(
      addressSearchInputSchema.safeParse({ query: "12 Hay", sessionToken: SESSION_TOKEN }).success,
    ).toBe(true);
  });

  it("refuses a place ID that could change Google's address", () => {
    for (const placeId of ["../places", "abc?key=1", "a/b", ""]) {
      expect(
        addressChoiceInputSchema.safeParse({ placeId, sessionToken: SESSION_TOKEN }).success,
      ).toBe(false);
    }
    expect(
      addressChoiceInputSchema.safeParse({ placeId: "ChIJ-abc_123", sessionToken: SESSION_TOKEN })
        .success,
    ).toBe(true);
  });
});

describe("the Google Places client", () => {
  it("asks for Australian suggestions with the key in a header, never the address", async () => {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const client = createGooglePlacesClient("test-key", async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json({
        suggestions: [
          {
            placePrediction: {
              placeId: "ChIJ1",
              text: { text: "12 Hay Street, Perth WA, Australia" },
              structuredFormat: {
                mainText: { text: "12 Hay Street" },
                secondaryText: { text: "Perth WA, Australia" },
              },
            },
          },
          { queryPrediction: { text: { text: "ignored" } } },
        ],
      });
    });

    const suggestions = await client.suggestAddresses("12 Hay", SESSION_TOKEN);

    expect(suggestions).toEqual([
      { placeId: "ChIJ1", mainText: "12 Hay Street", secondaryText: "Perth WA, Australia" },
    ]);
    const [request] = requests;
    expect(request?.url).not.toContain("test-key");
    expect(new Headers(request?.init?.headers).get("X-Goog-Api-Key")).toBe("test-key");
    expect(JSON.parse(String(request?.init?.body))).toMatchObject({
      input: "12 Hay",
      sessionToken: SESSION_TOKEN,
      includedRegionCodes: ["au"],
    });
  });

  it("asks only for the address parts of a chosen place", async () => {
    let fieldMask: string | null = null;
    const client = createGooglePlacesClient("test-key", async (_url, init) => {
      fieldMask = new Headers(init?.headers).get("X-Goog-FieldMask");
      return Response.json({ addressComponents: UNIT_ADDRESS });
    });

    const address = await client.getAddress("ChIJ1", SESSION_TOKEN);

    expect(fieldMask).toBe("addressComponents");
    expect(address.addressLine1).toBe("3/12 Hay Street");
  });

  it("fails with only the status when Google refuses", async () => {
    const client = createGooglePlacesClient("test-key", async () =>
      Response.json({ error: { message: "quota for 12 Hay Street" } }, { status: 429 }),
    );

    await expect(client.suggestAddresses("12 Hay", SESSION_TOKEN)).rejects.toThrow(
      "Google Places answered 429",
    );
  });
});
