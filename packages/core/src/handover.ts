import { z } from "zod";

import { optionalLine, optionalText, REQUIRED_MESSAGE, requiredLine } from "./form-text";
import { formatDateTimeInTimeZone } from "./format-date-time";
import { AUSTRALIAN_LOCALE } from "./locale";

/**
 * Handing a car over and taking it back (docs/design/05): the same
 * checklist both ways. The handover's is filled in on the Operator's phone
 * and accepted by the Renter there and then; possession starts at that
 * moment (rule 15).
 */
export const INSPECTION_KINDS = ["handover", "return"] as const;
export type InspectionKind = (typeof INSPECTION_KINDS)[number];

export const INSPECTION_STATUSES = ["in_progress", "completed", "cancelled"] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

/** The photos every handover asks for, until the Operator changes the list in Settings. */
export const DEFAULT_HANDOVER_PHOTOS = [
  "Front",
  "Rear",
  "Left side",
  "Right side",
  "Interior front",
  "Interior rear",
  "Dashboard (kilometres and fuel)",
  "Boot",
] as const;
export const MAXIMUM_HANDOVER_PHOTOS = 20;
export const MAXIMUM_PHOTO_NAME_LENGTH = 60;

/**
 * The handover photo list as an Operator edits it: one per line, each named
 * once, at least one. Names are kept as typed, so the checklist reads in
 * the Operator's own words.
 */
export const handoverPhotoListSchema = z
  .array(z.string().trim().min(1).max(MAXIMUM_PHOTO_NAME_LENGTH))
  .min(1)
  .max(MAXIMUM_HANDOVER_PHOTOS)
  .refine(
    (names) => new Set(names.map((name) => name.toLowerCase())).size === names.length,
    "Each photo can be on the list once.",
  );

/** One photo per line, blank lines dropped: how the Settings box turns into the list. */
export function photoListFromLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export const FUEL_LEVELS = ["empty", "quarter", "half", "three_quarters", "full"] as const;
export type FuelLevel = (typeof FUEL_LEVELS)[number];

export const FUEL_LEVEL_LABELS: Readonly<Record<FuelLevel, string>> = {
  empty: "Empty",
  quarter: "1/4",
  half: "1/2",
  three_quarters: "3/4",
  full: "Full",
};

/** The most keys a car comes with; one digit. */
export const MAXIMUM_KEYS = 9;
const KEYS_MESSAGE = `Enter how many keys, from 1 to ${MAXIMUM_KEYS}.`;

/**
 * Where a damage mark sits on the car outline: across and down, each from 0
 * to this, so a mark lands in the same place whatever the screen's size.
 */
export const OUTLINE_SCALE = 1000;

/**
 * Areas of the car, each with its place on the outline: for marking damage
 * from a list (keyboard, screen reader) as well as by tapping the drawing.
 * The outline is seen from above, the front at the top.
 */
export const CAR_AREAS = [
  { key: "front", label: "Front bumper", x: 500, y: 90 },
  { key: "bonnet", label: "Bonnet", x: 500, y: 240 },
  { key: "windscreen", label: "Windscreen", x: 500, y: 360 },
  { key: "roof", label: "Roof", x: 500, y: 520 },
  { key: "boot", label: "Boot", x: 500, y: 800 },
  { key: "rear", label: "Rear bumper", x: 500, y: 920 },
  { key: "front_left", label: "Front left (passenger side)", x: 330, y: 260 },
  { key: "front_right", label: "Front right (driver's side)", x: 670, y: 260 },
  { key: "left_side", label: "Left side doors", x: 330, y: 520 },
  { key: "right_side", label: "Right side doors", x: 670, y: 520 },
  { key: "rear_left", label: "Rear left", x: 330, y: 780 },
  { key: "rear_right", label: "Rear right", x: 670, y: 780 },
] as const;
export type CarAreaKey = (typeof CAR_AREAS)[number]["key"];

export const damageMarkInputSchema = z.object({
  x: z.number().int().min(0).max(OUTLINE_SCALE),
  y: z.number().int().min(0).max(OUTLINE_SCALE),
  description: requiredLine,
});
export type DamageMarkInput = z.infer<typeof damageMarkInputSchema>;

/**
 * The checklist's details as typed. Kilometres come from the shared
 * kilometres box (digits only, checked against the car's last reading on
 * the server); keys are one digit.
 */
export const handoverDetailsInputSchema = z.object({
  fuelLevel: z.enum(FUEL_LEVELS, REQUIRED_MESSAGE),
  keysCount: z
    .string()
    .trim()
    .min(1, REQUIRED_MESSAGE)
    .regex(/^\d$/, KEYS_MESSAGE)
    .transform(Number)
    .refine((keys) => keys >= 1 && keys <= MAXIMUM_KEYS, KEYS_MESSAGE),
  accessories: optionalLine,
  notes: optionalText,
});
export type HandoverDetailsInput = z.infer<typeof handoverDetailsInputSchema>;

/** What still has to be done before the Renter can accept the car, in checklist order. */
export type HandoverGap =
  { kind: "photo"; name: string } | { kind: "odometer" | "fuel" | "keys" | "damage_photo" };

export interface HandoverProgress {
  photoNames: readonly string[];
  photosTaken: ReadonlySet<string>;
  odometerKm: number | null;
  fuelLevel: FuelLevel | null;
  keysCount: number | null;
  /** Each damage mark, and whether it has its photo. */
  damageMarks: readonly { hasPhoto: boolean }[];
}

/** Every photo on the list, the kilometres, fuel and keys, and a photo of each damage mark. */
export function handoverGaps(progress: HandoverProgress): HandoverGap[] {
  const gaps: HandoverGap[] = progress.photoNames
    .filter((name) => !progress.photosTaken.has(name))
    .map((name) => ({ kind: "photo", name }));
  if (progress.odometerKm === null) {
    gaps.push({ kind: "odometer" });
  }
  if (progress.fuelLevel === null) {
    gaps.push({ kind: "fuel" });
  }
  if (progress.keysCount === null) {
    gaps.push({ kind: "keys" });
  }
  if (progress.damageMarks.some((mark) => !mark.hasPhoto)) {
    gaps.push({ kind: "damage_photo" });
  }
  return gaps;
}

/** What a Renter signs to at a handover or return: when, the kilometres and fuel, the condition. */
export interface AcceptanceFacts {
  at: Date;
  timeZone: string;
  odometerKm: number;
  fuelLevel: FuelLevel;
}

/** The accepted words, the same at both ends of a rental but for "received" or "returned". */
export function acceptanceWording(verb: "received" | "returned", facts: AcceptanceFacts): string {
  const kilometres = facts.odometerKm.toLocaleString(AUSTRALIAN_LOCALE);
  return `I ${verb} this car on ${formatDateTimeInTimeZone(facts.at, facts.timeZone)}, with ${kilometres} km on the odometer and ${FUEL_LEVEL_LABELS[facts.fuelLevel]} fuel, in the condition shown in this report.`;
}

/**
 * The words the Renter accepts on the Operator's phone (decision 4): when,
 * at what kilometres and fuel, in the condition the report shows. Kept with
 * the report exactly as shown.
 */
export function handoverAcceptanceText(facts: AcceptanceFacts): string {
  return acceptanceWording("received", facts);
}
