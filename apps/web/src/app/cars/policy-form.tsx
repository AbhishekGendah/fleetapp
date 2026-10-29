"use client";

import { fieldErrorsOf, INSURANCE_COVER_TYPE_LABELS, INSURANCE_COVER_TYPES } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { Checkbox } from "@fleetapp/ui/checkbox";
import { FormField } from "@fleetapp/ui/form-field";
import { FormSection } from "@fleetapp/ui/form-section";
import { Input, RequiredFieldsNote } from "@fleetapp/ui/input";
import { Select } from "@fleetapp/ui/select";
import { useFormFields } from "@fleetapp/ui/use-form-fields";
import { useActionState } from "react";

import { INITIAL_CHANGE_STATE, type ChangeFormState } from "../../components/change-form-state";
import { FormResult } from "../../components/form-result";
import {
  isRequiredPaperworkField,
  parsePolicyForm,
  POLICY_FORM_FIELDS,
  type PolicyFormValues,
} from "../../lib/vehicles/paperwork-input";
import type { CoveredCar } from "../../lib/vehicles/paperwork-queries";
import { AmountWithGst } from "./amount-with-gst";

export const POLICY_CARS_FIELD = "vehicleIds";

interface PolicyFormProps {
  initialValues: PolicyFormValues;
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
  submitLabel: string;
  /** On the new-policy page: the cars to choose from for a fleet policy. */
  carChoices?: readonly CoveredCar[];
}

/** Adding or editing an insurance policy. */
export function PolicyForm(props: PolicyFormProps) {
  const [state, formAction, isPending] = useActionState(props.action, INITIAL_CHANGE_STATE);
  const form = useFormFields({
    fields: POLICY_FORM_FIELDS,
    initialValues: props.initialValues,
    validate: (values) => fieldErrorsOf(parsePolicyForm(values)),
    isRequired: isRequiredPaperworkField,
  });

  return (
    <form
      action={formAction}
      onSubmit={form.submitHandler(formAction)}
      noValidate
      className="flex flex-col gap-6"
    >
      <RequiredFieldsNote />
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
          <Input {...form.textBoxProps("policyNumber")} />
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
          <Input {...form.textBoxProps("excessCents")} inputMode="decimal" placeholder="$0.00" />
        </FormField>
        <AmountWithGst
          form={form}
          amountField="costCents"
          gstField="gstCents"
          amountLabel="Premium"
          isGstUsuallyIncluded
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
      {form.isResultShown && !isPending ? <FormResult state={state} /> : null}
      <Button type="submit" disabled={isPending} className="sm:self-start">
        {isPending ? "Saving…" : props.submitLabel}
      </Button>
    </form>
  );
}
