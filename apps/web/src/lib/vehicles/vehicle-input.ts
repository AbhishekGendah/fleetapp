import {
  AUSTRALIAN_STATE_CODES,
  blankAsMissing,
  BODY_TYPES,
  EARLIEST_VEHICLE_YEAR,
  emptyForm,
  FUEL_TYPES,
  isCalendarDate,
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

const kilometresField = wholeNumber({
  minimum: 0,
  maximum: MAXIMUM_ODOMETER_KM,
  message: "Enter the kilometres shown, as a whole number.",
});

/**
 * A car's boxes on the add or edit form. Rego, state, make, model and year
 * are required: they are what identifies a car on a contract or a fine.
 */
function vehicleFieldsShape(today: Date) {
  const latestYear = latestVehicleYear(today);
  return {
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
  };
}

/** The model in the list's spelling for its make, once the make itself is known. */
function withListedModel<Input extends { make: string; model: string }>(input: Input): Input {
  return { ...input, model: inListSpelling(() => modelsForMake(input.make))(input.model) };
}

function vehicleInputSchema(today: Date) {
  return z.object(vehicleFieldsShape(today)).transform(withListedModel);
}

/** A new car starts with what its odometer shows, so its km are known from day one. */
function newVehicleInputSchema(today: Date) {
  return z
    .object({ ...vehicleFieldsShape(today), kilometres: kilometresField })
    .transform(withListedModel);
}

export type VehicleInput = z.infer<ReturnType<typeof vehicleInputSchema>>;
export type NewVehicleInput = z.infer<ReturnType<typeof newVehicleInputSchema>>;

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

/** The add form also asks for the odometer; the edit form does not (readings have their own tab). */
export const NEW_VEHICLE_FORM_FIELDS = [...VEHICLE_FORM_FIELDS, "kilometres"] as const;

export type VehicleFormField = (typeof NEW_VEHICLE_FORM_FIELDS)[number];
export type VehicleFormValues = Record<VehicleFormField, string>;

const REQUIRED_VEHICLE_FIELDS: readonly VehicleFormField[] = [
  "rego",
  "regoState",
  "make",
  "model",
  "year",
  "kilometres",
];

export function isRequiredVehicleField(field: VehicleFormField): boolean {
  return REQUIRED_VEHICLE_FIELDS.includes(field);
}

export const EMPTY_VEHICLE_FORM: VehicleFormValues = emptyForm(NEW_VEHICLE_FORM_FIELDS);

/** A saved car as the edit form's boxes show it. */
export function vehicleFormValues(
  vehicle: Readonly<Record<(typeof VEHICLE_FORM_FIELDS)[number], string | number | null>>,
): VehicleFormValues {
  return {
    ...EMPTY_VEHICLE_FORM,
    ...Object.fromEntries(
      VEHICLE_FORM_FIELDS.map((field) => [
        field,
        vehicle[field] === null ? "" : String(vehicle[field]),
      ]),
    ),
  };
}

function formForParsing(values: Partial<VehicleFormValues>): Record<string, string | null> {
  return blankAsMissing(values as Record<string, string>, ["regoState"]);
}

/** The edit form's checks, the same in the browser as you type and on the server on save. */
export function parseVehicleForm(
  values: Partial<VehicleFormValues>,
  today: Date,
): z.ZodSafeParseResult<VehicleInput> {
  return vehicleInputSchema(today).safeParse(formForParsing(values));
}

/** The add form's checks: the car plus its first odometer reading. */
export function parseNewVehicleForm(
  values: Partial<VehicleFormValues>,
  today: Date,
): z.ZodSafeParseResult<NewVehicleInput> {
  return newVehicleInputSchema(today).safeParse(formForParsing(values));
}

/** Rego as it is typed: capitals, letters and numbers only, never longer than a plate can be. */
export function typedRego(raw: string): string {
  return normaliseRego(raw).slice(0, MAXIMUM_REGO_LENGTH);
}

/** A car's status as chosen on the status form. */
export const vehicleStatusInputSchema = z
  .object({
    status: z.enum(VEHICLE_STATUSES, "Choose a status."),
    statusReason: optionalLine,
    statusExpectedBack: optionalLine.refine(
      (value) => value === null || isCalendarDate(value),
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

export const odometerInputSchema = z.object({ kilometres: kilometresField });
