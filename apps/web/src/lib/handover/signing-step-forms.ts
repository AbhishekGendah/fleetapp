import { isRecordId } from "@fleetapp/core";
import { z } from "zod";

import { INCOMING_PREFIX, OUTGOING_PREFIX, OUTGOING_PRESENT } from "../rentals/driver-change-input";
import { isChecklistFingerprint } from "./checklist-fingerprint";
import type { CompleteDriverChangeInput } from "./complete-driver-change";
import type { ShownSwap } from "./complete-swap";
import { renterSignatureInputSchema, renterSignatureValues } from "./renter-signature-form";

/**
 * What a signing step sends back of what it showed (a record's id and the
 * SHA-256 fingerprints of what was on screen), checked at the action's
 * boundary with Zod; whether it is still what stands is checked under the
 * locks that issue the papers.
 */
const recordId = z.string().refine(isRecordId);
const fingerprint = z.string().refine(isChecklistFingerprint);

const shownSwapSchema: z.ZodType<ShownSwap> = z.object({
  swapId: recordId,
  returnFingerprint: fingerprint,
  handoverFingerprint: fingerprint,
  swapTemplateVersionId: recordId,
  swapFormFingerprint: fingerprint,
});

const SHOWN_SWAP_FIELDS = [
  "swapId",
  "returnFingerprint",
  "handoverFingerprint",
  "swapTemplateVersionId",
  "swapFormFingerprint",
] as const;

const completeDriverChangeSchema = z
  .object({
    changeId: recordId,
    returnFingerprint: fingerprint,
    handoverFingerprint: fingerprint,
    isOutgoingPresent: z.union([z.literal(OUTGOING_PRESENT), z.literal("")]),
    outgoing: renterSignatureInputSchema,
    incoming: renterSignatureInputSchema,
  })
  .transform((form): CompleteDriverChangeInput => ({
    shown: {
      changeId: form.changeId,
      returnFingerprint: form.returnFingerprint,
      handoverFingerprint: form.handoverFingerprint,
    },
    // Not there to sign: their boxes, whatever they hold, are not a signature.
    outgoingSignature: form.isOutgoingPresent === OUTGOING_PRESENT ? form.outgoing : null,
    incomingSignature: form.incoming,
  }));

const textOf = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

/** What the swap's signing step showed, as it sent it back; null if it isn't that. */
export function parseShownSwap(formData: FormData): ShownSwap | null {
  const parsed = shownSwapSchema.safeParse(
    Object.fromEntries(SHOWN_SWAP_FIELDS.map((name) => [name, textOf(formData, name)])),
  );
  return parsed.success ? parsed.data : null;
}

/** The driver change's signing form: what it showed and both signatures; null if it isn't that. */
export function parseCompleteDriverChange(formData: FormData): CompleteDriverChangeInput | null {
  const parsed = completeDriverChangeSchema.safeParse({
    changeId: textOf(formData, "changeId"),
    returnFingerprint: textOf(formData, "returnFingerprint"),
    handoverFingerprint: textOf(formData, "handoverFingerprint"),
    isOutgoingPresent: textOf(formData, "isOutgoingPresent"),
    outgoing: renterSignatureValues(formData, OUTGOING_PREFIX),
    incoming: renterSignatureValues(formData, INCOMING_PREFIX),
  });
  return parsed.success ? parsed.data : null;
}
