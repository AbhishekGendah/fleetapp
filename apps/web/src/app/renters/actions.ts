"use server";

import { describeErrorForLog, formTextValues, isRecordId, todayInTimeZone } from "@fleetapp/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ActingUser } from "../../lib/acting-user";
import { appDb } from "../../lib/app-db";
import { appEmailSender } from "../../lib/email-sender";
import { appPaymentDependencies } from "../../lib/payments/app-payments";
import { NOTICE_PARAM, sendPrivacyNotice } from "../../lib/privacy/send-privacy-notice";
import { tellStripeAboutRenter } from "../../lib/payments/stripe-tidy-up";
import { renterPath, RENTERS_PATH } from "../../lib/paths";
import { requireUser } from "../../lib/require-user";
import {
  parseRenterForm,
  RENTER_FORM_FIELDS,
  type RenterInput,
} from "../../lib/renters/renter-input";
import {
  BUSINESS_RENTER_FORM_FIELDS,
  parseBusinessRenterForm,
  type BusinessRenterInput,
} from "../../lib/renters/business-renter-input";
import {
  createBusinessRenter,
  createRenter,
  updateBusinessRenter,
  updateRenter,
  type ChangeRenterResult,
} from "../../lib/renters/renter-records";
import { RENTER_NOT_FOUND_MESSAGE, type RenterFormState } from "./renter-form-state";

const UNEXPECTED_ERROR_MESSAGE = "Something went wrong and nothing was saved. Try again.";
// The browser runs the same checks first, so this is only reached by a
// request that skipped them.
const INVALID_MESSAGE =
  "Some details are not right, so nothing was saved. Check them and try again.";

/** How one kind of Renter form is read: the same schema the browser checked it with. */
type FormReader<Input> = (
  formData: FormData,
  today: string,
) => { success: true; data: Input } | { success: false };

const readPersonForm: FormReader<RenterInput> = (formData, today) =>
  parseRenterForm(formTextValues(formData, RENTER_FORM_FIELDS), today);

const readBusinessForm: FormReader<BusinessRenterInput> = (formData) =>
  parseBusinessRenterForm(formTextValues(formData, BUSINESS_RENTER_FORM_FIELDS));

/** Checks, saves, and on success goes to the Renter's page. Shared by adding and editing either kind. */
async function saveRenterForm<Input>(
  formData: FormData,
  read: FormReader<Input>,
  save: (actor: ActingUser, input: Input) => Promise<string | null>,
  afterSave: (actor: ActingUser, renterId: string) => Promise<string> = async (_, renterId) =>
    renterPath(renterId),
): Promise<RenterFormState> {
  const user = await requireUser();
  const parsed = read(formData, todayInTimeZone(new Date(), user.operatorTimezone));
  if (!parsed.success) {
    return { status: "failed", formError: INVALID_MESSAGE };
  }

  const actor = { userId: user.id, operatorId: user.operatorId };
  let renterId: string | null;
  try {
    renterId = await save(actor, parsed.data);
  } catch (error) {
    console.error("Saving a Renter failed", describeErrorForLog(error));
    return { status: "failed", formError: UNEXPECTED_ERROR_MESSAGE };
  }
  if (!renterId) {
    return { status: "failed", formError: RENTER_NOT_FOUND_MESSAGE };
  }
  revalidatePath(RENTERS_PATH);
  const nextPath = await afterSave(actor, renterId);
  // Outside the try: Next carries out a redirect by throwing.
  redirect(nextPath);
}

/**
 * A Renter added by the business gets the privacy notice by email; their
 * page says so when it could not go, so the business hands them a copy.
 */
async function afterAddingRenter(actor: ActingUser, renterId: string): Promise<string> {
  const outcome = await sendPrivacyNotice(
    { database: appDb, emailSender: appEmailSender },
    actor,
    renterId,
  );
  const path = renterPath(renterId);
  return outcome === "sent" ? path : `${path}?${NOTICE_PARAM}=${outcome}`;
}

export async function addRenterAction(
  _previous: RenterFormState,
  formData: FormData,
): Promise<RenterFormState> {
  return saveRenterForm(
    formData,
    readPersonForm,
    (actor, input) => createRenter(appDb, actor, input),
    afterAddingRenter,
  );
}

/** A business's contact gets the privacy notice too: their details are personal information. */
export async function addBusinessRenterAction(
  _previous: RenterFormState,
  formData: FormData,
): Promise<RenterFormState> {
  return saveRenterForm(
    formData,
    readBusinessForm,
    (actor, input) => createBusinessRenter(appDb, actor, input),
    afterAddingRenter,
  );
}

/** Bound to one Renter's id by the edit page; checked against the User's Operator on save. */
export async function editRenterAction(
  renterId: string,
  _previous: RenterFormState,
  formData: FormData,
): Promise<RenterFormState> {
  if (!isRecordId(renterId)) {
    return { status: "failed", formError: RENTER_NOT_FOUND_MESSAGE };
  }
  return saveRenterForm(formData, readPersonForm, async (actor, input) =>
    afterEditing(actor, renterId, await updateRenter(appDb, actor, renterId, input)),
  );
}

/** Bound to one business's id by the edit page; checked against the User's Operator on save. */
export async function editBusinessRenterAction(
  renterId: string,
  _previous: RenterFormState,
  formData: FormData,
): Promise<RenterFormState> {
  if (!isRecordId(renterId)) {
    return { status: "failed", formError: RENTER_NOT_FOUND_MESSAGE };
  }
  return saveRenterForm(formData, readBusinessForm, async (actor, input) =>
    afterEditing(actor, renterId, await updateBusinessRenter(appDb, actor, renterId, input)),
  );
}

/** Stripe keeps its own copy of the name and email: told after a save (review A5-6). */
async function afterEditing(
  actor: ActingUser,
  renterId: string,
  result: ChangeRenterResult,
): Promise<string | null> {
  if (result === "not_found") {
    return null;
  }
  await tellStripeAboutRenter(appPaymentDependencies(), actor.operatorId, renterId);
  return renterId;
}
