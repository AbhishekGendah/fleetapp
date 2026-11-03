"use client";

import type { CheckoutPurpose } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { FormError } from "@fleetapp/ui/form-message";
import { ArrowRight } from "lucide-react";
import { useActionState, useMemo } from "react";

import { startCheckoutAction, type CheckoutState } from "./checkout-actions";

const INITIAL_STATE: CheckoutState = { status: "idle" };

/** Goes to Stripe's own page for one step: the direct debit, or the bond. */
export function CheckoutButton(props: {
  token: string;
  purpose: CheckoutPurpose;
  label: string;
  variant?: "default" | "outline";
}) {
  const start = useMemo(
    () => startCheckoutAction.bind(null, props.token, props.purpose),
    [props.token, props.purpose],
  );
  const [state, formAction, isPending] = useActionState(start, INITIAL_STATE);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Button
        type="submit"
        variant={props.variant ?? "default"}
        disabled={isPending}
        className="w-full"
      >
        <ArrowRight aria-hidden />
        {isPending ? "Opening Stripe…" : props.label}
      </Button>
      {state.status === "problem" ? <FormError message={state.message} /> : null}
    </form>
  );
}
