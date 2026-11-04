import { isCalendarDate, isRecordId } from "@fleetapp/core";
import { Card, CardContent } from "@fleetapp/ui/card";
import { PageHeader } from "@fleetapp/ui/page-header";

import { appDb } from "../../../lib/app-db";
import { NEW_RENTAL_PRESETS, NEW_RENTAL_STARTS_ON, RENTALS_PATH } from "../../../lib/paths";
import {
  listCarPrices,
  listPickableCars,
  listPickableRenters,
} from "../../../lib/rentals/pickable-records";
import { carPriceFields, emptyRentalForm, type CarPrices } from "../../../lib/rentals/rental-input";
import { requireUser } from "../../../lib/require-user";
import { loadOperatorSettings } from "../../../lib/settings/operator-settings";
import { AppShell } from "../../app-shell";
import { createRentalAction } from "../actions";
import { RentalForm } from "../rental-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A day chosen on the timeline starts at the usual pickup time; the Operator can change it. */
const PRESET_PICKUP_TIME = "09:00";

/**
 * A Renter or car chosen by the page that opened the form, if it is a
 * record id at all, and a start day if it is a real date.
 */
function presetsFrom(
  searchParams: Record<string, string | string[] | undefined>,
): Partial<Record<(typeof NEW_RENTAL_PRESETS)[number] | "plannedStart", string>> {
  const ids = NEW_RENTAL_PRESETS.flatMap((key) => {
    const value = searchParams[key];
    return typeof value === "string" && isRecordId(value) ? [[key, value]] : [];
  });
  const startsOn = searchParams[NEW_RENTAL_STARTS_ON];
  const start =
    typeof startsOn === "string" && isCalendarDate(startsOn)
      ? [["plannedStart", `${startsOn}T${PRESET_PICKUP_TIME}`]]
      : [];
  return Object.fromEntries([...ids, ...start]);
}

/** A car chosen by the page that opened the form brings its prices with it. */
function withCarPrices(
  presets: ReturnType<typeof presetsFrom>,
  carPrices: Readonly<Record<string, CarPrices>>,
): Parameters<typeof emptyRentalForm>[0] {
  return presets.vehicleId
    ? { ...presets, ...carPriceFields(carPrices[presets.vehicleId]) }
    : presets;
}

export default async function NewRentalPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const [renters, cars, carPrices, settings, searchParams] = await Promise.all([
    listPickableRenters(appDb, user.operatorId),
    listPickableCars(appDb, user.operatorId),
    listCarPrices(appDb, user.operatorId),
    loadOperatorSettings(appDb, user.operatorId),
    props.searchParams,
  ]);

  return (
    <AppShell user={user}>
      <PageHeader backHref={RENTALS_PATH} backLabel="Rentals" title="New rental" />
      <Card>
        <CardContent className="pt-6">
          <RentalForm
            initialValues={emptyRentalForm(withCarPrices(presetsFrom(searchParams), carPrices))}
            renters={renters}
            cars={cars}
            timeZone={user.operatorTimezone}
            carPrices={carPrices}
            longTermMinimumDays={settings.longTermMinimumDays}
            graceMinutes={settings.graceMinutes}
            action={createRentalAction}
            cancelHref={RENTALS_PATH}
          />
        </CardContent>
      </Card>
    </AppShell>
  );
}
