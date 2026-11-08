import { describe, expect, it } from "vitest";

import {
  canEmailAgain,
  documentEmailState,
  documentEmailText,
  hasDocumentEmailRecord,
} from "./document-emails";

describe("a document's emailed copies", () => {
  it("keeps each recipient's latest try, the driver's beside the others", () => {
    const state = documentEmailState([
      { recipient: "driver", outcome: "failed" },
      { recipient: "renter", outcome: "sent" },
      { recipient: "driver", outcome: "sent" },
    ]);

    expect(state).toEqual({ renter: "sent", driver: "sent", business: null });
  });

  it("says who it went to, the driver among them", () => {
    expect(documentEmailText({ renter: "sent", driver: null, business: "sent" })).toBe(
      "Emailed to the Renter and to you.",
    );
    expect(documentEmailText({ renter: "sent", driver: "sent", business: "sent" })).toBe(
      "Emailed to the Renter, to the driver and to you.",
    );
  });

  it("says a driver with no email wasn't sent theirs, without offering Email again for it", () => {
    const state = { renter: "sent", driver: "no_address", business: "sent" } as const;

    expect(documentEmailText(state)).toBe(
      "Emailed to the Renter and to you. Not emailed to the driver: no email on file.",
    );
    expect(canEmailAgain(state)).toBe(false);
  });

  it("offers Email again when the driver's copy didn't go", () => {
    const state = { renter: "sent", driver: "failed", business: "sent" } as const;

    expect(documentEmailText(state)).toBe(
      "Emailed to the Renter and to you. Couldn't email the driver.",
    );
    expect(canEmailAgain(state)).toBe(true);
  });

  it("claims nothing for a document issued before copies were recorded", () => {
    expect(hasDocumentEmailRecord({ renter: null, driver: null, business: null })).toBe(false);
    expect(hasDocumentEmailRecord({ renter: null, driver: "no_address", business: null })).toBe(
      true,
    );
    expect(documentEmailText({ renter: null, driver: null, business: null })).toBe(
      "Not emailed yet.",
    );
  });
});
