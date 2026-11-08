"use client";

import {
  blocksBetween,
  fieldErrorsOf,
  isLongTermBooking,
  localDateTimeToUtc,
  MAXIMUM_NOTE_LENGTH,
  RENTAL_TYPE_LABELS,
  RENTAL_TYPES,
} from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { DateTimePicker } from "@fleetapp/ui/date-time-picker";
import { FormField } from "@fleetapp/ui/form-field";
import { FormError } from "@fleetapp/ui/form-message";
import { RequiredFieldsNote } from "@fleetapp/ui/input";
import { MoneyInput } from "@fleetapp/ui/money-input";
import { RecordPicker, type PickableRecord } from "@fleetapp/ui/record-picker";
import { Select } from "@fleetapp/ui/select";
import { Textarea } from "@fleetapp/ui/textarea";
import { useFormFields } from "@fleetapp/ui/use-form-fields";
import Link from "next/link";
import { useActionState } from "react";

import type { BusinessChoice } from "../../lib/rentals/driver-choices";
import {
  carPriceFields,
  DRIVER_TO_BE_NAMED,
  isRequiredRentalField,
  parseRentalForm,
  RENTAL_FORM_FIELDS,
  type CarPrices,
  type RentalFormValues,
} from "../../lib/rentals/rental-input";
import { LazyDriverPicker } from "./lazy-driver-picker";
import { BOOK_INTENT, DRAFT_INTENT, INTENT_FIELD, type RentalFormState } from "./rental-form-state";

const INITIAL_STATE: RentalFormState = { status: "editing" };

interface RentalFormProps {
  initialValues: RentalFormValues;
  renters: readonly PickableRecord[];
  /** The business Renters among them, by id, with who signs and their drivers (mockup 5). */
  businesses: Readonly<Record<string, BusinessChoice>>;
  cars: readonly PickableRecord[];
  /** Each car's prices: choosing a car fills the price boxes, which stay editable. */
  carPrices: Readonly<Record<string, CarPrices>>;
  timeZone: string;
  /** Booked for at least this many days, a rental is long-term (Settings → Rentals). */
  longTermMinimumDays: number;
  /** Minutes past a whole day that are free; booked days are counted the same way. */
  graceMinutes: number;
  action: (state: RentalFormState, formData: FormData) => Promise<RentalFormState>;
  cancelHref: string;
}

/**
 * Whether the rental as typed is long-term, in words, or null until the
 * dates are in. Ongoing rentals always are; others when booked for the minimum.
 */
function rentKindText(
  values: RentalFormValues,
  timeZone: string,
  terms: { minimumDays: number; graceMinutes: number },
): string {
  const minimumDays = terms.minimumDays;
  const start = localDateTimeToUtc(values.plannedStart, timeZone);
  const end = localDateTimeToUtc(values.plannedEnd, timeZone);
  const bookedBlocks =
    values.type === "ongoing"
      ? null
      : start && end && end > start
        ? blocksBetween(start, end, terms.graceMinutes)
        : 0;
  if (bookedBlocks === 0) {
    return `Rent is counted in 24-hour blocks from the handover. Booked for ${minimumDays} days or more, a rental gets the long-term price.`;
  }
  return isLongTermBooking(bookedBlocks, minimumDays)
    ? "Long-term: charged a week at a time at the long-term price. Back sooner than " +
        `${minimumDays} days, it is re-priced at the daily rate unless you waive it.`
    : `Short hire: ${bookedBlocks} ${bookedBlocks === 1 ? "day" : "days"} at the daily rate, charged at the handover.`;
}

/**
 * A new rental: who, which car, when, and for how much. Book holds the car
 * for those dates at once; Save as draft keeps it without holding the car.
 */
export function RentalForm(props: RentalFormProps) {
  const [state, formAction, isPending] = useActionState(props.action, INITIAL_STATE);
  const form = useFormFields({
    fields: RENTAL_FORM_FIELDS,
    initialValues: props.initialValues,
    validate: (values) => fieldErrorsOf(parseRentalForm(values, props.timeZone)),
    isRequired: (field, values) => isRequiredRentalField(field, values.type),
    maxLength: MAXIMUM_NOTE_LENGTH,
  });
  const shownState = form.isResultShown && !isPending ? state : INITIAL_STATE;
  const isFixedTerm = form.values.type === "fixed_term";
  const business = props.businesses[form.values.renterId];
  const field = (name: (typeof RENTAL_FORM_FIELDS)[number]) => ({
    htmlFor: form.idFor(name),
    isRequired: isRequiredRentalField(name, form.values.type),
    error: form.errorFor(name),
  });

  return (
    <form
      action={formAction}
      onSubmit={form.submitHandler(formAction)}
      noValidate
      className="flex flex-col gap-6"
    >
      <RequiredFieldsNote />
      <FormField
        label="Renter"
        {...field("renterId")}
        hint={
          business
            ? `The contract goes to ${business.contactName ?? "the business's contact"} to sign for ${business.legalName}.`
            : "Renters marked Do not rent are not listed."
        }
      >
        <RecordPicker
          {...form.boxProps("renterId")}
          records={props.renters}
          onValueChange={(value) => {
            form.setValue("renterId", value);
            // Another business's drivers are not this one's: start again from "to be named".
            form.setValue("driverId", DRIVER_TO_BE_NAMED);
          }}
          placeholder="Type a name, business, phone or email"
          emptyMessage="No Renter matches that. Add them on the Renters page first."
        />
      </FormField>
      {business ? (
        <LazyDriverPicker
          id={form.idFor("driverId")}
          name="driverId"
          businessId={form.values.renterId}
          business={business}
          value={form.values.driverId}
          onValueChange={(value) => form.setValue("driverId", value)}
          error={form.errorFor("driverId")}
        />
      ) : null}
      <FormField
        label="Car"
        {...field("vehicleId")}
        hint="Sold and written-off cars are not listed."
      >
        <RecordPicker
          {...form.boxProps("vehicleId")}
          records={props.cars}
          onValueChange={(value) => {
            form.setValue("vehicleId", value);
            const prices = carPriceFields(props.carPrices[value]);
            form.setValue("dailyRateCents", prices.dailyRateCents);
            form.setValue("longTermWeeklyCents", prices.longTermWeeklyCents);
          }}
          placeholder="Type a rego, make or model"
          emptyMessage="No car matches that."
        />
      </FormField>
      <FormField
        label="Kind of rental"
        {...field("type")}
        hint="Ongoing has no end date until the Renter gives notice."
      >
        <Select
          {...form.boxProps("type")}
          onChange={(event) => form.setValue("type", event.target.value)}
        >
          {RENTAL_TYPES.map((type) => (
            <option key={type} value={type}>
              {RENTAL_TYPE_LABELS[type]}
            </option>
          ))}
        </Select>
      </FormField>
      <div className="grid gap-6 sm:grid-cols-2">
        <FormField label="Starts" {...field("plannedStart")} hint="On your clock.">
          <DateTimePicker
            {...form.boxProps("plannedStart")}
            onValueChange={(value) => form.setValue("plannedStart", value)}
          />
        </FormField>
        {isFixedTerm ? (
          <FormField label="Ends" {...field("plannedEnd")} hint="When the car is due back.">
            <DateTimePicker
              {...form.boxProps("plannedEnd")}
              onValueChange={(value) => form.setValue("plannedEnd", value)}
            />
          </FormField>
        ) : null}
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        <FormField
          label="Daily rate"
          {...field("dailyRateCents")}
          hint="Including GST. One 24-hour block."
        >
          <MoneyInput
            {...form.boxProps("dailyRateCents")}
            onValueChange={(value) => form.setValue("dailyRateCents", value)}
          />
        </FormField>
        <FormField
          label="Long-term price per week"
          {...field("longTermWeeklyCents")}
          hint="Including GST. Empty: 7 days at the daily rate."
        >
          <MoneyInput
            {...form.boxProps("longTermWeeklyCents")}
            onValueChange={(value) => form.setValue("longTermWeeklyCents", value)}
          />
        </FormField>
      </div>
      <p className="text-muted-foreground text-sm" aria-live="polite">
        {rentKindText(form.values, props.timeZone, {
          minimumDays: props.longTermMinimumDays,
          graceMinutes: props.graceMinutes,
        })}
      </p>
      <FormField label="Bond" {...field("bondCents")} hint="Enter $0 if there is none.">
        <MoneyInput
          {...form.boxProps("bondCents")}
          onValueChange={(value) => form.setValue("bondCents", value)}
        />
      </FormField>
      <FormField label="Notes" {...field("notes")} hint="For you only. Not shown to the Renter.">
        <Textarea
          {...form.boxProps("notes")}
          onChange={(event) => form.setValue("notes", event.target.value)}
          maxLength={MAXIMUM_NOTE_LENGTH}
          rows={3}
        />
      </FormField>

      {shownState.status === "failed" ? (
        <div className="flex flex-col gap-2">
          <FormError message={shownState.formError} />
          {shownState.reasons.length > 0 ? (
            <ul className="text-destructive list-disc pl-5 text-sm">
              {shownState.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
          {shownState.link ? (
            <Link
              href={shownState.link.href}
              className="text-teal hover:text-primary text-sm font-semibold"
            >
              {shownState.link.label}
            </Link>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          name={INTENT_FIELD}
          value={BOOK_INTENT}
          disabled={isPending}
          className="w-full sm:w-auto"
        >
          {isPending ? "Saving…" : "Book"}
        </Button>
        <Button
          type="submit"
          name={INTENT_FIELD}
          value={DRAFT_INTENT}
          variant="outline"
          disabled={isPending}
          className="w-full sm:w-auto"
        >
          Save as draft
        </Button>
        <Button asChild variant="ghost" className="w-full sm:w-auto">
          <Link href={props.cancelHref}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
