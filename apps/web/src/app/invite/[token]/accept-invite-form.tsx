"use client";

import { Button } from "@fleetapp/ui/button";
import { FormError } from "@fleetapp/ui/form-message";
import { RequiredFieldsNote } from "@fleetapp/ui/input";
import { startTransition, useActionState, useState } from "react";

import {
  NEW_PASSWORD_HINT,
  NewPasswordField,
  submitLabel,
  useNewPasswordForm,
} from "../../new-password-field";
import { acceptInviteAction, type AcceptInviteState } from "./actions";

const INITIAL_STATE: AcceptInviteState = {};

export function AcceptInviteForm(props: { token: string; email: string }) {
  const [state, formAction, isPending] = useActionState(acceptInviteAction, INITIAL_STATE);
  const { form, isLeakWarningShown, afterLeakCheck } = useNewPasswordForm();
  const [isChecking, setIsChecking] = useState(false);

  // After the leak check's await, the action must be started in a transition of its own.
  const send = afterLeakCheck(async (formData) => {
    startTransition(() => formAction(formData));
  });

  return (
    <form
      action={formAction}
      onSubmit={form.submitHandler(async (formData) => {
        setIsChecking(true);
        await send(formData).finally(() => setIsChecking(false));
      })}
      noValidate
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="token" value={props.token} />
      {/* Lets a password manager save the new password against the right login.
          Never shown, so it is not a form box the shared pieces cover. */}
      {/* eslint-disable-next-line no-restricted-syntax -- an invisible hint for password managers */}
      <input
        type="email"
        name="email"
        value={props.email}
        autoComplete="username"
        readOnly
        hidden
      />
      <RequiredFieldsNote />
      <NewPasswordField
        form={form}
        name="password"
        label={`Choose a password (${NEW_PASSWORD_HINT})`}
        isLeakWarningShown={isLeakWarningShown}
        serverError={state.fieldErrors?.password?.[0]}
      />
      <NewPasswordField
        form={form}
        name="confirmation"
        label="Type it again"
        serverError={state.fieldErrors?.confirmation?.[0]}
      />
      <FormError message={state.formError ?? null} />
      <Button type="submit" disabled={isPending || isChecking}>
        {isPending || isChecking ? "Setting up…" : submitLabel(isLeakWarningShown, "Continue")}
      </Button>
    </form>
  );
}
