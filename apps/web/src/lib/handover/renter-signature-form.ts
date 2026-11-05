import { RENTER_SIGNATURE_FIELDS, type RenterSignatureInput } from "@fleetapp/core";

/** The Renter's signature as a business-phone form sent it, drawn or typed (review G9-10). */
export function renterSignatureFrom(formData: FormData): RenterSignatureInput {
  const [method, typedName, drawnSignature] = RENTER_SIGNATURE_FIELDS.map((field) => {
    const value = formData.get(field);
    return typeof value === "string" ? value : "";
  });
  return { method: method ?? "", typedName: typedName ?? "", drawnSignature: drawnSignature ?? "" };
}
