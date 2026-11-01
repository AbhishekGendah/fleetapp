"use server";

import { formTextValues, isRecordId } from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";

import { appDb } from "../../../lib/app-db";
import { rentalPath, RENTALS_PATH } from "../../../lib/paths";
import { cancelRentalInputSchema } from "../../../lib/rentals/rental-input";
import { bookRental, cancelRental } from "../../../lib/rentals/rental-records";
import { runUserChange } from "../../../lib/run-change";
import { bookingFailure } from "../booking-failure";

const NOT_FOUND_MESSAGE = "That rental could not be found.";
const CANCEL_FIELDS = ["reason"] as const;

/** Bound to one draft by its page: checks again with today's details, then holds the car. */
export async function bookDraftAction(
  rentalId: string,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  if (!isRecordId(rentalId)) {
    return failedState(NOT_FOUND_MESSAGE);
  }
  return runUserChange({
    description: "Booking a draft rental",
    pagesToRefresh: [RENTALS_PATH, rentalPath(rentalId)],
    change: async (actor, user) => {
      const timeZone = user.operatorTimezone;
      const result = await bookRental(appDb, actor, rentalId, { timeZone, now: new Date() });
      const failure = bookingFailure(result, timeZone);
      if (failure?.status === "failed") {
        return failedState([failure.formError, ...failure.reasons].join(" "), failure.link);
      }
      return savedState("Booked. The car is held for these dates.");
    },
  });
}

/** Bound to one rental by its page: a draft or a booking, with the reason why. */
export async function cancelRentalAction(
  rentalId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = cancelRentalInputSchema.safeParse(formTextValues(formData, CANCEL_FIELDS));
  if (!isRecordId(rentalId) || !parsed.success) {
    return failedState("Say why it is cancelled, then try again.");
  }
  return runUserChange({
    description: "Cancelling a rental",
    pagesToRefresh: [RENTALS_PATH, rentalPath(rentalId)],
    change: async (actor) => {
      const result = await cancelRental(appDb, actor, rentalId, parsed.data, new Date());
      if (result === "not_found") {
        return failedState(NOT_FOUND_MESSAGE);
      }
      if (result === "not_allowed") {
        return failedState("Only a draft or a booking can be cancelled.");
      }
      return savedState("Cancelled. The car is free for those dates again.");
    },
  });
}
