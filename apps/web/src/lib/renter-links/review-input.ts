import { requiredText } from "@fleetapp/core";
import { z } from "zod";

/** What to change, in the Operator's words: shown to the Renter on the link and in the email. */
export const sendBackInputSchema = z.object({ note: requiredText });
export const SEND_BACK_FIELDS = ["note"] as const;
