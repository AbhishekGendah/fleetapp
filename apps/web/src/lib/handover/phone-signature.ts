import type { RenterSignature } from "@fleetapp/core";

import type { PdfSignature } from "../contracts/document-pdf";

/**
 * How a signature made on the business's phone is printed: drawn, or the
 * name the Renter typed, with the moment they signed (review G9-4, G9-10).
 */
export function phoneSignature(
  signature: RenterSignature,
  signedByText: string,
  signedAtText: string,
): PdfSignature {
  const at = `Signed on the business's phone on ${signedAtText}`;
  return signature.method === "drawn"
    ? { signedByText, signedAtText: at, drawnPng: signature.drawnPng }
    : {
        signedByText: `${signedByText} (typed their full name)`,
        signedAtText: at,
        typedName: signature.typedName,
      };
}
