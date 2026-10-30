"use client";

import {
  fieldErrorsOf,
  INSURANCE_COVER_TYPE_LABELS,
  INSURANCE_COVER_TYPES,
  INSURANCE_PAYMENT_FREQUENCIES,
  INSURANCE_PAYMENT_FREQUENCY_LABELS,
} from "@fleetapp/core";
import { Checkbox } from "@fleetapp/ui/checkbox";
import { FormField } from "@fleetapp/ui/form-field";
import { FormSection } from "@fleetapp/ui/form-section";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";
import { Input } from "@fleetapp/ui/input";
import { MoneyInput } from "@fleetapp/ui/money-input";
import { Select } from "@fleetapp/ui/select";

import {
  isRequiredPaperworkField,
  parsePolicyForm,
  POLICY_FORM_FIELDS,
  type PolicyFormValues,
} from "../../lib/vehicles/paperwork-input";
import type { CoveredCar } from "../../lib/vehicles/paperwork-queries";
import { AmountWithGst } from "./amount-with-gst";
import { ChangeFormShell, useChangeForm } from "../../components/change-form-shell";

export const POLICY_CARS_FIELD = "vehicleIds";

interface PolicyFormProps {
  initialValues: PolicyFormValues;
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
  submitLabel: string;
  /** On the new-policy page: the cars to choose from for a fleet policy. */
  carChoices?: readonly CoveredCar[];
  isGstRegistered: boolean;
  /** Adding a policy from a car's page: empty the form once saved. */
  shouldClearOnSave?: boolean;
}

/** Adding or editing an insurance policy. */
export function PolicyForm(props: PolicyFormProps) {
  const changeForm = useChangeForm({
    action: props.action,
    fields: POLICY_FORM_FIELDS,
    initialValues: props.initialValues,
    validate: (values) => fieldErrorsOf(parsePolicyForm(values)),
    isRequired: isRequiredPaperworkField,
    shouldClearOnSave: props.shouldClearOnSave,
  });
  const form = changeForm.fields;

  return (
    <ChangeFormShell form={changeForm} submitLabel={props.submitLabel}>
      <FormSection title="The policy">
        <FormField htmlFor="insurer" label="Insurer" isRequired error={form.errorFor("insurer")}>
          <Input {...form.textBoxProps("insurer")} />
        </FormField>
        <FormField
          htmlFor="policyNumber"
          label="Policy number"
          isRequired
          error={form.errorFor("policyNumber")}
        >
          <Input
            {...form.textBoxProps("policyNumber")}
            onChange={(event) => form.setValue("policyNumber", event.target.value.toUpperCase())}
            autoCapitalize="characters"
          />
        </FormField>
        <FormField htmlFor="coverType" label="Cover" isRequired error={form.errorFor("coverType")}>
          <Select
            {...form.boxProps("coverType")}
            onChange={(event) => form.setValue("coverType", event.target.value)}
          >
            <option value="">Choose…</option>
            {INSURANCE_COVER_TYPES.map((type) => (
              <option key={type} value={type}>
                {INSURANCE_COVER_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField htmlFor="startsOn" label="Starts" isRequired error={form.errorFor("startsOn")}>
            <Input {...form.textBoxProps("startsOn")} type="date" />
          </FormField>
          <FormField htmlFor="endsOn" label="Ends" isRequired error={form.errorFor("endsOn")}>
            <Input {...form.textBoxProps("endsOn")} type="date" />
          </FormField>
        </div>
        <FormField
          htmlFor="excessCents"
          label="Excess"
          hint="What the Renter may be charged after damage."
          error={form.errorFor("excessCents")}
        >
          <MoneyInput
            {...form.boxProps("excessCents")}
            onValueChange={(value) => form.setValue("excessCents", value)}
          />
        </FormField>
        <FormField
          htmlFor="paymentFrequency"
          label="Paid"
          isRequired
          hint="Most policies are paid yearly; some monthly or fortnightly."
          error={form.errorFor("paymentFrequency")}
        >
          <Select
            {...form.boxProps("paymentFrequency")}
            onChange={(event) => form.setValue("paymentFrequency", event.target.value)}
          >
            {INSURANCE_PAYMENT_FREQUENCIES.map((frequency) => (
              <option key={frequency} value={frequency}>
                {INSURANCE_PAYMENT_FREQUENCY_LABELS[frequency]}
              </option>
            ))}
          </Select>
        </FormField>
        <AmountWithGst
          form={form}
          amountField="costCents"
          gstField="gstCents"
          amountLabel={
            form.values.paymentFrequency === "yearly" ? "Premium" : "Premium (each payment)"
          }
          gstSource="tenth_of_amount"
          isGstRegistered={props.isGstRegistered}
        />
      </FormSection>
      {props.carChoices ? (
        <FormSection title="Cars it covers">
          {props.carChoices.length === 0 ? (
            <p className="text-muted-foreground text-sm">No cars yet. Add cars first.</p>
          ) : (
            props.carChoices.map((car) => (
              <Checkbox
                key={car.id}
                name={POLICY_CARS_FIELD}
                value={car.id}
                label={`${car.rego} (${car.regoState}) · ${car.make} ${car.model}`}
              />
            ))
          )}
        </FormSection>
      ) : null}
    </ChangeFormShell>
  );
}
