import { MAXIMUM_DRAWN_SIGNATURE_BYTES } from "@fleetapp/core";
import { describe, expect, it } from "vitest";

import { renterSignatureFrom } from "../src/lib/handover/renter-signature-form";
import { parseCompleteDriverChange, parseShownSwap } from "../src/lib/handover/signing-step-forms";

const RECORD_ID = "0b6f0c4e-8c8f-4a3e-9b1d-2f4c6a8e0d12";
const OTHER_ID = "5d2a9f1c-3b7e-4c6d-8a0f-1e2b3c4d5e6f";
const FINGERPRINT = "a".repeat(64);

function formOf(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(values)) {
    form.set(name, value);
  }
  return form;
}

const driverChangeForm = (changes: Record<string, string> = {}) =>
  formOf({
    changeId: RECORD_ID,
    returnFingerprint: FINGERPRINT,
    handoverFingerprint: FINGERPRINT,
    isOutgoingPresent: "on",
    "outgoing-method": "typed",
    "outgoing-typedName": "Sam Lee",
    "incoming-method": "typed",
    "incoming-typedName": "Mia Thompson",
    ...changes,
  });

/** The signing steps' forms are checked with Zod at the action's boundary (slice 4 review). */
describe("what a signing step sends back", () => {
  it("reads a driver change's form: what it showed and each driver's signature", () => {
    expect(parseCompleteDriverChange(driverChangeForm())).toEqual({
      shown: {
        changeId: RECORD_ID,
        returnFingerprint: FINGERPRINT,
        handoverFingerprint: FINGERPRINT,
      },
      outgoingSignature: { method: "typed", typedName: "Sam Lee", drawnSignature: "" },
      incomingSignature: { method: "typed", typedName: "Mia Thompson", drawnSignature: "" },
    });
    // Not there to sign: no signature from them, whatever their boxes hold.
    expect(
      parseCompleteDriverChange(driverChangeForm({ isOutgoingPresent: "" }))?.outgoingSignature,
    ).toBeNull();
  });

  it("refuses a driver change's form that isn't one", () => {
    expect(parseCompleteDriverChange(driverChangeForm({ changeId: "change-1" }))).toBeNull();
    expect(parseCompleteDriverChange(driverChangeForm({ returnFingerprint: "x" }))).toBeNull();
    expect(parseCompleteDriverChange(driverChangeForm({ isOutgoingPresent: "yes" }))).toBeNull();
    expect(
      parseCompleteDriverChange(
        driverChangeForm({
          "incoming-drawnSignature": "x".repeat(MAXIMUM_DRAWN_SIGNATURE_BYTES * 2),
        }),
      ),
    ).toBeNull();
  });

  it("reads a swap's form, and refuses one that isn't one", () => {
    const swap = {
      swapId: RECORD_ID,
      returnFingerprint: FINGERPRINT,
      handoverFingerprint: FINGERPRINT,
      swapTemplateVersionId: OTHER_ID,
      swapFormFingerprint: FINGERPRINT,
    };
    expect(parseShownSwap(formOf(swap))).toEqual(swap);
    expect(parseShownSwap(formOf({ ...swap, swapId: "" }))).toBeNull();
    expect(parseShownSwap(formOf({ ...swap, swapFormFingerprint: "not one" }))).toBeNull();
  });

  it("takes a signature too big to be one as no signature, refused as such where it is signed", () => {
    const huge = formOf({
      method: "drawn",
      drawnSignature: "x".repeat(MAXIMUM_DRAWN_SIGNATURE_BYTES * 2),
    });
    expect(renterSignatureFrom(huge)).toEqual({ method: "", typedName: "", drawnSignature: "" });
    expect(renterSignatureFrom(formOf({ method: "typed", typedName: "Sam Lee" }))).toEqual({
      method: "typed",
      typedName: "Sam Lee",
      drawnSignature: "",
    });
  });
});
