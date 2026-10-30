import {
  AUSTRALIAN_STATE_CODES,
  blankAsMissing,
  centsForEditing,
  emptyForm,
  formatAustralianPhone,
  formatKilometresAsTyped,
  isPrivatePurchase,
  isLocalDateTime,
  localDateTimeToUtc,
  normaliseLicenceNumber,
  optionalLine,
  optionalPhone,
  PURCHASE_SOURCES,
  REQUIRED_MESSAGE,
  requiredDollars,
  requiredLine,
  requiredPhone,
  utcToLocalDateTime,
  VEHICLE_COST_KINDS,
} from "@fleetapp/core";
import { z } from "zod";

import { gstDollars, optionalDate, refineGstWithin, requiredDate } from "./amount-input";
import { optionalKilometres } from "./vehicle-input";

const PRIVATE_GST_MESSAGE = "A private seller charges no GST.";
const DATE_TIME_MESSAGE = "Enter the date and time.";
const SKIPPED_TIME_MESSAGE =
  "That time did not happen: the clocks went forward an hour. Check the time.";

/** How a car was bought, as entered on its Costs tab. */
export const purchaseInputSchema = z
  .object({
    purchasedOn: requiredDate,
    source: z.enum(PURCHASE_SOURCES, REQUIRED_MESSAGE),
    sellerName: requiredLine,
    sellerPhone: optionalPhone,
    sellerAddress: optionalLine,
    kilometres: optionalKilometres,
    priceCents: requiredDollars,
    gstCents: gstDollars,
  })
  .superRefine(refineGstWithin("priceCents"))
  .superRefine((input, context) => {
    if (input.source === "private" && input.gstCents !== 0) {
      context.addIssue({ code: "custom", path: ["gstCents"], message: PRIVATE_GST_MESSAGE });
    }
  });

export type PurchaseInput = z.infer<typeof purchaseInputSchema>;
/** What is saved on the purchase row: the odometer is a reading of its own. */
export type PurchaseRecord = Omit<PurchaseInput, "kilometres">;
export const PURCHASE_FORM_FIELDS = [
  "purchasedOn",
  "source",
  "sellerName",
  "sellerPhone",
  "sellerAddress",
  "kilometres",
  "priceCents",
  "gstCents",
] as const;
export type PurchaseFormField = (typeof PURCHASE_FORM_FIELDS)[number];
export type PurchaseFormValues = Record<PurchaseFormField, string>;

/** The moment of handover, typed on the Operator's clock and kept in UTC (rule 10). */
function soldAtIn(timeZone: string) {
  return z
    .string()
    .trim()
    .min(1, REQUIRED_MESSAGE)
    .transform((typed, context) => {
      if (!isLocalDateTime(typed)) {
        context.addIssue({ code: "custom", message: DATE_TIME_MESSAGE });
        return z.NEVER;
      }
      const moment = localDateTimeToUtc(typed, timeZone);
      if (!moment) {
        context.addIssue({ code: "custom", message: SKIPPED_TIME_MESSAGE });
        return z.NEVER;
      }
      return moment;
    });
}

function saleInputSchemaIn(timeZone: string) {
  return z
    .object({
      soldAt: soldAtIn(timeZone),
      priceCents: requiredDollars,
      gstCents: gstDollars,
      buyerName: requiredLine,
      buyerPhone: requiredPhone,
      buyerAddress: requiredLine,
      buyerLicenceNumber: optionalLine.transform((value) =>
        value === null ? null : normaliseLicenceNumber(value) || null,
      ),
      buyerLicenceState: z.enum(AUSTRALIAN_STATE_CODES).nullable(),
      transferLodgedOn: optionalDate,
      transferReference: optionalLine.transform((value) => value?.toUpperCase() ?? null),
    })
    .superRefine(refineGstWithin("priceCents"));
}

export type SaleInput = z.infer<ReturnType<typeof saleInputSchemaIn>>;
export const SALE_FORM_FIELDS = [
  "soldAt",
  "priceCents",
  "gstCents",
  "buyerName",
  "buyerPhone",
  "buyerAddress",
  "buyerLicenceNumber",
  "buyerLicenceState",
  "transferLodgedOn",
  "transferReference",
] as const;
export type SaleFormField = (typeof SALE_FORM_FIELDS)[number];
export type SaleFormValues = Record<SaleFormField, string>;

/** One other cost of a car, as entered on its Costs tab. */
export const costInputSchema = z
  .object({
    incurredOn: requiredDate,
    kind: z.enum(VEHICLE_COST_KINDS, REQUIRED_MESSAGE),
    description: requiredLine,
    costCents: requiredDollars,
    gstCents: gstDollars,
  })
  .superRefine(refineGstWithin("costCents"));

export type CostInput = z.infer<typeof costInputSchema>;
export const COST_FORM_FIELDS = [
  "incurredOn",
  "kind",
  "description",
  "costCents",
  "gstCents",
] as const;
export type CostFormField = (typeof COST_FORM_FIELDS)[number];
export type CostFormValues = Record<CostFormField, string>;

const OPTIONAL_COST_FIELDS: readonly string[] = [
  "sellerPhone",
  "sellerAddress",
  "kilometres",
  "gstCents",
  "buyerLicenceNumber",
  "buyerLicenceState",
  "transferLodgedOn",
  "transferReference",
];

export function isRequiredCostField(field: string): boolean {
  return !OPTIONAL_COST_FIELDS.includes(field);
}

/** A private purchase has no GST box, so whatever it last held is ignored. */
export function parsePurchaseForm(values: PurchaseFormValues): z.ZodSafeParseResult<PurchaseInput> {
  return purchaseInputSchema.safeParse({
    ...blankAsMissing(values, ["source"]),
    gstCents: isPrivatePurchase(values.source) ? "" : values.gstCents,
  });
}

export function parseSaleForm(
  values: SaleFormValues,
  timeZone: string,
): z.ZodSafeParseResult<SaleInput> {
  return saleInputSchemaIn(timeZone).safeParse(blankAsMissing(values, ["buyerLicenceState"]));
}

export function parseCostForm(values: CostFormValues): z.ZodSafeParseResult<CostInput> {
  return costInputSchema.safeParse(blankAsMissing(values, ["kind"]));
}

export function emptyPurchaseForm(): PurchaseFormValues {
  return emptyForm(PURCHASE_FORM_FIELDS);
}

export function emptySaleForm(): SaleFormValues {
  return emptyForm(SALE_FORM_FIELDS);
}

export function emptyCostForm(): CostFormValues {
  return emptyForm(COST_FORM_FIELDS);
}

function gstForEditing(gstCents: number): string {
  return gstCents === 0 ? "" : centsForEditing(gstCents);
}

/** A saved purchase as the edit form's boxes show it. */
export function purchaseFormValues(
  purchase: PurchaseRecord,
  kilometres: number | null,
): PurchaseFormValues {
  return {
    purchasedOn: purchase.purchasedOn,
    source: purchase.source,
    sellerName: purchase.sellerName,
    sellerPhone: purchase.sellerPhone ? formatAustralianPhone(purchase.sellerPhone) : "",
    sellerAddress: purchase.sellerAddress ?? "",
    kilometres: kilometres === null ? "" : formatKilometresAsTyped(String(kilometres)),
    priceCents: centsForEditing(purchase.priceCents),
    gstCents: gstForEditing(purchase.gstCents),
  };
}

/** A saved sale as the edit form's boxes show it, with the time on the Operator's clock. */
export function saleFormValues(sale: SaleInput, timeZone: string): SaleFormValues {
  return {
    soldAt: utcToLocalDateTime(sale.soldAt, timeZone),
    priceCents: centsForEditing(sale.priceCents),
    gstCents: gstForEditing(sale.gstCents),
    buyerName: sale.buyerName,
    buyerPhone: formatAustralianPhone(sale.buyerPhone),
    buyerAddress: sale.buyerAddress,
    buyerLicenceNumber: sale.buyerLicenceNumber ?? "",
    buyerLicenceState: sale.buyerLicenceState ?? "",
    transferLodgedOn: sale.transferLodgedOn ?? "",
    transferReference: sale.transferReference ?? "",
  };
}

/** Never shown in a history line, only that they changed (rule 7 for the licence). */
export const PERSONAL_PURCHASE_FIELDS = ["sellerName", "sellerPhone", "sellerAddress"] as const;
export const PERSONAL_SALE_FIELDS = [
  "buyerName",
  "buyerPhone",
  "buyerAddress",
  "buyerLicenceNumber",
  "buyerLicenceState",
] as const;
