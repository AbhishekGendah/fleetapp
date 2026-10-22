"use client";

import { Button } from "@fleetapp/ui/button";
import { Input, Label } from "@fleetapp/ui/input";
import { useActionState } from "react";

import { createOperatorAction, type ActionState } from "../actions";

const INITIAL_STATE: ActionState = {};

interface FieldProps {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  isRequired?: boolean;
  hint?: string;
  state: ActionState;
}

function Field(props: FieldProps) {
  const errorId = `${props.name}-error`;
  const errors = props.state.fieldErrors?.[props.name];
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={props.name}>{props.label}</Label>
      <Input
        id={props.name}
        name={props.name}
        type={props.type ?? "text"}
        autoComplete={props.autoComplete ?? "off"}
        required={props.isRequired}
        defaultValue={props.state.values?.[props.name]}
        aria-invalid={errors ? true : undefined}
        aria-describedby={errors ? errorId : undefined}
      />
      {props.hint ? <p className="text-muted-foreground text-xs">{props.hint}</p> : null}
      {errors ? (
        <p id={errorId} className="text-destructive text-sm">
          {errors.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

export function NewOperatorForm() {
  const [state, formAction, isPending] = useActionState(createOperatorAction, INITIAL_STATE);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4">
      <Field name="legalName" label="Legal business name" isRequired state={state} />
      <Field
        name="tradingName"
        label="Trading name (optional)"
        hint="Used in emails instead of the legal name, if given."
        state={state}
      />
      <Field name="userFullName" label="Their full name" isRequired state={state} />
      <Field name="userEmail" label="Their email address" type="email" isRequired state={state} />

      {state.formError ? (
        <p className="text-destructive text-sm" role="alert">
          {state.formError}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Creating…" : "Create and send invite"}
      </Button>
    </form>
  );
}
