import { rentalPath } from "../../lib/paths";
import { isStillOutClash } from "../../lib/rentals/car-holds";
import {
  bookingClashMessage,
  bookingProblemMessage,
  MISSING_DRIVER_MESSAGES,
} from "../../lib/rentals/rental-messages";
import type { BookingResult } from "../../lib/rentals/rental-records";
import type { RentalFormState } from "./rental-form-state";

/** Why a booking was not made, in words, or null once it was. */
export function bookingFailure(result: BookingResult, timeZone: string): RentalFormState | null {
  switch (result.status) {
    case "saved":
      return null;
    case "refused":
      return {
        status: "failed",
        formError: "This booking cannot be made:",
        reasons: result.problems
          .filter((problem) => problem.level === "booking")
          .map((problem) => bookingProblemMessage(problem)),
      };
    case "car_taken":
      return {
        status: "failed",
        formError: bookingClashMessage(result.clash, timeZone),
        reasons: [],
        ...(result.clash
          ? {
              link: {
                href: rentalPath(result.clash.rentalId),
                label: isStillOutClash(result.clash) ? "See that rental" : "See that booking",
              },
            }
          : {}),
      };
    case "renter_not_found":
      return { status: "failed", formError: "That Renter could not be found.", reasons: [] };
    case "car_not_found":
      return { status: "failed", formError: "That car could not be found.", reasons: [] };
    case "driver_not_found":
    case "driver_archived":
    case "driver_not_current":
      return { status: "failed", formError: MISSING_DRIVER_MESSAGES[result.status], reasons: [] };
    case "not_found":
    case "not_allowed":
      return { status: "failed", formError: "This rental can no longer be booked.", reasons: [] };
  }
}
