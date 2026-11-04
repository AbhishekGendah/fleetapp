"use client";

import { fieldErrorsOf } from "@fleetapp/core";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";
import { DateTimePicker } from "@fleetapp/ui/date-time-picker";
import { FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";
import { MoneyInput } from "@fleetapp/ui/money-input";
import { Select } from "@fleetapp/ui/select";
import type { FormFields } from "@fleetapp/ui/use-form-fields";
import { useMemo } from "react";

import { ChangeFormShell, useChangeForm } from "../../../components/change-form-shell";
import {
  emptyRateChangeForm,
  END_CHANGE_FIELDS,
  endChangeFormSchema,
  ONGOING_CHANGE_FIELDS,
  ongoingChangeFormSchema,
  RATE_CHANGE_FIELDS,
  rateChangeFormSchema,
} from "../../../lib/rentals/change-input";

type ChangeAction = (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;

const REASON_HINT = "Kept with the change, and shown on the form the Renter signs.";

/** Why the change is made: every change form asks. */
function ReasonField({ fields }: { fields: FormFields<"reason"> }) {
  return (
    <FormField
      htmlFor={fields.idFor("reason")}
      label="Reason"
      isRequired
      hint={REASON_HINT}
      error={fields.errorFor("reason")}
    >
      <Input {...fields.textBoxProps("reason")} placeholder="e.g. Agreed with the Renter" />
    </FormField>
  );
}

const alwaysRequired = (): boolean => true;

/** A new end for the rental: later, earlier, or one for an ongoing rental. */
export function EndChangeForm(props: {
  action: ChangeAction;
  timeZone: string;
  initialEnd: string;
  /** "At least 7 days' notice" for an ongoing rental being given an end. */
  noticeHint?: string;
}) {
  const schema = useMemo(() => endChangeFormSchema(props.timeZone), [props.timeZone]);
  const form = useChangeForm({
    action: props.action,
    fields: END_CHANGE_FIELDS,
    initialValues: { newEnd: props.initialEnd, reason: "" },
    validate: (values) => fieldErrorsOf(schema.safeParse(values)),
    isRequired: alwaysRequired,
  });
  const { fields } = form;
  return (
    <ChangeFormShell form={form} submitLabel="Save new end">
      <FormField
        htmlFor={fields.idFor("newEnd")}
        label="New end"
        isRequired
        hint={props.noticeHint}
        error={fields.errorFor("newEnd")}
      >
        <DateTimePicker
          {...fields.boxProps("newEnd")}
          onValueChange={(value) => fields.setValue("newEnd", value)}
        />
      </FormField>
      <ReasonField fields={fields} />
    </ChangeFormShell>
  );
}

/** The end taken away: the rental runs until notice is given. */
export function OngoingChangeForm({ action }: { action: ChangeAction }) {
  const form = useChangeForm({
    action,
    fields: ONGOING_CHANGE_FIELDS,
    initialValues: { reason: "" },
    validate: (values) => fieldErrorsOf(ongoingChangeFormSchema.safeParse(values)),
    isRequired: alwaysRequired,
  });
  return (
    <ChangeFormShell form={form} submitLabel="Make it ongoing">
      <ReasonField fields={form.fields} />
    </ChangeFormShell>
  );
}

/** A rent week a new rate can start with, worded on the business's clock. */
export interface WeekStartOption {
  block: number;
  label: string;
}

/** A new weekly rate from a rent week's start, sent to the Renter to sign. */
export function RateChangeForm(props: {
  action: ChangeAction;
  weekStarts: readonly WeekStartOption[];
}) {
  const schema = useMemo(
    () => rateChangeFormSchema(props.weekStarts.map((option) => option.block)),
    [props.weekStarts],
  );
  const form = useChangeForm({
    action: props.action,
    fields: RATE_CHANGE_FIELDS,
    initialValues: emptyRateChangeForm(props.weekStarts[0]?.block),
    validate: (values) => fieldErrorsOf(schema.safeParse(values)),
    isRequired: alwaysRequired,
  });
  const { fields } = form;
  return (
    <ChangeFormShell form={form} submitLabel="Send to sign">
      <div className="grid grid-cols-2 gap-4">
        <FormField
          htmlFor={fields.idFor("weeklyRateCents")}
          label="New weekly rate"
          isRequired
          error={fields.errorFor("weeklyRateCents")}
        >
          <MoneyInput
            {...fields.boxProps("weeklyRateCents")}
            onValueChange={(value) => fields.setValue("weeklyRateCents", value)}
          />
        </FormField>
        <FormField
          htmlFor={fields.idFor("fromBlock")}
          label="Starts with the rent week from"
          isRequired
          error={fields.errorFor("fromBlock")}
          hint="The Renter must sign before then."
        >
          <Select
            {...fields.boxProps("fromBlock")}
            onChange={(event) => fields.setValue("fromBlock", event.target.value)}
          >
            {props.weekStarts.map((option) => (
              <option key={option.block} value={String(option.block)}>
                {option.label}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <ReasonField fields={fields} />
    </ChangeFormShell>
  );
}
