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
  NUMBER_SETTING_FIELDS,
  numberSettingInputSchema,
  type NumberSetting,
} from "../../lib/settings/number-setting-input";
import { saveNumberSettingAction } from "./number-setting-actions";

/** One setting that is a number of days or months, e.g. how early "Due soon" shows. */
export function NumberSettingForm(props: {
  setting: NumberSetting;
  label: string;
  value: number;
  hint?: string;
}) {
  const [state, formAction, isPending] = useActionState(
    saveNumberSettingAction.bind(null, props.setting),
    INITIAL_CHANGE_STATE,
  );
  const form = useFormFields({
    fields: NUMBER_SETTING_FIELDS,
    initialValues: { amount: String(props.value) },
    validate: (values) => fieldErrorsOf(numberSettingInputSchema(props.setting).safeParse(values)),
    isRequired: () => true,
  });
  const boxId = `${props.setting}-amount`;

  return (
    <form
      action={formAction}
      onSubmit={form.submitHandler(formAction)}
      noValidate
      className="flex flex-col gap-4"
    >
      <RequiredFieldsNote />
      <FormField
        htmlFor={boxId}
        label={props.label}
        hint={props.hint}
        isRequired
        error={form.errorFor("amount")}
      >
        <Input
          {...form.textBoxProps("amount")}
          // Several of these forms share the Settings page, so each box needs its own id.
          id={boxId}
          aria-describedby={form.errorFor("amount") ? fieldErrorId(boxId) : undefined}
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
