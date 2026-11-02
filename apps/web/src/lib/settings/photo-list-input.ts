import { handoverPhotoListSchema, photoListFromLines } from "@fleetapp/core";
import { z } from "zod";

/** The handover photo list as typed in Settings: one photo per line. */
export const photoListInputSchema = z.object({
  photos: z.string().transform(photoListFromLines).pipe(handoverPhotoListSchema),
});
export const PHOTO_LIST_FIELDS = ["photos"] as const;
