"use client";

import { fieldErrorsOf } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { FormError } from "@fleetapp/ui/form-message";
import { RequiredFieldsNote } from "@fleetapp/ui/input";
import { useFormFields } from "@fleetapp/ui/use-form-fields";
import Link from "next/link";
import { useActionState, type ReactNode } from "react";

import {
  isRequiredRenterField,
  parseRenterForm,
  RENTER_FORM_FIELDS,
  type RenterFormValues,
} from "../../lib/renters/renter-input";
import { RenterDetailsFields } from "./renter-details-fields";
import type { RenterFormState } from "./renter-form-state";

const INITIAL_STATE: RenterFormState = { status: "editing" };

interface RenterFormProps {
  initialValues: RenterFormValues;
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
    fields: RENTER_FORM_FIELDS,
    initialValues: props.initialValues,
    validate: (values) => fieldErrorsOf(parseRenterForm(values, props.today)),
    isRequired: isRequiredRenterField,
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
