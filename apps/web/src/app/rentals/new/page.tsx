import { isRecordId, WEEKDAY_LABELS } from "@fleetapp/core";
import { Card, CardContent } from "@fleetapp/ui/card";
import { PageHeader } from "@fleetapp/ui/page-header";

import { appDb } from "../../../lib/app-db";
import { NEW_RENTAL_PRESETS, RENTALS_PATH } from "../../../lib/paths";
import { listPickableCars, listPickableRenters } from "../../../lib/rentals/pickable-records";
import { emptyRentalForm } from "../../../lib/rentals/rental-input";
import { requireUser } from "../../../lib/require-user";
import { loadOperatorSettings } from "../../../lib/settings/operator-settings";
import { AppShell } from "../../app-shell";
import { createRentalAction } from "../actions";
import { RentalForm } from "../rental-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A Renter or car chosen by the page that opened the form, if it is a record id at all. */
function presetsFrom(
  searchParams: Record<string, string | string[] | undefined>,
): Partial<Record<(typeof NEW_RENTAL_PRESETS)[number], string>> {
  return Object.fromEntries(
    NEW_RENTAL_PRESETS.flatMap((key) => {
      const value = searchParams[key];
      return typeof value === "string" && isRecordId(value) ? [[key, value]] : [];
    }),
  );
}

export default async function NewRentalPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const [renters, cars, settings, searchParams] = await Promise.all([
    listPickableRenters(appDb, user.operatorId),
    listPickableCars(appDb, user.operatorId),
    loadOperatorSettings(appDb, user.operatorId),
    props.searchParams,
  ]);

  return (
    <AppShell user={user}>
      <PageHeader backHref={RENTALS_PATH} backLabel="Rentals" title="New rental" />
      <Card>
        <CardContent className="pt-6">
          <RentalForm
            initialValues={emptyRentalForm(presetsFrom(searchParams))}
            renters={renters}
            cars={cars}
            timeZone={user.operatorTimezone}
            fixedChargeDayLabel={
              settings.fixedChargeWeekday ? WEEKDAY_LABELS[settings.fixedChargeWeekday] : null
            }
            action={createRentalAction}
            cancelHref={RENTALS_PATH}
          />
        </CardContent>
      </Card>
    </AppShell>
  );
}
