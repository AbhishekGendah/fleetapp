"use server";

import { describeErrorForLog, formTextValues } from "@fleetapp/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { appDb } from "../../lib/app-db";
import { rentalPath, RENTALS_PATH } from "../../lib/paths";
import { parseRentalForm, RENTAL_FORM_FIELDS } from "../../lib/rentals/rental-input";
import { createRental, type BookingResult } from "../../lib/rentals/rental-records";
import { requireUser } from "../../lib/require-user";
import { bookingFailure } from "./booking-failure";
import { DRAFT_INTENT, INTENT_FIELD, type RentalFormState } from "./rental-form-state";

const UNEXPECTED_ERROR_MESSAGE = "Something went wrong and nothing was saved. Try again.";
// The browser runs the same checks first, so this is only reached by a
// request that skipped them.
const INVALID_MESSAGE =
  "Some details are not right, so nothing was saved. Check them and try again.";

/** Checks and saves the New rental form; a saved rental opens its page, warnings and all. */
export async function createRentalAction(
  _previous: RentalFormState,
  formData: FormData,
): Promise<RentalFormState> {
  const user = await requireUser();
  const timeZone = user.operatorTimezone;
  const parsed = parseRentalForm(formTextValues(formData, RENTAL_FORM_FIELDS), timeZone);
  if (!parsed.success) {
    return { status: "failed", formError: INVALID_MESSAGE, reasons: [] };
  }
  const status = formData.get(INTENT_FIELD) === DRAFT_INTENT ? "draft" : "booked";

  let result: BookingResult;
  try {
    result = await createRental(
      appDb,
      { userId: user.id, operatorId: user.operatorId },
      parsed.data,
      status,
      { timeZone, now: new Date() },
    );
  } catch (error) {
    console.error("Making a rental failed", describeErrorForLog(error));
    return { status: "failed", formError: UNEXPECTED_ERROR_MESSAGE, reasons: [] };
  }
  const failure = bookingFailure(result, timeZone);
  if (failure || result.status !== "saved") {
    return failure ?? { status: "failed", formError: UNEXPECTED_ERROR_MESSAGE, reasons: [] };
  }
  revalidatePath(RENTALS_PATH);
  // Outside the try: Next carries out a redirect by throwing.
  redirect(rentalPath(result.rentalId));
}
