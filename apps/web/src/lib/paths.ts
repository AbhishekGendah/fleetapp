/** The Operator app's own pages that other code sends people to. */
export const HOME_PATH = "/";
export const SIGN_IN_PATH = "/sign-in";
export const SET_UP_AUTHENTICATOR_PATH = "/set-up-authenticator";
export const SUSPENDED_PATH = "/suspended";
export const FORGOT_PASSWORD_PATH = "/forgot-password";
export const RESET_PASSWORD_PATH = "/reset-password";
export const SETTINGS_PATH = "/settings";
/** The business details card on the Settings page, for linking straight to it. */
export const BUSINESS_DETAILS_ANCHOR = "business-details";
export const CONTRACTS_PATH = `${SETTINGS_PATH}/contracts`;
/** Test sites only: fills the business with made-up records. */
export const DEMO_DATA_PATH = `${SETTINGS_PATH}/demo-data`;

export function contractTemplatePath(templateId: string): string {
  return `${CONTRACTS_PATH}/${templateId}`;
}

/** The template as a PDF, each field shown by its name. */
export function contractTemplatePreviewPath(templateId: string): string {
  return `${contractTemplatePath(templateId)}/preview`;
}

/** The daily file clean-up, called by Vercel's scheduler (listed in vercel.json). */
export const FILE_HOUSEKEEPING_CRON_PATH = "/api/cron/file-housekeeping";

/** The Operator's cars. Called "cars" on screen; vehicles in code. */
export const CARS_PATH = "/cars";
export const NEW_CAR_PATH = `${CARS_PATH}/new`;
export const CARS_EXPORT_PATH = `${CARS_PATH}/export`;

/** The cars list filtered to one status, e.g. the available cars. */
export function carsWithStatusPath(status: string): string {
  return `${CARS_PATH}?${new URLSearchParams({ status })}`;
}

export function carPath(vehicleId: string): string {
  return `${CARS_PATH}/${vehicleId}`;
}

/** Opens one of a car's photos or documents through a short-lived link, after checking who asks. */
export function carFilePath(vehicleId: string, fileId: string): string {
  return `${carPath(vehicleId)}/files/${fileId}`;
}

/** One damage record of a car. */
export function carDamagePath(vehicleId: string, damageId: string): string {
  return `${carPath(vehicleId)}/damage/${damageId}`;
}

export function editCarPath(vehicleId: string): string {
  return `${carPath(vehicleId)}/edit`;
}

/** Insurance policies: most cover one car, a fleet policy several. */
export const INSURANCE_PATH = `${CARS_PATH}/insurance`;
export const NEW_POLICY_PATH = `${INSURANCE_PATH}/new`;

export function policyPath(policyId: string): string {
  return `${INSURANCE_PATH}/${policyId}`;
}

/** Opens an attachment through a short-lived link, after checking who asks (and logging papers). */
export function attachmentPath(fileId: string): string {
  return `/attachments/${fileId}`;
}

/** The Operator's customers. */
export const RENTERS_PATH = "/renters";
export const NEW_RENTER_PATH = `${RENTERS_PATH}/new`;
export const RENTERS_EXPORT_PATH = `${RENTERS_PATH}/export`;

export function renterPath(renterId: string): string {
  return `${RENTERS_PATH}/${renterId}`;
}

export function editRenterPath(renterId: string): string {
  return `${renterPath(renterId)}/edit`;
}

/** Opens one side of a Renter's licence through a short-lived link; every opening is logged. */
export function licenceScanPath(renterId: string, fileId: string): string {
  return `${renterPath(renterId)}/licence/${fileId}`;
}

/** Where the Operator reviews the details a Renter sent through their link. */
export function renterReviewPath(renterId: string): string {
  return `${renterPath(renterId)}/review`;
}

/** Opens one photo a Renter sent, while it waits for review; every opening is logged. */
export function submittedPhotoPath(renterId: string, fileId: string): string {
  return `${renterReviewPath(renterId)}/photo/${fileId}`;
}

/** Everything held about a Renter as one Excel file; each download is logged. */
export function renterEverythingHeldPath(renterId: string): string {
  return `${renterPath(renterId)}/everything-held`;
}

/** Where a Renter's link opens, before its secret: `/r/<secret>`. */
export const RENTALS_PATH = "/rentals";
export const NEW_RENTAL_PATH = `${RENTALS_PATH}/new`;
export const RENTALS_CALENDAR_PATH = `${RENTALS_PATH}/calendar`;

/** The rentals list filtered to one status, e.g. the active ones. */
export function rentalsWithStatusPath(status: string): string {
  return `${RENTALS_PATH}?${new URLSearchParams({ status })}`;
}
/** What the New rental form takes from its address, to open with the Renter or car chosen. */
export const NEW_RENTAL_PRESETS = ["renterId", "vehicleId"] as const;

export function rentalPath(rentalId: string): string {
  return `${RENTALS_PATH}/${rentalId}`;
}

/** The rental's contract as a PDF, filled in but not issued. */
export function rentalContractPreviewPath(rentalId: string): string {
  return `${rentalPath(rentalId)}/contract-preview`;
}

/** Which one of a rental's documents of a kind to open, when it has several (changes of terms). */
export const DOCUMENT_ID_PARAM = "document";

/**
 * The rental's latest signed contract, handover report, return report or
 * change of terms, as a PDF; or the one named, when a rental has several.
 */
export function rentalDocumentPath(
  rentalId: string,
  kind: "contract" | "handover_report" | "return_report" | "change_of_terms",
  documentId?: string,
): string {
  const path = `${rentalPath(rentalId)}/documents/${kind}`;
  return documentId ? `${path}?${DOCUMENT_ID_PARAM}=${documentId}` : path;
}

export function rentalHandoverPath(rentalId: string): string {
  return `${rentalPath(rentalId)}/handover`;
}

export function rentalReturnPath(rentalId: string): string {
  return `${rentalPath(rentalId)}/return`;
}

/** The New rental form, opened from a Renter's or a car's page with them chosen. */
export function newRentalPath(preset: { renterId?: string; vehicleId?: string } = {}): string {
  const query = new URLSearchParams(
    Object.entries(preset).filter((entry): entry is [string, string] => Boolean(entry[1])),
  ).toString();
  return query ? `${NEW_RENTAL_PATH}?${query}` : NEW_RENTAL_PATH;
}

export const RENTER_LINK_PATH = "/r";

export function renterLinkPagePath(token: string): string {
  return `${RENTER_LINK_PATH}/${token}`;
}
