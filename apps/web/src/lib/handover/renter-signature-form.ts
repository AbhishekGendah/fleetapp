import {
  MAXIMUM_DRAWN_SIGNATURE_BYTES,
  MAXIMUM_LINE_LENGTH,
  RENTER_SIGNATURE_FIELDS,
  type RenterSignatureInput,
} from "@fleetapp/core";
import { z } from "zod";

const PNG_DATA_URL_PREFIX_LENGTH = "data:image/png;base64,".length;
const BASE64_BYTES_PER_GROUP = 3;
const BASE64_CHARACTERS_PER_GROUP = 4;

/** The longest data URL a drawn signature within its size can be: base64 is 4 characters per 3 bytes. */
const MAXIMUM_DRAWN_SIGNATURE_LENGTH =
  PNG_DATA_URL_PREFIX_LENGTH +
  Math.ceil(MAXIMUM_DRAWN_SIGNATURE_BYTES / BASE64_BYTES_PER_GROUP) * BASE64_CHARACTERS_PER_GROUP;

/**
 * A signature's boxes as a business-phone form sends them, within their
 * sizes. Whether it is a signature at all, and the signer's, is checked
 * where it is signed (`readRenterSignature`), so a blank one is refused in
 * words there rather than here.
 */
export const renterSignatureInputSchema = z.object({
  method: z.string().max(MAXIMUM_LINE_LENGTH),
  typedName: z.string().max(MAXIMUM_LINE_LENGTH),
  drawnSignature: z.string().max(MAXIMUM_DRAWN_SIGNATURE_LENGTH),
});

const NO_SIGNATURE: RenterSignatureInput = { method: "", typedName: "", drawnSignature: "" };

/** A signature's boxes as posted, each as text (empty when missing). */
export function renterSignatureValues(formData: FormData, prefix = ""): RenterSignatureInput {
  const [method, typedName, drawnSignature] = RENTER_SIGNATURE_FIELDS.map((field) => {
    const value = formData.get(`${prefix}${field}`);
    return typeof value === "string" ? value : "";
  });
  return { method: method ?? "", typedName: typedName ?? "", drawnSignature: drawnSignature ?? "" };
}

/**
 * The Renter's signature as a business-phone form sent it, drawn or typed
 * (review G9-10), checked with its Zod schema: one too big to be a signature
 * is no signature, refused as such. A form with two signatures (a driver
 * change) names each one's boxes with its own prefix.
 */
export function renterSignatureFrom(formData: FormData, prefix = ""): RenterSignatureInput {
  const parsed = renterSignatureInputSchema.safeParse(renterSignatureValues(formData, prefix));
  return parsed.success ? parsed.data : NO_SIGNATURE;
}
