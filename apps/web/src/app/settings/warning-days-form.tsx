"use client";

import { fieldErrorsOf } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { INITIAL_CHANGE_STATE } from "@fleetapp/ui/change-form-state";
import { fieldErrorId, FormField } from "@fleetapp/ui/form-field";
import { FormResult } from "@fleetapp/ui/form-result";
import { Input, RequiredFieldsNote } from "@fleetapp/ui/input";
import { useFormFields } from "@fleetapp/ui/use-form-fields";
import { useActionState } from "react";

import {
  WARNING_DAYS_FIELDS,
  warningDaysInputSchema,
  type WarningDaysSetting,
} from "../../lib/settings/warning-days-input";
import { saveWarningDaysAction } from "./warning-days-actions";

/** One "Due soon" setting: how many days before something expires its badge turns amber. */
export function WarningDaysForm(props: {
  setting: WarningDaysSetting;
  label: string;
  warningDays: number;
}) {
  const [state, formAction, isPending] = useActionState(
    saveWarningDaysAction.bind(null, props.setting),
    INITIAL_CHANGE_STATE,
  );
  const form = useFormFields({
    fields: WARNING_DAYS_FIELDS,
    initialValues: { days: String(props.warningDays) },
    validate: (values) => fieldErrorsOf(warningDaysInputSchema.safeParse(values)),
    isRequired: () => true,
  });
  const boxId = `${props.setting}-days`;

  return (
    <form
      action={formAction}
      onSubmit={form.submitHandler(formAction)}
      noValidate
      className="flex flex-col gap-4"
    >
      <RequiredFieldsNote />
      <FormField htmlFor={boxId} label={props.label} isRequired error={form.errorFor("days")}>
        <Input
          {...form.textBoxProps("days")}
          // Two of these forms share the Settings page, so each box needs its own id.
          id={boxId}
          aria-describedby={form.errorFor("days") ? fieldErrorId(boxId) : undefined}
          inputMode="numeric"
          className="sm:w-32"
        />
      </FormField>
      {form.isResultShown && !isPending ? <FormResult state={state} /> : null}
      <Button type="submit" variant="outline" disabled={isPending} className="sm:self-start">
        {isPending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
