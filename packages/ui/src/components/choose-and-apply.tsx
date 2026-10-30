"use client";

import { Button } from "./button";
import { FormField } from "./form-field";
import { Select } from "./select";
import { useActionState, useId } from "react";

import { INITIAL_CHANGE_STATE, type ChangeFormState } from "./change-form-state";
import { FormResult } from "./form-result";

export const CHOSEN_FIELD = "chosen";

/** Pick one thing from a list and apply it: put a car on a policy, a policy on a car. */
export function ChooseAndApply(props: {
  label: string;
  options: readonly { value: string; label: string }[];
  buttonLabel: string;
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
}) {
  const id = useId();
  const [state, formAction, isPending] = useActionState(props.action, INITIAL_CHANGE_STATE);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <FormField htmlFor={id} label={props.label}>
        <Select id={id} name={CHOSEN_FIELD} defaultValue={props.options[0]?.value}>
          {props.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </FormField>
      <FormResult state={isPending ? INITIAL_CHANGE_STATE : state} />
      <Button type="submit" variant="outline" disabled={isPending} className="sm:self-start">
        {props.buttonLabel}
      </Button>
    </form>
  );
}
