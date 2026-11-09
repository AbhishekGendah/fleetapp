import { z } from "zod";

import { HOW_TO_PAY_MAX_LENGTH, ONE_OFF_CHARGE_INVOICING } from "./billing";

import {
  DEFAULT_RENTER_LINK_DAYS,
  MAXIMUM_RENTER_LINK_DAYS,
  MINIMUM_RENTER_LINK_DAYS,
} from "./renter-links";
import {
  DEFAULT_LICENCE_SCAN_KEPT_MONTHS,
  MAXIMUM_LICENCE_SCAN_KEPT_MONTHS,
  MINIMUM_LICENCE_SCAN_KEPT_MONTHS,
} from "./licence-retention";
import {
  DEFAULT_BOND_HOLD_DAYS,
  DEFAULT_MINIMUM_RENTER_AGE_YEARS,
  DEFAULT_ONGOING_NOTICE_DAYS,
  MAXIMUM_BOND_HOLD_DAYS,
  MAXIMUM_MINIMUM_RENTER_AGE_YEARS,
  MAXIMUM_ONGOING_NOTICE_DAYS,
  PART_WEEK_CHARGING,
  WEEKDAYS,
} from "./rentals";
import { MINIMUM_DRIVER_AGE_YEARS } from "./renters";
import {
  DEFAULT_GRACE_MINUTES,
  DEFAULT_LONG_TERM_MINIMUM_DAYS,
  MAXIMUM_GRACE_MINUTES,
  MAXIMUM_LONG_TERM_MINIMUM_DAYS,
} from "./rent-blocks";
import { DEFAULT_HANDOVER_PHOTOS, handoverPhotoListSchema } from "./handover";
import {
  DEFAULT_EXPIRY_WARNING_DAYS,
  MAXIMUM_EXPIRY_WARNING_DAYS,
  MINIMUM_EXPIRY_WARNING_DAYS,
} from "./expiry";
import { DEFAULT_PAYMENT_GRACE_DAYS, MAXIMUM_PAYMENT_GRACE_DAYS } from "./overdue";
import { DEBIT_COLLECTION_PLANS, DEFAULT_ONE_OFF_COLLECTION } from "./weekly-debits";

/**
 * Every Operator setting that is not a business detail, as one validated
 * document (docs/plans/phase-1b.md, slice 2).
 *
 * Each later phase adds its own section here, every field with a default
 * (rule 27). A stored document holds only what the Operator has changed;
 * anything missing is read as its default, so adding a setting needs no data
 * migration and every Operator gets the default at once.
 *
 * No setting is added before the feature that uses it.
 */
export const operatorSettingsSchema = z.object({
  /** Cars: how many days before rego or insurance expires it shows "Due soon". */
  vehicleExpiryWarningDays: z
    .number()
    .int()
    .min(MINIMUM_EXPIRY_WARNING_DAYS)
    .max(MAXIMUM_EXPIRY_WARNING_DAYS)
    .default(DEFAULT_EXPIRY_WARNING_DAYS),
  /** Renters: how many days before a licence expires it shows "Due soon". */
  licenceExpiryWarningDays: z
    .number()
    .int()
    .min(MINIMUM_EXPIRY_WARNING_DAYS)
    .max(MAXIMUM_EXPIRY_WARNING_DAYS)
    .default(DEFAULT_EXPIRY_WARNING_DAYS),
  /** Renters: how many days a details form link works for. */
  renterLinkValidDays: z
    .number()
    .int()
    .min(MINIMUM_RENTER_LINK_DAYS)
    .max(MAXIMUM_RENTER_LINK_DAYS)
    .default(DEFAULT_RENTER_LINK_DAYS),
  /** Renters: licence scans are deleted this many months after the last rental, or after being added. */
  licenceScanKeptMonths: z
    .number()
    .int()
    .min(MINIMUM_LICENCE_SCAN_KEPT_MONTHS)
    .max(MAXIMUM_LICENCE_SCAN_KEPT_MONTHS)
    .default(DEFAULT_LICENCE_SCAN_KEPT_MONTHS),

  // Rentals (Phase 3). Copied onto each rental when it is made (rule 14).
  /** The youngest a Renter may be on the day the rental starts. */
  minimumRenterAgeYears: z
    .number()
    .int()
    .min(MINIMUM_DRIVER_AGE_YEARS)
    .max(MAXIMUM_MINIMUM_RENTER_AGE_YEARS)
    .default(DEFAULT_MINIMUM_RENTER_AGE_YEARS),
  /** Whether a provisional (P plate) licence may rent. */
  isProvisionalLicenceAllowed: z.boolean().default(false),
  /**
   * Minutes past a whole 24-hour block that are free at the return
   * (docs/plans/review-fixes-batch-1.md). Copied onto each rental.
   */
  graceMinutes: z.number().int().min(0).max(MAXIMUM_GRACE_MINUTES).default(DEFAULT_GRACE_MINUTES),
  /**
   * Rentals booked for at least this many days (and ongoing ones) are
   * long-term: the cheaper weekly price, re-priced at the daily rate if they
   * end sooner. Copied onto each rental.
   */
  longTermMinimumDays: z
    .number()
    .int()
    .min(1)
    .max(MAXIMUM_LONG_TERM_MINIMUM_DAYS)
    .default(DEFAULT_LONG_TERM_MINIMUM_DAYS),
  /** Weekday-model rentals only (made before rent in blocks); no longer offered. */
  fixedChargeWeekday: z.union([z.literal(WEEKDAYS), z.null()]).default(null),
  /** Weekday-model rentals only (made before rent in blocks); no longer offered. */
  partWeekCharging: z.enum(PART_WEEK_CHARGING).default("daily_pro_rata"),
  /** Whether the full bond must be held before the car is handed over. */
  isBondRequiredBeforeHandover: z.boolean().default(true),
  /**
   * Whether the Renter's direct debit must be set up before the car is
   * handed over (docs/design/05). Applies only once the business can take
   * payments by Stripe.
   */
  isDirectDebitRequiredBeforeHandover: z.boolean().default(true),
  /** How long the bond is kept after the car comes back, for late fines and tolls. */
  bondHoldDaysAfterReturn: z
    .number()
    .int()
    .min(0)
    .max(MAXIMUM_BOND_HOLD_DAYS)
    .default(DEFAULT_BOND_HOLD_DAYS),
  /**
   * Whether the Renter must sign at the return. Off by default
   * (docs/design/05): an after-hours drop-off has nobody to sign.
   */
  isRenterSignatureAtReturnRequired: z.boolean().default(false),
  /** The photos the handover checklist asks for, in order. */
  handoverPhotos: handoverPhotoListSchema.default([...DEFAULT_HANDOVER_PHOTOS]),
  /** The notice a Renter on an ongoing rental gives before returning the car. */
  ongoingNoticeDays: z
    .number()
    .int()
    .min(0)
    .max(MAXIMUM_ONGOING_NOTICE_DAYS)
    .default(DEFAULT_ONGOING_NOTICE_DAYS),

  // Money (Phase 4).
  /** One-off charges: on the next weekly invoice, or invoiced at once. Copied onto each rental. */
  oneOffChargeInvoicing: z.enum(ONE_OFF_CHARGE_INVOICING).default("with_next_rent"),
  /**
   * How a one-off charge is collected when the Renter pays by direct debit:
   * invoice only unless the business picks otherwise for the charge
   * (decision 2 as changed on 9 Nov). Copied onto each rental (rule 14).
   */
  oneOffChargeCollection: z.enum(DEBIT_COLLECTION_PLANS).default(DEFAULT_ONE_OFF_COLLECTION),
  /** Whether invoices, credit notes and receipts are emailed to the Renter as they are issued. */
  isInvoiceEmailedAutomatically: z.boolean().default(true),
  /** Printed on every invoice: how to pay, e.g. the business's bank details for a transfer. */
  howToPay: z.string().trim().max(HOW_TO_PAY_MAX_LENGTH).default(""),
  /**
   * Grace days: money still owing this many days after it was due counts as
   * overdue. Needs attention reads today's value (it only shows things); the
   * late fee (Phase 4 slice 6) will copy it onto each rental (rule 14).
   */
  paymentGraceDays: z
    .number()
    .int()
    .min(0)
    .max(MAXIMUM_PAYMENT_GRACE_DAYS)
    .default(DEFAULT_PAYMENT_GRACE_DAYS),
});

export type OperatorSettings = z.infer<typeof operatorSettingsSchema>;

/** A stored settings document of any shape, as it comes out of the database. */
export type StoredSettings = Record<string, unknown>;

export class InvalidSettingsError extends Error {
  constructor(readonly issues: z.core.$ZodIssue[]) {
    super("The settings were not valid.");
    this.name = "InvalidSettingsError";
  }
}

/**
 * The settings in force: what is stored, with defaults filled in. Throws if
 * what is stored no longer fits the schema, rather than quietly running a
 * rental on settings nobody chose.
 */
export function readSettings<Schema extends z.ZodType>(
  schema: Schema,
  stored: StoredSettings,
): z.infer<Schema> {
  const parsed = schema.safeParse(stored);
  if (!parsed.success) {
    throw new InvalidSettingsError(parsed.error.issues);
  }
  return parsed.data;
}

/**
 * After a change: the document to store (only what the Operator has set,
 * so a default changed later still reaches every setting they never
 * touched) and the settings it gives, checked against the schema as a whole.
 */
export function applySettingsChanges<Schema extends z.ZodType>(
  schema: Schema,
  current: StoredSettings,
  changes: StoredSettings,
): { document: StoredSettings; settings: z.infer<Schema> } {
  const document = { ...current, ...changes };
  return { document, settings: readSettings(schema, document) };
}

export interface SettingsSnapshot<Settings> {
  /** The settings version this copy was taken from. */
  version: number;
  settings: Readonly<Settings>;
}

function deepFreeze<Value>(value: Value): Value {
  if (typeof value === "object" && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/**
 * A full, frozen copy of the settings, for a rental to keep (rule 14).
 * Taken as a copy so a later change to the Operator's settings can never
 * reach a rental already running on the old ones.
 */
export function snapshotSettings<Settings>(
  settings: Settings,
  version: number,
): SettingsSnapshot<Settings> {
  return deepFreeze({ version, settings: structuredClone(settings) });
}
