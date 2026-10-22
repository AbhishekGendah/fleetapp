"use client";

import { Button } from "@fleetapp/ui/button";
import { useActionState } from "react";

import {
  reactivateOperatorAction,
  resendInviteAction,
  suspendOperatorAction,
  type ActionState,
} from "../actions";

const INITIAL_STATE: ActionState = {};

const SUSPEND_CONFIRMATION =
  "Suspend this Operator? Its Users will not be able to sign in and its Renter links will stop " +
  "working. Renter payments carry on.";

type ServerAction = (previous: ActionState, formData: FormData) => Promise<ActionState>;

interface ActionButtonProps {
  operatorId: string;
  action: ServerAction;
  label: string;
  pendingLabel: string;
  variant?: "default" | "outline" | "destructive";
  confirmation?: string;
}

function ActionButton(props: ActionButtonProps) {
  const [state, formAction, isPending] = useActionState(props.action, INITIAL_STATE);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    if (props.confirmation && !window.confirm(props.confirmation)) {
      event.preventDefault();
    }
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} className="flex flex-col gap-2">
      <input type="hidden" name="operatorId" value={props.operatorId} />
      <Button type="submit" variant={props.variant ?? "outline"} disabled={isPending}>
        {isPending ? props.pendingLabel : props.label}
      </Button>
      {state.formError ? (
        <p className="text-destructive text-sm" role="alert">
          {state.formError}
        </p>
      ) : null}
    </form>
  );
}

export interface OperatorActionsProps {
  operatorId: string;
  isSuspended: boolean;
  canResendInvite: boolean;
}

export function OperatorActions(props: OperatorActionsProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      {props.canResendInvite ? (
        <ActionButton
          operatorId={props.operatorId}
          action={resendInviteAction}
          label="Resend invite"
          pendingLabel="Sending…"
        />
      ) : null}
      {props.isSuspended ? (
        <ActionButton
          operatorId={props.operatorId}
          action={reactivateOperatorAction}
          label="Reactivate"
          pendingLabel="Reactivating…"
        />
      ) : (
        <ActionButton
          operatorId={props.operatorId}
          action={suspendOperatorAction}
          label="Suspend"
          pendingLabel="Suspending…"
          variant="destructive"
          confirmation={SUSPEND_CONFIRMATION}
        />
      )}
    </div>
  );
}
