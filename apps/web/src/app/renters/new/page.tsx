import { todayInTimeZone } from "@fleetapp/core";
import { Card, CardContent } from "@fleetapp/ui/card";
import { PageHeader } from "@fleetapp/ui/page-header";

import { RENTERS_PATH } from "../../../lib/paths";
import { requireUser } from "../../../lib/require-user";
import { emptyRenterForm } from "../../../lib/renters/renter-input";
import { AppShell } from "../../app-shell";
import { addRenterAction } from "../actions";
import { RenterForm } from "../renter-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NewRenterPage() {
  const user = await requireUser();
  return (
    <AppShell user={user}>
      <PageHeader backHref={RENTERS_PATH} backLabel="Renters" title="Add a Renter" />
      <Card>
        <CardContent className="pt-4 sm:pt-6">
          <RenterForm
            initialValues={emptyRenterForm()}
            today={todayInTimeZone(new Date(), user.operatorTimezone)}
            action={addRenterAction}
            submitLabel="Add Renter"
            cancelHref={RENTERS_PATH}
          />
        </CardContent>
      </Card>
    </AppShell>
  );
}
