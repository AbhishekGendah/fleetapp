"use client";

import { digitsOnly, fieldErrorsOf } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { INITIAL_CHANGE_STATE } from "@fleetapp/ui/change-form-state";
import { FormField } from "@fleetapp/ui/form-field";
import { FormResult } from "@fleetapp/ui/form-result";
import { Input } from "@fleetapp/ui/input";
import { useFormFields } from "@fleetapp/ui/use-form-fields";
import { useActionState } from "react";

import {
  NUMBER_SETTING_FIELDS,
  numberSettingDigits,
  numberSettingInputSchema,
  type NumberSetting,
} from "../../lib/settings/number-setting-input";
import { saveNumberSettingAction } from "./number-setting-actions";
import { CONFIRMED_AMOUNT_FIELD, type NumberSettingState } from "./number-setting-state";

/** One setting that is a number of days or months, e.g. how early "Due soon" shows. */
export function NumberSettingForm(props: {
  setting: NumberSetting;
  label: string;
  value: number;
  hint?: string;
}) {
  const [state, formAction, isPending] = useActionState<NumberSettingState, FormData>(
    saveNumberSettingAction.bind(null, props.setting),
    INITIAL_CHANGE_STATE,
  );
  const form = useFormFields({
    fields: NUMBER_SETTING_FIELDS,
    initialValues: { amount: String(props.value) },
    validate: (values) => fieldErrorsOf(numberSettingInputSchema(props.setting).safeParse(values)),
    isRequired: () => true,
    // Several of these forms share the Settings page, so each box needs its own id.
    idPrefix: `${props.setting}-`,
  });
  const digits = numberSettingDigits(props.setting);

  return (
    <form
      action={formAction}
      onSubmit={form.submitHandler(formAction)}
      noValidate
      className="flex flex-col gap-4"
    >
      <FormField
        htmlFor={form.idFor("amount")}
        label={props.label}
        hint={props.hint}
        isRequired
        error={form.errorFor("amount")}
      >
        <Input
          {...form.textBoxProps("amount")}
          // Digits only, stopping at the setting's length (rule 31).
          onChange={(event) =>
            form.setValue("amount", digitsOnly(event.target.value).slice(0, digits))
          }
          maxLength={digits}
          inputMode="numeric"
          className="sm:w-32"
        />
      </FormField>
      {!isPending && state.status === "confirm" && state.amount === form.values.amount ? (
        <>
          <p role="alert" className="text-attention text-sm font-medium">
            {state.message}
          </p>
          <input type="hidden" name={CONFIRMED_AMOUNT_FIELD} value={state.amount} />
        </>
      ) : null}
      {form.isResultShown && !isPending && state.status !== "confirm" ? (
        <FormResult state={state} />
      ) : null}
      <Button type="submit" variant="outline" disabled={isPending} className="sm:self-start">
        {isPending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
