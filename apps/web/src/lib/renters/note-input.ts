import { requiredText } from "@fleetapp/core";
import { z } from "zod";

/** A note as typed: several lines allowed, facts only (the Renter can ask to see it). */
export const noteInputSchema = z.object({ body: requiredText });
export const NOTE_FIELDS = ["body"] as const;
