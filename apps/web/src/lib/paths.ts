/** The Operator app's own pages that other code sends people to. */
export const HOME_PATH = "/";
export const SIGN_IN_PATH = "/sign-in";
/** Everything that needs the Operator's attention, in full (the dashboard shows the top five). */
export const ATTENTION_PATH = "/attention";
export const SET_UP_AUTHENTICATOR_PATH = "/set-up-authenticator";
export const SUSPENDED_PATH = "/suspended";
export const FORGOT_PASSWORD_PATH = "/forgot-password";
export const RESET_PASSWORD_PATH = "/reset-password";
export const SETTINGS_PATH = "/settings";
/** The business details card on the Settings page, for linking straight to it. */
export const BUSINESS_DETAILS_ANCHOR = "business-details";
export const BUSINESS_DETAILS_PATH = `${SETTINGS_PATH}#${BUSINESS_DETAILS_ANCHOR}`;
export const CONTRACTS_PATH = `${SETTINGS_PATH}/contracts`;
export const CHARGE_TYPES_PATH = `${SETTINGS_PATH}/charges`;
export const INVOICE_SETTINGS_PATH = `${SETTINGS_PATH}/invoices`;
export const PAYMENT_SETTINGS_PATH = `${SETTINGS_PATH}/payments`;
/** Where Stripe's onboarding sends the business when its link has expired: a fresh link is made there. */
export const STRIPE_ONBOARDING_PATH = `${PAYMENT_SETTINGS_PATH}/continue`;
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

/** The Renter's Money tab: every ledger line of every rental of theirs. */
export function renterMoneyPath(renterId: string): string {
  return `${renterPath(renterId)}?tab=money`;
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
/** The business's privacy notice for its Renters, to show or print for one added at the counter. */
export const PRIVACY_NOTICE_PATH = "/privacy-notice";

export const RENTALS_PATH = "/rentals";
export const NEW_RENTAL_PATH = `${RENTALS_PATH}/new`;
export const RENTALS_CALENDAR_PATH = `${RENTALS_PATH}/calendar`;
export const RENTALS_TIMELINE_PATH = `${RENTALS_PATH}/timeline`;

/**
 * The Calendar page's address: which view (Month, or By car), the month or
 * day it opens on, and one car. Each is left out for its usual: Month (Day
 * by day on a phone), this month, every car.
 */
export const CALENDAR_VIEW_PARAM = "view";
/** The By car view (was the fleet timeline): ?view=car. */
export const CALENDAR_BY_CAR_VIEW = "car";
/** "2026-11". */
export const CALENDAR_MONTH_PARAM = "month";
/** "2026-11-07": the day it opens on, marked, with that day's handovers and returns listed. */
export const CALENDAR_DAY_PARAM = "day";
export const CALENDAR_CAR_PARAM = "car";

export interface CalendarAddress {
  isByCar?: boolean;
  month?: string;
  day?: string;
  vehicleId?: string;
}

export function calendarPath(address: CalendarAddress = {}): string {
  const query = new URLSearchParams();
  if (address.isByCar) {
    query.set(CALENDAR_VIEW_PARAM, CALENDAR_BY_CAR_VIEW);
  }
  if (address.month) {
    query.set(CALENDAR_MONTH_PARAM, address.month);
  }
  if (address.day) {
    query.set(CALENDAR_DAY_PARAM, address.day);
  }
  if (address.vehicleId) {
    query.set(CALENDAR_CAR_PARAM, address.vehicleId);
  }
  const text = query.toString();
  return text ? `${RENTALS_CALENDAR_PATH}?${text}` : RENTALS_CALENDAR_PATH;
}

/** The calendar opened on a day: e.g. a day of the dashboard's Later this week. */
export function calendarDayPath(isoDate: string): string {
  return calendarPath({ day: isoDate });
}

/** The rentals list filtered to one status, e.g. "out" (rental-list-status). */
export function rentalsWithStatusPath(status: string): string {
  return `${RENTALS_PATH}?${new URLSearchParams({ status })}`;
}
/** What the New rental form takes from its address, to open with the Renter or car chosen. */
export const NEW_RENTAL_PRESETS = ["renterId", "vehicleId"] as const;

export function rentalPath(rentalId: string): string {
  return `${RENTALS_PATH}/${rentalId}`;
}

/** A car swap's checklist on the phone: the old car's return, or the new car's handover. */
export function rentalSwapPath(rentalId: string, car: "old" | "new"): string {
  return `${rentalPath(rentalId)}/swap/${car}`;
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
  kind:
    | "contract"
    | "handover_report"
    | "return_report"
    | "change_of_terms"
    | "swap_form"
    | "invoice"
    | "credit_note"
    | "receipt"
    | "statement",
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

/** A day the New rental form starts on, e.g. an empty day tapped on the timeline. */
export const NEW_RENTAL_STARTS_ON = "startsOn";

/** The New rental form, opened from a Renter's or a car's page (or the timeline) with them chosen. */
export function newRentalPath(
  preset: { renterId?: string; vehicleId?: string; [NEW_RENTAL_STARTS_ON]?: string } = {},
): string {
  const query = new URLSearchParams(
    Object.entries(preset).filter((entry): entry is [string, string] => Boolean(entry[1])),
  ).toString();
  return query ? `${NEW_RENTAL_PATH}?${query}` : NEW_RENTAL_PATH;
}

export const RENTER_LINK_PATH = "/r";

export function renterLinkPagePath(token: string): string {
  return `${RENTER_LINK_PATH}/${token}`;
}

/**
 * Where Stripe's page sends the Renter back to. It holds no secret: the
 * page takes the Renter back to the link they came from, remembered on
 * their own phone, so the link's secret is never given to Stripe.
 */
export const STRIPE_RETURN_PATH = `${RENTER_LINK_PATH}/back`;
/** Test sites only: the stand-in for Stripe's page in the browser tests. */
export const STAND_IN_CHECKOUT_PATH = `${RENTER_LINK_PATH}/stand-in-checkout`;
