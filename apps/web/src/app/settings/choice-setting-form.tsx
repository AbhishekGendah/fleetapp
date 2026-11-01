"use client";

import { fieldErrorsOf } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { INITIAL_CHANGE_STATE } from "@fleetapp/ui/change-form-state";
import { FormField } from "@fleetapp/ui/form-field";
import { FormResult } from "@fleetapp/ui/form-result";
import { Select } from "@fleetapp/ui/select";
import { useFormFields } from "@fleetapp/ui/use-form-fields";
import { useActionState } from "react";

import {
  CHOICE_SETTING_FIELDS,
  choiceSettingInputSchema,
  choiceSettingOptions,
  type ChoiceSetting,
} from "../../lib/settings/choice-setting-input";
import { saveChoiceSettingAction } from "./choice-setting-actions";

/** One setting that is one of a few choices, e.g. whether a provisional licence may rent. */
export function ChoiceSettingForm(props: {
  setting: ChoiceSetting;
  label: string;
  /** The option chosen now. */
  value: string;
  hint?: string;
}) {
  const [state, formAction, isPending] = useActionState(
    saveChoiceSettingAction.bind(null, props.setting),
    INITIAL_CHANGE_STATE,
  );
  const form = useFormFields({
    fields: CHOICE_SETTING_FIELDS,
    initialValues: { choice: props.value },
    validate: (values) => fieldErrorsOf(choiceSettingInputSchema(props.setting).safeParse(values)),
    isRequired: () => true,
    idPrefix: `${props.setting}-`,
  });

  return (
    <form
      action={formAction}
      onSubmit={form.submitHandler(formAction)}
      noValidate
      className="flex flex-col gap-4"
    >
      <FormField
        htmlFor={form.idFor("choice")}
        label={props.label}
        hint={props.hint}
        isRequired
        error={form.errorFor("choice")}
      >
        <Select
          {...form.boxProps("choice")}
          onChange={(event) => form.setValue("choice", event.target.value)}
          className="sm:max-w-md"
        >
          {choiceSettingOptions(props.setting).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </FormField>
      {form.isResultShown && !isPending ? <FormResult state={state} /> : null}
      <Button type="submit" variant="outline" disabled={isPending} className="sm:self-start">
        {isPending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
