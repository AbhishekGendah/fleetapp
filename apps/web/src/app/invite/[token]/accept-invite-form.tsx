"use client";

import { Button } from "@fleetapp/ui/button";
import { FormError } from "@fleetapp/ui/form-message";
import { RequiredFieldsNote } from "@fleetapp/ui/input";
import { startTransition, useActionState, useState } from "react";

import {
  NEW_PASSWORD_HINT,
  NewPasswordField,
  submitLabel,
  useNewPasswordChecks,
} from "../../new-password-field";
import { acceptInviteAction, type AcceptInviteState } from "./actions";

const INITIAL_STATE: AcceptInviteState = {};

export function AcceptInviteForm(props: { token: string; email: string }) {
  const [state, formAction, isPending] = useActionState(acceptInviteAction, INITIAL_STATE);
  const { fieldProps, isReadyToSend, isLeakWarningShown } = useNewPasswordChecks();
  const [isChecking, setIsChecking] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setIsChecking(true);
    const isReady = await isReadyToSend();
    setIsChecking(false);
    if (isReady) {
      startTransition(() => formAction(formData));
    }
  }

  /** The live check first; the server's answer only if it disagrees. */
  function errorFor(name: "password" | "confirmation"): string | undefined {
    return fieldProps(name).error ?? state.fieldErrors?.[name]?.[0];
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
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
        {...fieldProps("password")}
        error={errorFor("password")}
        label={`Choose a password (${NEW_PASSWORD_HINT})`}
      />
      <NewPasswordField
        {...fieldProps("confirmation")}
        error={errorFor("confirmation")}
        label="Type it again"
      />
      <FormError message={state.formError ?? null} />
      <Button type="submit" disabled={isPending || isChecking}>
        {isPending || isChecking ? "Setting up…" : submitLabel(isLeakWarningShown, "Continue")}
      </Button>
    </form>
  );
}
