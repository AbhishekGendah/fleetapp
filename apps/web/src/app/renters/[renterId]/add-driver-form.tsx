"use client";

import { fieldErrorsOf, formatAustralianPhone } from "@fleetapp/core";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";
import { ChoiceCards, type ChoiceCard } from "@fleetapp/ui/choice-cards";
import { FormField } from "@fleetapp/ui/form-field";
import { FormattedInput } from "@fleetapp/ui/formatted-input";
import { Input } from "@fleetapp/ui/input";
import { RecordPicker, type PickableRecord } from "@fleetapp/ui/record-picker";
import { UserPlus, UserRoundSearch } from "lucide-react";

import { ChangeFormShell, useChangeForm } from "../../../components/change-form-shell";
import {
  ADD_DRIVER_FIELDS,
  emptyAddDriverForm,
  isRequiredAddDriverField,
  parseAddDriverForm,
  type DriverSource,
} from "../../../lib/renters/driver-input";

const SOURCE_OPTIONS = [
  {
    value: "existing",
    label: "Someone already in your Renters",
    description: "Their licence is checked once, wherever they rent or drive",
    icon: <UserRoundSearch />,
  },
  {
    value: "new",
    label: "Someone new",
    description: "Just a name and a phone or email; they add the rest",
    icon: <UserPlus />,
  },
] as const satisfies readonly ChoiceCard<DriverSource>[];

/**
 * Adds a driver to a business (7 Nov 2026 mockups): pick one of the
 * Operator's person Renters, or add someone new, who then gets the details
 * link to add their own licence and photos. Checked as typed with the
 * server's own schema (rule 28).
 */
export function AddDriverForm(props: {
  businessName: string;
  candidates: readonly PickableRecord[];
  today: string;
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
}) {
  const initialSource: DriverSource = props.candidates.length > 0 ? "existing" : "new";
  const changeForm = useChangeForm({
    action: props.action,
    fields: ADD_DRIVER_FIELDS,
    initialValues: emptyAddDriverForm(initialSource),
    validate: (values) => fieldErrorsOf(parseAddDriverForm(values, props.today)),
    isRequired: isRequiredAddDriverField,
    shouldClearOnSave: true,
    idPrefix: "driver-",
  });
  const form = changeForm.fields;
  const isExisting = form.values.source === "existing";
  const submitLabel = isExisting ? "Add driver" : "Add and send details link";

  return (
    <ChangeFormShell form={changeForm} submitLabel={submitLabel}>
      <ChoiceCards
        id={form.idFor("source")}
        name="source"
        label="Who drives for it?"
        options={SOURCE_OPTIONS}
        value={isExisting ? "existing" : "new"}
        onValueChange={(source) => form.setValue("source", source)}
        isRequired
      />
      {isExisting ? (
        <FormField
          htmlFor={form.idFor("driverId")}
          label="Renter"
          isRequired
          hint="Type part of their name or phone. Do not rent and archived Renters can't be picked."
          error={form.errorFor("driverId")}
        >
          <RecordPicker
            {...form.boxProps("driverId")}
            records={props.candidates}
            onValueChange={(value) => form.setValue("driverId", value)}
            emptyMessage="No one matches. Add them as someone new."
          />
        </FormField>
      ) : (
        <>
          <FormField
            htmlFor={form.idFor("fullName")}
            label="Full name"
            isRequired
            hint="As on their licence."
            error={form.errorFor("fullName")}
          >
            <Input {...form.textBoxProps("fullName")} autoComplete="off" />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              htmlFor={form.idFor("email")}
              label="Email"
              hint="The details link and its codes go here."
              error={form.errorFor("email")}
            >
              <Input
                {...form.textBoxProps("email")}
                onChange={(event) => form.setValue("email", event.target.value.toLowerCase())}
                type="email"
                inputMode="email"
                autoCapitalize="none"
                autoComplete="off"
              />
            </FormField>
            <FormField
              htmlFor={form.idFor("phone")}
              label="Phone"
              hint="A phone number or an email, or both."
              error={form.errorFor("phone")}
            >
              <FormattedInput
                {...form.formattedBoxProps("phone", formatAustralianPhone)}
                type="tel"
                inputMode="tel"
                autoComplete="off"
              />
            </FormField>
          </div>
        </>
      )}
      <p className="text-muted-foreground text-sm">
        {isExisting
          ? `Once added, they can be named on ${props.businessName}'s cars, after their licence is checked.`
          : `They get the details link to add their own licence and photos. Once you approve what they send, they can be named on ${props.businessName}'s cars.`}
      </p>
    </ChangeFormShell>
  );
}
