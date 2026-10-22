"use client";

import { Button } from "@fleetapp/ui/button";
import { FormError } from "@fleetapp/ui/form-message";
import { Input, Label } from "@fleetapp/ui/input";
import { useActionState } from "react";

import { acceptInviteAction, type AcceptInviteState } from "./actions";

const INITIAL_STATE: AcceptInviteState = {};

function PasswordField(props: {
  name: "password" | "confirmation";
  label: string;
  errors?: string[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={props.name}>{props.label}</Label>
      <Input
        id={props.name}
        name={props.name}
        type="password"
        autoComplete="new-password"
        required
        aria-invalid={props.errors ? true : undefined}
      />
      {props.errors ? <FormError message={props.errors.join(" ")} /> : null}
    </div>
  );
}

export function AcceptInviteForm({ token, email }: { token: string; email: string }) {
  const [state, formAction, isPending] = useActionState(acceptInviteAction, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      {/* Lets a password manager save the new password against the right login. */}
      <input type="email" name="email" value={email} autoComplete="username" readOnly hidden />
      <PasswordField
        name="password"
        label="Choose a password (at least 12 characters)"
        errors={state.fieldErrors?.password}
      />
      <PasswordField
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
