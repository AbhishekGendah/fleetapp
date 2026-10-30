"use client";

import { Button, type ButtonProps } from "./button";
import type * as React from "react";
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
  /** Before the label, e.g. a bin for Remove. */
  icon?: React.ReactNode;
  /** Only the icon shows, in a square button; the label is still read out. Needs `icon`. */
  isIconOnly?: boolean;
}) {
  const [state, formAction, isPending] = useActionState(props.action, INITIAL_CHANGE_STATE);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <Button
        type="submit"
        variant={props.variant ?? "outline"}
        size={props.isIconOnly ? "icon" : props.size}
        disabled={isPending}
        aria-label={props.isIconOnly ? (isPending ? props.pendingLabel : props.label) : undefined}
      >
        {props.icon}
        {props.isIconOnly ? null : isPending ? props.pendingLabel : props.label}
      </Button>
      <FormResult state={isPending ? INITIAL_CHANGE_STATE : state} />
    </form>
  );
}
