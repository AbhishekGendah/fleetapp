import { RENTER_SIGNATURE_FIELDS, type RenterSignatureInput } from "@fleetapp/core";

/**
 * The Renter's signature as a business-phone form sent it, drawn or typed
 * (review G9-10). A form with two signatures (a driver change) names each
 * one's boxes with its own prefix.
 */
export function renterSignatureFrom(formData: FormData, prefix = ""): RenterSignatureInput {
  const [method, typedName, drawnSignature] = RENTER_SIGNATURE_FIELDS.map((field) => {
    const value = formData.get(`${prefix}${field}`);
    return typeof value === "string" ? value : "";
  });
  return { method: method ?? "", typedName: typedName ?? "", drawnSignature: drawnSignature ?? "" };
}
