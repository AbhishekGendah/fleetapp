"use client";

import { Button, type ButtonProps } from "@fleetapp/ui/button";
import { useActionState } from "react";

import { CAR_PAGE_INITIAL_STATE, type CarPageFormState } from "./car-page-state";
import { FormResult } from "./form-result";

/** A single button that does one thing (archive, withdraw), with its result shown beside it. */
export function ActionButton(props: {
  action: (state: CarPageFormState) => Promise<CarPageFormState>;
  label: string;
  pendingLabel: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const [state, formAction, isPending] = useActionState(props.action, CAR_PAGE_INITIAL_STATE);
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
      <FormResult state={isPending ? CAR_PAGE_INITIAL_STATE : state} />
    </form>
  );
}
