"use server";

import {
  describeErrorForLog,
  formTextValues,
  LICENCE_SIDES,
  todayInTimeZone,
  UPLOAD_PROBLEM_MESSAGES,
  type AustralianStateCode,
} from "@fleetapp/core";
import { cookies } from "next/headers";
import { z } from "zod";

import { appDb } from "../../../lib/app-db";
import type { AddressParts } from "../../../lib/address-lookup/address-from-components";
import type { AddressSuggestion } from "../../../lib/address-lookup/google-places";
import { fetchAddress, suggestAddresses } from "../../../lib/address-lookup/lookup";
import {
  addressChoiceInputSchema,
  addressSearchInputSchema,
} from "../../../lib/address-lookup/lookup-input";
import {
  fileDependencies,
  finishRecordUpload,
  plannedFileSchema,
  startRecordUpload,
  type RecordUploadStart,
} from "../../../lib/files/file-action-support";
import {
  DETAILS_FORM_FIELDS,
  parseDetailsForm,
} from "../../../lib/renter-links/details-form-input";
import { openVerifiedLink, type LinkVisit } from "../../../lib/renter-links/link-visits";
import {
  countAddressSearch,
  startLinkPhotoUpload,
  submitDetails,
} from "../../../lib/renter-links/submissions";
import { DEVICE_COOKIE, PHOTOS_MISSING_MESSAGE, type SendDetailsState } from "./link-state";

const SHUT_MESSAGE = "This page has closed. Open your link again; you may need a new code.";
const ALREADY_SENT_MESSAGE = "Your details were already sent.";

/**
 * The link behind the secret, only if this phone passed its code. Every
 * form step starts here, so a forwarded link or an old page can do nothing.
 */
async function verifiedVisit(token: string): Promise<LinkVisit | null> {
  return openVerifiedLink(appDb, token, (await cookies()).get(DEVICE_COOKIE)?.value);
}

const photoRequestSchema = plannedFileSchema.extend({ side: z.enum(LICENCE_SIDES) });

export async function startLinkPhotoAction(
  token: string,
  request: z.input<typeof photoRequestSchema>,
): Promise<RecordUploadStart> {
  const visit = await verifiedVisit(token);
  const parsed = photoRequestSchema.safeParse(request);
  if (!visit) {
    return { status: "refused", message: SHUT_MESSAGE };
  }
  if (!parsed.success) {
    return { status: "refused", message: UPLOAD_PROBLEM_MESSAGES.type_not_allowed };
  }
  const { side, ...planned } = parsed.data;
  return startRecordUpload("Starting a link photo upload", ALREADY_SENT_MESSAGE, () =>
    startLinkPhotoUpload(fileDependencies(), visit, side, planned),
  );
}

export async function finishLinkPhotoAction(token: string, fileId: string): Promise<string | null> {
  const visit = await verifiedVisit(token);
  if (!visit) {
    return SHUT_MESSAGE;
  }
  return finishRecordUpload(
    "Finishing a link photo upload",
    { operatorId: visit.operatorId, linkId: visit.linkId },
    fileId,
    "renter_submitted_scan",
  );
}

/** Sends the form, checked again here by the same rules the phone used. */
export async function sendDetailsAction(
  token: string,
  _previous: SendDetailsState,
  formData: FormData,
): Promise<SendDetailsState> {
  const visit = await verifiedVisit(token);
  if (!visit) {
    return { status: "problem", message: SHUT_MESSAGE };
  }
  const parsed = parseDetailsForm(
    formTextValues(formData, DETAILS_FORM_FIELDS),
    todayInTimeZone(new Date(), visit.timeZone),
  );
  if (!parsed.success) {
    return {
      status: "problem",
      message: "Some details are not right. Check the boxes marked in red.",
    };
  }
  try {
    const result = await submitDetails(appDb, visit, parsed.data);
    if (result === "photos_missing") {
      return {
        status: "problem",
        message: PHOTOS_MISSING_MESSAGE,
      };
    }
    return result === "already_sent"
      ? { status: "problem", message: ALREADY_SENT_MESSAGE }
      : { status: "sent" };
  } catch (error) {
    // Never the error's details: they could hold what was typed.
    console.error("Sending details through a link failed", describeErrorForLog(error));
    return { status: "problem", message: "Something went wrong. Try again in a moment." };
  }
}

/**
 * Address suggestions for the link's form. Searches and chosen addresses
 * share one allowance of 50 per link, counted only once the request is
 * well formed, so a link cannot run up the bill or use up the app's daily cap.
 */
export async function searchAddressesForLinkAction(
  token: string,
  query: string,
  sessionToken: string,
  nearState: AustralianStateCode | null,
): Promise<AddressSuggestion[]> {
  if (!addressSearchInputSchema.safeParse({ query, sessionToken, nearState }).success) {
    return [];
  }
  const visit = await verifiedVisit(token);
  if (!visit || !(await countAddressSearch(appDb, visit))) {
    return [];
  }
  return suggestAddresses(query, sessionToken, nearState);
}

export async function getAddressForLinkAction(
  token: string,
  placeId: string,
  sessionToken: string,
): Promise<AddressParts | null> {
  if (!addressChoiceInputSchema.safeParse({ placeId, sessionToken }).success) {
    return null;
  }
  const visit = await verifiedVisit(token);
  if (!visit || !(await countAddressSearch(appDb, visit))) {
    return null;
  }
  return fetchAddress(placeId, sessionToken);
}
