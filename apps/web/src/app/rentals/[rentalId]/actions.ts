"use server";

import { formTextValues, isRecordId } from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";

import { appDb } from "../../../lib/app-db";
import { rentalPath, RENTALS_PATH } from "../../../lib/paths";
import { cancelRentalInputSchema, nameDriverInputSchema } from "../../../lib/rentals/rental-input";
import {
  bookingProblemMessage,
  MISSING_DRIVER_MESSAGES,
} from "../../../lib/rentals/rental-messages";
import {
  bookRental,
  cancelRental,
  nameRentalDriver,
  type NameDriverResult,
} from "../../../lib/rentals/rental-records";
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

const NAME_DRIVER_FIELDS = ["driverId"] as const;

/** What naming a driver came back with, in words: a warning is saved and shown. */
function nameDriverState(result: NameDriverResult): ChangeFormState {
  switch (result.status) {
    case "saved": {
      const warnings = result.problems
        .filter((problem) => problem.level !== "booking")
        .map((problem) => bookingProblemMessage(problem, true));
      return warnings.length > 0
        ? savedState(`Saved. Before the handover: ${warnings.join(" ")}`, true)
        : savedState("Saved. The driver signs for the car at the handover.");
    }
    case "unchanged":
      return savedState("Nothing changed: that is the driver already.");
    case "refused":
      return failedState(
        result.problems
          .filter((problem) => problem.level === "booking")
          .map((problem) => bookingProblemMessage(problem, true))
          .join(" "),
      );
    case "driver_not_found":
    case "driver_archived":
    case "driver_not_current":
    case "driver_waiting_review":
      return failedState(MISSING_DRIVER_MESSAGES[result.status]);
    case "renter_not_found":
      return failedState("The business has been archived. Restore it, or cancel this rental.");
    case "car_not_found":
      return failedState("The car has been archived. Restore it, or cancel this rental.");
    case "not_allowed":
      return failedState("Only a business's draft or booking names its driver here.");
    case "not_found":
      return failedState(NOT_FOUND_MESSAGE);
  }
}

/** Bound to one business's draft or booking by its page: names its driver, or "to be named". */
export async function nameDriverAction(
  rentalId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = nameDriverInputSchema.safeParse(formTextValues(formData, NAME_DRIVER_FIELDS));
  if (!isRecordId(rentalId) || !parsed.success) {
    return failedState("Choose a driver, or Driver to be named, then try again.");
  }
  return runUserChange({
    description: "Naming a rental's driver",
    pagesToRefresh: [RENTALS_PATH, rentalPath(rentalId)],
    change: async (actor, user) =>
      nameDriverState(
        await nameRentalDriver(appDb, actor, rentalId, parsed.data, {
          timeZone: user.operatorTimezone,
          now: new Date(),
        }),
      ),
  });
}
