import {
  AUSTRALIAN_STATE_CODES,
  BODY_TYPES,
  EARLIEST_VEHICLE_YEAR,
  FUEL_TYPES,
  isValidVin,
  latestVehicleYear,
  listedName,
  MAXIMUM_ODOMETER_KM,
  MAXIMUM_REGO_LENGTH,
  MAXIMUM_SEATS,
  modelsForMake,
  normaliseRego,
  normaliseVin,
  optionalLine,
  REQUIRED_MESSAGE,
  requiredLine,
  TRANSMISSIONS,
  VEHICLE_MAKES,
  VEHICLE_STATUSES,
  needsReturnDate,
} from "@fleetapp/core";
import { z } from "zod";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Blank means "not given" for the optional choices; anything else must be one of the options. */
function optionalChoice<const Option extends string>(options: readonly [Option, ...Option[]]) {
  return z
    .string()
    .transform((value) => (value === "" ? null : value))
    .pipe(z.enum(options, "Choose one from the list.").nullable());
}

/** A whole number typed in a box, between two limits. Spaces and commas are ignored. */
function wholeNumber(limits: { minimum: number; maximum: number; message: string }) {
  return requiredLine
    .transform((value) => value.replace(/[\s,]/g, ""))
    .refine((value) => /^\d+$/.test(value), limits.message)
    .transform(Number)
    .refine((value) => value >= limits.minimum && value <= limits.maximum, limits.message);
}

/** The list's own spelling when the name is listed in any case, so "toyota" is saved as "Toyota". */
function inListSpelling(names: () => readonly string[]) {
  return (value: string) => listedName(names(), value) ?? value;
}

/**
 * A car as entered on the add or edit form. Rego, state, make, model and
 * year are required: they are what identifies a car on a contract or a fine.
 */
function vehicleInputSchema(today: Date) {
  const latestYear = latestVehicleYear(today);
  return z
    .object({
      rego: requiredLine
        .transform(normaliseRego)
        .refine((rego) => rego.length > 0, REQUIRED_MESSAGE)
        .refine(
          (rego) => rego.length <= MAXIMUM_REGO_LENGTH,
          `A rego is at most ${MAXIMUM_REGO_LENGTH} letters and numbers.`,
        ),
      regoState: z.enum(AUSTRALIAN_STATE_CODES, REQUIRED_MESSAGE),
      vin: optionalLine
        .refine(
          (vin) => vin === null || isValidVin(vin),
          "A VIN is 17 letters and numbers, never I, O or Q.",
        )
        .transform((vin) => (vin === null ? null : normaliseVin(vin))),
      make: requiredLine.transform(inListSpelling(() => VEHICLE_MAKES)),
      model: requiredLine,
      variant: optionalLine,
      year: wholeNumber({
        minimum: EARLIEST_VEHICLE_YEAR,
        maximum: latestYear,
        message: `Enter a year from ${EARLIEST_VEHICLE_YEAR} to ${latestYear}.`,
      }),
      colour: optionalLine,
      bodyType: optionalChoice(BODY_TYPES),
      transmission: optionalChoice(TRANSMISSIONS),
      fuelType: optionalChoice(FUEL_TYPES),
      seats: optionalLine.pipe(
        wholeNumber({
          minimum: 1,
          maximum: MAXIMUM_SEATS,
          message: `Enter a number from 1 to ${MAXIMUM_SEATS}.`,
        }).nullable(),
      ),
    })
    .transform((input) => ({
      ...input,
      model: inListSpelling(() => modelsForMake(input.make))(input.model),
    }));
}

export type VehicleInput = z.infer<ReturnType<typeof vehicleInputSchema>>;

/** Every box on the car form, by name, in the order they appear. */
export const VEHICLE_FORM_FIELDS = [
  "rego",
  "regoState",
  "make",
  "model",
  "variant",
  "year",
  "colour",
  "bodyType",
  "transmission",
  "fuelType",
  "seats",
  "vin",
] as const satisfies readonly (keyof VehicleInput)[];

export type VehicleFormField = (typeof VEHICLE_FORM_FIELDS)[number];
export type VehicleFormValues = Record<VehicleFormField, string>;

const REQUIRED_VEHICLE_FIELDS: readonly VehicleFormField[] = [
  "rego",
  "regoState",
  "make",
  "model",
  "year",
];

export function isRequiredVehicleField(field: VehicleFormField): boolean {
  return REQUIRED_VEHICLE_FIELDS.includes(field);
}

export const EMPTY_VEHICLE_FORM: VehicleFormValues = Object.fromEntries(
  VEHICLE_FORM_FIELDS.map((field) => [field, ""]),
) as VehicleFormValues;

/** A saved car as the edit form's boxes show it. */
export function vehicleFormValues(
  vehicle: Readonly<Record<VehicleFormField, string | number | null>>,
): VehicleFormValues {
  return Object.fromEntries(
    VEHICLE_FORM_FIELDS.map((field) => [
      field,
      vehicle[field] === null ? "" : String(vehicle[field]),
    ]),
  ) as VehicleFormValues;
}

/** The same checks in the browser as you type and on the server on save. */
export function parseVehicleForm(
  values: VehicleFormValues,
  today: Date,
): z.ZodSafeParseResult<VehicleInput> {
  return vehicleInputSchema(today).safeParse({ ...values, regoState: values.regoState || null });
}

/** A car's status as chosen on the status form. */
export const vehicleStatusInputSchema = z
  .object({
    status: z.enum(VEHICLE_STATUSES, "Choose a status."),
    statusReason: optionalLine,
    statusExpectedBack: optionalLine.refine(
      (value) => value === null || ISO_DATE_PATTERN.test(value),
      "Enter a date.",
    ),
  })
  .superRefine((input, context) => {
    if (!needsReturnDate(input.status)) {
      return;
    }
    if (!input.statusReason) {
      context.addIssue({ code: "custom", path: ["statusReason"], message: "Say why." });
    }
    if (!input.statusExpectedBack) {
      context.addIssue({
        code: "custom",
        path: ["statusExpectedBack"],
        message: "Enter the date it should be back.",
      });
    }
  })
  // Only an "in service" or "off road" car keeps a reason and date.
  .transform((input) =>
    needsReturnDate(input.status)
      ? input
      : { ...input, statusReason: null, statusExpectedBack: null },
  );

export type VehicleStatusInput = z.infer<typeof vehicleStatusInputSchema>;
export type VehicleStatusFormValues = Record<keyof VehicleStatusInput, string>;

export const odometerInputSchema = z.object({
  kilometres: wholeNumber({
    minimum: 0,
    maximum: MAXIMUM_ODOMETER_KM,
    message: "Enter the kilometres shown, as a whole number.",
  }),
});
