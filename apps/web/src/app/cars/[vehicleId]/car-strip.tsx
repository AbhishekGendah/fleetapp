import { BODY_TYPE_LABELS, TRANSMISSION_LABELS, todayInTimeZone } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { FormDialog } from "@fleetapp/ui/form-dialog";
import { RecordStrip } from "@fleetapp/ui/record-strip";
import { Pencil, Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { CARS_PATH, editCarPath, newRentalPath } from "../../../lib/paths";
import type { RentalClock } from "../../../lib/rentals/rental-records";
import {
  insuranceFact,
  odometerFact,
  priceFact,
  regoFact,
} from "../../../lib/vehicles/car-page-facts";
import type { VehicleDetail } from "../../../lib/vehicles/vehicle-queries";
import { CarNowWords } from "../car-now-words";
import { VehicleStatusBadge } from "../vehicle-status-badge";
import type { CarPageData } from "./car-page-data";
import { recordFoundDamageAction } from "./damage-actions";
import { FoundDamageForm } from "./found-damage-form";

/** "2022 Toyota Corolla Ascent Sport · white · hatch, automatic". */
function subtitleOf(vehicle: VehicleDetail): string {
  const name = [vehicle.year, vehicle.make, vehicle.model, vehicle.variant]
    .filter(Boolean)
    .join(" ");
  const build = [
    vehicle.bodyType ? BODY_TYPE_LABELS[vehicle.bodyType].toLowerCase() : null,
    vehicle.transmission ? TRANSMISSION_LABELS[vehicle.transmission].toLowerCase() : null,
  ]
    .filter(Boolean)
    .join(", ");
  return [name, vehicle.colour?.toLowerCase(), build || null].filter(Boolean).join(" · ");
}

/** The latest reading that counts: verified and not withdrawn. Readings are newest first. */
function latestReading(vehicle: VehicleDetail) {
  return vehicle.readings.find((reading) => reading.isVerified && !reading.withdrawnAt) ?? null;
}

/**
 * The navy strip at the top of one car's page (the navy strip rule): the
 * rego and its state, the car, its status and what it is doing now (the
 * Renter's name opens them), the key facts, and Edit, Record damage and New
 * rental for this car.
 */
export function CarStrip(props: { vehicle: VehicleDetail; data: CarPageData; clock: RentalClock }) {
  const { vehicle, data, clock } = props;
  const today = todayInTimeZone(clock.now, clock.timeZone);
  const isArchived = vehicle.archivedAt !== null;
  const reading = latestReading(vehicle);
  return (
    <RecordStrip
      backHref={CARS_PATH}
      backLabel="Cars"
      title={
        <>
          {vehicle.rego}{" "}
          <span className="text-on-primary-label text-lg font-bold md:text-xl">
            {vehicle.regoState}
          </span>
        </>
      }
      subtitle={subtitleOf(vehicle)}
      badges={
        <>
          <VehicleStatusBadge status={vehicle.status} isArchived={isArchived} />
          <span className="text-on-primary-muted text-sm md:text-base">
            <CarNowWords now={data.now} isOnStrip />
          </span>
        </>
      }
      facts={[
        odometerFact(reading, clock),
        regoFact(
          {
            isOnDirectDebit: data.summary.isRegoOnDirectDebit,
            expiresOn: data.summary.regoExpiresOn,
            status: data.summary.regoStatus,
            state: vehicle.regoState,
          },
          today,
        ),
        insuranceFact(
          {
            endsOn: data.summary.insuranceEndsOn,
            status: data.summary.insuranceStatus,
            insurer: data.latestPolicy?.insurer ?? null,
          },
          today,
        ),
        priceFact(vehicle),
      ]}
      actions={
        isArchived ? undefined : (
          <>
            <Button asChild variant="inverse-outline">
              <Link href={editCarPath(vehicle.id)}>
                <Pencil aria-hidden />
                Edit
              </Link>
            </Button>
            <FormDialog
              triggerLabel="Record damage"
              triggerIcon={<TriangleAlert aria-hidden />}
              triggerVariant="inverse-outline"
              title="Record damage"
            >
              <FoundDamageForm
                action={recordFoundDamageAction.bind(null, vehicle.id)}
                today={today}
              />
            </FormDialog>
            <Button asChild variant="inverse">
              <Link href={newRentalPath({ vehicleId: vehicle.id })}>
                <Plus aria-hidden />
                New rental for this car
              </Link>
            </Button>
          </>
        )
      }
    />
  );
}
