"use client";

import { Badge } from "@fleetapp/ui/badge";
import { ChoiceCards, type ChoiceCard } from "@fleetapp/ui/choice-cards";
import Link from "next/link";

import { renterDriversPath } from "../../lib/paths";
import type { BusinessChoice, DriverChoice } from "../../lib/rentals/driver-choices";
import { DRIVER_TO_BE_NAMED } from "../../lib/rentals/rental-input";

const TO_BE_NAMED: ChoiceCard<string> = {
  value: DRIVER_TO_BE_NAMED,
  label: "Driver to be named",
  description: "Name one before the handover. The handover can't start until then.",
};

/** "Already has 1BRT482 out. You can still pick Sam.": a warning, never a refusal. */
function carsOutWarning(driver: DriverChoice): string | undefined {
  if (driver.carsOut.length === 0) {
    return undefined;
  }
  const firstName = driver.name.split(/\s+/)[0] ?? driver.name;
  return `Already has ${driver.carsOut.join(", ")} out. You can still pick ${firstName}.`;
}

/** One driver as a choice: their licence, standing, cars out, or why they can't be named yet. */
export function driverChoiceCard(driver: DriverChoice): ChoiceCard<string> {
  return {
    value: driver.driverId,
    label: driver.name,
    description: driver.unavailableReason ?? driver.licenceWords,
    badge: <Badge tone={driver.badge.tone}>{driver.badge.text}</Badge>,
    warning: driver.unavailableReason ? undefined : carsOutWarning(driver),
    isDisabled: driver.unavailableReason !== null,
  };
}

/**
 * Who drives a business's car (mockup 5, decision 2): one of its current
 * drivers, or "to be named" until the business says who. A driver with
 * another car out is warned about, never refused; one whose details wait for
 * review, or who is marked Do not rent, is shown but can't be picked.
 */
export function DriverPicker(props: {
  id: string;
  name: string;
  businessId: string;
  business: BusinessChoice;
  value: string;
  onValueChange: (value: string) => void;
  error?: string;
  /** Under the choices; on the New rental form, "The driver signs for the car at the handover." */
  hint?: string;
}) {
  const options = [TO_BE_NAMED, ...props.business.drivers.map(driverChoiceCard)];
  return (
    <div className="flex flex-col gap-2">
      <ChoiceCards
        id={props.id}
        name={props.name}
        label="Driver"
        options={options}
        value={props.value}
        onValueChange={props.onValueChange}
        hint={
          props.hint ??
          `${props.business.shownName}'s drivers. The driver signs for the car at the handover.`
        }
        error={props.error}
        layout="stack"
      />
      <Link
        href={renterDriversPath(props.businessId)}
        className="text-teal hover:text-primary flex min-h-11 items-center self-start text-sm font-bold"
      >
        + Add a driver to {props.business.shownName}
      </Link>
    </div>
  );
}
