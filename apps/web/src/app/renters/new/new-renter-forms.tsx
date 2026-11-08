"use client";

import type { RenterKind } from "@fleetapp/core";
import { ChoiceCards, type ChoiceCard } from "@fleetapp/ui/choice-cards";
import { Building, UserRound } from "lucide-react";
import { useState } from "react";

import { emptyBusinessRenterForm } from "../../../lib/renters/business-renter-input";
import { emptyRenterForm } from "../../../lib/renters/renter-input";
import { addBusinessRenterAction, addRenterAction } from "../actions";
import { BusinessRenterForm } from "../business-renter-form";
import { RenterForm } from "../renter-form";

const KIND_OPTIONS = [
  {
    value: "person",
    label: "Person",
    description: "Rents a car for themselves, sole traders too",
    icon: <UserRound />,
  },
  {
    value: "organisation",
    label: "Business",
    description: "A company, partnership or trust, renting cars for its drivers",
    icon: <Building />,
  },
] as const satisfies readonly ChoiceCard<RenterKind>[];

/**
 * Adding a Renter: Person or Business first (fixed once added: the app can't
 * change it), then that kind's own form (7 Nov 2026 mockups).
 */
export function NewRenterForms(props: {
  initialKind: RenterKind;
  today: string;
  cancelHref: string;
}) {
  const [kind, setKind] = useState<RenterKind>(props.initialKind);
  const kindChoice = (
    <ChoiceCards
      id="kind"
      name="kind"
      label="Person or business?"
      options={KIND_OPTIONS}
      value={kind}
      onValueChange={setKind}
      isRequired
      hint="This can't be changed later."
    />
  );
  return kind === "organisation" ? (
    <BusinessRenterForm
      initialValues={emptyBusinessRenterForm()}
      action={addBusinessRenterAction}
      submitLabel="Add business"
      cancelHref={props.cancelHref}
      before={kindChoice}
      after={
        <p className="text-muted-foreground text-sm">
          Next you add its drivers. Each driver gets the details link to add their own licence and
          photos; the business never sees them.
        </p>
      }
    />
  ) : (
    <RenterForm
      initialValues={emptyRenterForm()}
      today={props.today}
      action={addRenterAction}
      submitLabel="Add Renter"
      cancelHref={props.cancelHref}
      before={kindChoice}
    />
  );
}
