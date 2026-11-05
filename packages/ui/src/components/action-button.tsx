"use client";

import { Button, type ButtonProps } from "./button";
import type * as React from "react";
import { lazy, Suspense, useActionState, useRef } from "react";

import { INITIAL_CHANGE_STATE, type ChangeFormState } from "./change-form-state";
import { FormResult } from "./form-result";

// Loaded only by buttons that ask first, so every other page stays inside its JavaScript budget.
const ConfirmButton = lazy(() =>
  import("./confirm-button").then((loaded) => ({ default: loaded.ConfirmButton })),
);

/** What to ask before a removal that is hard to undo (review A7-3, G8-7). */
export interface ActionConfirm {
  title: string;
  description: string;
  confirmLabel: string;
}

/**
 * A single button that does one thing (archive, withdraw), with its result
 * shown beside it. With `confirm`, it asks first (ConfirmButton) and only
 * then does it.
 */
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
  confirm?: ActionConfirm;
}) {
  const [state, formAction, isPending] = useActionState(props.action, INITIAL_CHANGE_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  if (props.confirm) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {/* The form sits apart from the question, so the pop-up's own form is never inside it. */}
        <form ref={formRef} action={formAction} hidden />
        <Suspense
          fallback={
            <Button
              type="button"
              variant={props.variant ?? "outline"}
              size={props.isIconOnly ? "icon" : props.size}
              disabled
              aria-label={props.isIconOnly ? props.label : undefined}
            >
              {props.icon}
              {props.isIconOnly ? null : props.label}
            </Button>
          }
        >
          <ConfirmButton
            label={isPending ? props.pendingLabel : props.label}
            icon={props.icon}
            isIconOnly={props.isIconOnly}
            variant={props.variant ?? "outline"}
            title={props.confirm.title}
            description={props.confirm.description}
            confirmLabel={props.confirm.confirmLabel}
            pendingLabel={props.pendingLabel}
            action={() => formRef.current?.requestSubmit()}
            className={props.isIconOnly ? undefined : "w-auto"}
          />
        </Suspense>
        <FormResult state={isPending ? INITIAL_CHANGE_STATE : state} />
      </div>
    );
  }
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
