"use client";

import { fieldErrorsOf, formatAbn } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { FormField } from "@fleetapp/ui/form-field";
import { FormError } from "@fleetapp/ui/form-message";
import { FormattedInput } from "@fleetapp/ui/formatted-input";
import { FormSection } from "@fleetapp/ui/form-section";
import { RequiredFieldsNote } from "@fleetapp/ui/input";
import { useFormFields } from "@fleetapp/ui/use-form-fields";
import Link from "next/link";
import { useActionState, type ReactNode } from "react";

import {
  isRequiredRenterField,
  parsePersonRenterForm,
  PERSON_RENTER_FORM_FIELDS,
  type PersonRenterFormField,
  type PersonRenterFormValues,
} from "../../lib/renters/renter-input";
import { RENTER_FIELD_LABELS } from "../../lib/renters/renter-labels";
import { RenterDetailsFields } from "./renter-details-fields";
import type { RenterFormState } from "./renter-form-state";

const INITIAL_STATE: RenterFormState = { status: "editing" };
/** Decision 8 of docs/plans/business-renters.md: most rideshare drivers have an ABN. */
const SOLE_TRADER_ABN_HINT =
  "If they rent as a sole trader. 11 digits, checked; printed on their invoices.";

interface RenterFormProps {
  initialValues: PersonRenterFormValues;
  /** The Operator's today, for the date-of-birth check. */
  today: string;
  action: (state: RenterFormState, formData: FormData) => Promise<RenterFormState>;
  submitLabel: string;
  cancelHref: string;
  /** Under the required-fields note, e.g. the Person or Business choice. */
  before?: ReactNode;
}

/**
 * Adding or editing a Renter. Only the name and a phone or email are needed
 * to save; the Renter's page then lists what is still needed before renting.
 */
export function RenterForm(props: RenterFormProps) {
  const [state, formAction, isPending] = useActionState(props.action, INITIAL_STATE);
  const form = useFormFields({
    fields: PERSON_RENTER_FORM_FIELDS,
    initialValues: props.initialValues,
    validate: (values) => fieldErrorsOf(parsePersonRenterForm(values, props.today)),
    isRequired: (field: PersonRenterFormField) => field !== "abn" && isRequiredRenterField(field),
  });
  const shownState = form.isResultShown && !isPending ? state : INITIAL_STATE;

  return (
    <form
      action={formAction}
      onSubmit={form.submitHandler(formAction)}
      noValidate
      className="flex flex-col gap-8"
    >
      <RequiredFieldsNote />
      {props.before}
      <RenterDetailsFields
        form={form}
        today={props.today}
        isRequired={isRequiredRenterField}
        title="The Renter"
        nameHints={{
          fullName: "As on their licence.",
          preferredName: "What they like to be called.",
        }}
      />
      <FormSection title="Sole trader">
        <FormField
          htmlFor="abn"
          label={RENTER_FIELD_LABELS.abn}
          hint={SOLE_TRADER_ABN_HINT}
          error={form.errorFor("abn")}
        >
          <FormattedInput
            {...form.formattedBoxProps("abn", formatAbn)}
            inputMode="numeric"
            autoComplete="off"
            placeholder="51 824 753 556"
          />
        </FormField>
      </FormSection>

      <RenterFormFooter
        state={shownState}
        isPending={isPending}
        submitLabel={props.submitLabel}
        cancelHref={props.cancelHref}
      />
    </form>
  );
}

/** A Renter form's last lines, person or business: what went wrong, then save and cancel. */
export function RenterFormFooter(props: {
  state: RenterFormState;
  isPending: boolean;
  submitLabel: string;
  cancelHref: string;
}) {
  return (
    <>
      {props.state.status === "failed" ? <FormError message={props.state.formError} /> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={props.isPending} className="w-full sm:w-auto">
          {props.isPending ? "Saving…" : props.submitLabel}
        </Button>
        <Button asChild variant="ghost" className="w-full sm:w-auto">
          <Link href={props.cancelHref}>Cancel</Link>
        </Button>
      </div>
    </>
  );
}
