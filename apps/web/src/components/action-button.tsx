"use client";

import { Button, type ButtonProps } from "@fleetapp/ui/button";
import { useActionState } from "react";

import { INITIAL_CHANGE_STATE, type ChangeFormState } from "./change-form-state";
import { FormResult } from "./form-result";

/** A single button that does one thing (archive, withdraw), with its result shown beside it. */
export function ActionButton(props: {
  action: (state: ChangeFormState) => Promise<ChangeFormState>;
  label: string;
  pendingLabel: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const [state, formAction, isPending] = useActionState(props.action, INITIAL_CHANGE_STATE);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <Button
        type="submit"
        variant={props.variant ?? "outline"}
        size={props.size}
        disabled={isPending}
      >
        {isPending ? props.pendingLabel : props.label}
      </Button>
      <FormResult state={isPending ? INITIAL_CHANGE_STATE : state} />
    </form>
  );
}
