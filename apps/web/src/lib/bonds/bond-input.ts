import { requiredLine } from "@fleetapp/core";
import { z } from "zod";

import {
  MANUAL_PAYMENT_FIELDS,
  manualPaymentInputSchema,
  manualPaymentStart,
  REQUIRED_MANUAL_PAYMENT_FIELDS,
  type ManualPaymentField,
  type ManualPaymentInput,
} from "../money/manual-payment-input";

/** Bond received by hand: the same as any money received by hand. */
export const bondReceivedInputSchema = manualPaymentInputSchema;
export type BondReceivedInput = ManualPaymentInput;
export const BOND_RECEIVED_FIELDS = MANUAL_PAYMENT_FIELDS;
export const REQUIRED_BOND_RECEIVED_FIELDS = REQUIRED_MANUAL_PAYMENT_FIELDS;
export type BondReceivedField = ManualPaymentField;
/** What the form starts with: the rest of the bond, by bank transfer, today. */
export const bondReceivedStart = manualPaymentStart;

/** Why an entry is corrected; kept with the bond, never in the Log. */
export const bondReversalInputSchema = z.object({ note: requiredLine });
export type BondReversalInput = z.infer<typeof bondReversalInputSchema>;
export const BOND_REVERSAL_FIELDS = ["note"] as const;
