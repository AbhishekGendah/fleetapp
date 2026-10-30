import { todayInTimeZone } from "@fleetapp/core";
import { Card, CardContent } from "@fleetapp/ui/card";
import { PageHeader } from "@fleetapp/ui/page-header";
import { redirect } from "next/navigation";

import { renterPath } from "../../../../lib/paths";
import { requireUser } from "../../../../lib/require-user";
import { renterFormValues } from "../../../../lib/renters/renter-input";
import { AppShell } from "../../../app-shell";
import { editRenterAction } from "../../actions";
import { RenterForm } from "../../renter-form";
import { loadRenterOrNotFound } from "../load-renter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function EditRenterPage(props: { params: Promise<{ renterId: string }> }) {
  const user = await requireUser();
  const { renterId } = await props.params;
  const renter = await loadRenterOrNotFound(user, renterId);
  // An archived Renter is read-only until restored.
  if (renter.archivedAt) {
    redirect(renterPath(renter.id));
  }
  return (
    <AppShell user={user}>
      <PageHeader
        backHref={renterPath(renter.id)}
        backLabel={renter.fullName}
        title={`Edit ${renter.fullName}`}
      />
      <Card>
        <CardContent className="pt-4 sm:pt-6">
          <RenterForm
            initialValues={renterFormValues(renter)}
            today={todayInTimeZone(new Date(), user.operatorTimezone)}
            action={editRenterAction.bind(null, renter.id)}
            submitLabel="Save changes"
            cancelHref={renterPath(renter.id)}
          />
        </CardContent>
      </Card>
    </AppShell>
  );
}
