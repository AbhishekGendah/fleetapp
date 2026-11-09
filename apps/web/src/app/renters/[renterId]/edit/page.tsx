import type { Metadata } from "next";
import { renterShownName, todayInTimeZone } from "@fleetapp/core";
import { Card, CardContent } from "@fleetapp/ui/card";
import { PageHeader } from "@fleetapp/ui/page-header";
import { redirect } from "next/navigation";

import { renterPath } from "../../../../lib/paths";
import { requireUser } from "../../../../lib/require-user";
import { personRenterFormValues } from "../../../../lib/renters/renter-input";
import { AppShell } from "../../../app-shell";
import { businessRenterFormValues } from "../../../../lib/renters/business-renter-input";
import { editBusinessRenterAction, editRenterAction } from "../../actions";
import { BusinessRenterForm } from "../../business-renter-form";
import { RenterForm } from "../../renter-form";
import { loadRenterOrNotFound } from "../load-renter";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Edit Renter" };

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
        backLabel={renterShownName(renter)}
        title={`Edit ${renterShownName(renter)}`}
      />
      <Card>
        <CardContent className="pt-4 sm:pt-6">
          {renter.kind === "organisation" ? (
            <BusinessRenterForm
              initialValues={businessRenterFormValues(renter)}
              action={editBusinessRenterAction.bind(null, renter.id)}
              submitLabel="Save changes"
              cancelHref={renterPath(renter.id)}
            />
          ) : (
            <RenterForm
              initialValues={personRenterFormValues(renter)}
              today={todayInTimeZone(new Date(), user.operatorTimezone)}
              action={editRenterAction.bind(null, renter.id)}
              submitLabel="Save changes"
              cancelHref={renterPath(renter.id)}
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
