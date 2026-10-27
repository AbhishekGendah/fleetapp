"use client";

import { Button } from "@fleetapp/ui/button";
import { FormError } from "@fleetapp/ui/form-message";
import { useActionState } from "react";

import { NewPasswordField } from "../../new-password-field";
import { acceptInviteAction, type AcceptInviteState } from "./actions";

const INITIAL_STATE: AcceptInviteState = {};

export function AcceptInviteForm({ token, email }: { token: string; email: string }) {
  const [state, formAction, isPending] = useActionState(acceptInviteAction, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      {/* Lets a password manager save the new password against the right login. */}
      <input type="email" name="email" value={email} autoComplete="username" readOnly hidden />
      <NewPasswordField
        name="password"
        label="Choose a password (at least 12 characters)"
        errors={state.fieldErrors?.password}
      />
      <NewPasswordField
        name="confirmation"
        label="Type it again"
        errors={state.fieldErrors?.confirmation}
      />
      <FormError message={state.formError ?? null} />
      <Button type="submit" disabled={isPending}>
        {isPending ? "Setting up…" : "Continue"}
      </Button>
    </form>
  );
}
