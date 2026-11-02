import { isRecordId, requiredLine, STATUSES_AFTER_SWAP } from "@fleetapp/core";
import { z } from "zod";

import { carAfterFields, parseCarAfter } from "../handover/return-input";
import type { VehicleStatusInput } from "../vehicles/vehicle-input";

const CAR_NEEDED_MESSAGE = "Choose the car the Renter swaps into.";

/** Starting a swap: the car the Renter swaps into, and why. */
export const START_SWAP_FIELDS = ["toVehicleId", "reason"] as const;
export type StartSwapFormValues = Record<(typeof START_SWAP_FIELDS)[number], string>;

export const startSwapFormSchema = z.object({
  toVehicleId: z.string().trim().refine(isRecordId, CAR_NEEDED_MESSAGE),
  reason: requiredLine,
});

/** The swap's last step: where the old car goes. The Renter's signature comes with it. */
export const FINISH_SWAP_FIELDS = ["status", "statusReason", "statusExpectedBack"] as const;
export type FinishSwapFormValues = Record<(typeof FINISH_SWAP_FIELDS)[number], string>;

export const finishSwapFormSchema: z.ZodType<VehicleStatusInput, FinishSwapFormValues> = z
  .object(carAfterFields(STATUSES_AFTER_SWAP))
  .transform((carAfter, context) => parseCarAfter(carAfter, context));

export const INITIAL_FINISH_SWAP_VALUES: FinishSwapFormValues = {
  status: "available",
  statusReason: "",
  statusExpectedBack: "",
};
