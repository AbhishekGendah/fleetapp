"use client";

import {
  fieldErrorsOf,
  MAXIMUM_NOTE_LENGTH,
  RENTAL_TYPE_LABELS,
  RENTAL_TYPES,
  WEEKDAY_LABELS,
  WEEKDAYS,
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

import {
  AUTOMATIC_CHARGE_DAY,
  isRequiredRentalField,
  parseRentalForm,
  RENTAL_FORM_FIELDS,
  type RentalFormValues,
} from "../../lib/rentals/rental-input";
import { BOOK_INTENT, DRAFT_INTENT, INTENT_FIELD, type RentalFormState } from "./rental-form-state";

const INITIAL_STATE: RentalFormState = { status: "editing" };

interface RentalFormProps {
  initialValues: RentalFormValues;
  renters: readonly PickableRecord[];
  cars: readonly PickableRecord[];
  timeZone: string;
  /** "Tuesday" when the business charges everyone on one day; null for each start's weekday. */
  fixedChargeDayLabel: string | null;
  action: (state: RentalFormState, formData: FormData) => Promise<RentalFormState>;
  cancelHref: string;
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
        hint="Renters marked Do not rent are not listed."
      >
        <RecordPicker
          {...form.boxProps("renterId")}
          records={props.renters}
          onValueChange={(value) => form.setValue("renterId", value)}
          placeholder="Type a name, phone or email"
          emptyMessage="No Renter matches that. Add them on the Renters page first."
        />
      </FormField>
      <FormField
        label="Car"
        {...field("vehicleId")}
        hint="Sold and written-off cars are not listed."
      >
        <RecordPicker
          {...form.boxProps("vehicleId")}
          records={props.cars}
          onValueChange={(value) => form.setValue("vehicleId", value)}
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
        <FormField label="Weekly rate" {...field("weeklyRateCents")} hint="Including GST.">
          <MoneyInput
            {...form.boxProps("weeklyRateCents")}
            onValueChange={(value) => form.setValue("weeklyRateCents", value)}
          />
        </FormField>
        <FormField label="Bond" {...field("bondCents")} hint="Enter $0 if there is none.">
          <MoneyInput
            {...form.boxProps("bondCents")}
            onValueChange={(value) => form.setValue("bondCents", value)}
          />
        </FormField>
      </div>
      <FormField
        label="Rent is charged each"
        {...field("chargeWeekday")}
        hint="Rent is charged weekly in advance."
      >
        <Select
          {...form.boxProps("chargeWeekday")}
          onChange={(event) => form.setValue("chargeWeekday", event.target.value)}
        >
          <option value={AUTOMATIC_CHARGE_DAY}>
            {props.fixedChargeDayLabel
              ? `${props.fixedChargeDayLabel} (your usual day)`
              : "Weekday the rental starts on"}
          </option>
          {WEEKDAYS.map((day) => (
            <option key={day} value={String(day)}>
              {WEEKDAY_LABELS[day]}
            </option>
          ))}
        </Select>
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
            <Link href={shownState.link.href} className="text-teal text-sm underline">
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
