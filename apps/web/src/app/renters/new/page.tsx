import type { Metadata } from "next";
import { todayInTimeZone } from "@fleetapp/core";
import { Card, CardContent } from "@fleetapp/ui/card";
import { PageHeader } from "@fleetapp/ui/page-header";

import { NEW_RENTER_KIND_PARAM, NEW_BUSINESS_RENTER_KIND, RENTERS_PATH } from "../../../lib/paths";
import { requireUser } from "../../../lib/require-user";
import { AppShell } from "../../app-shell";
import { NewRenterForms } from "./new-renter-forms";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "New Renter" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NewRenterPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const searchParams = await props.searchParams;
  const isBusiness = searchParams[NEW_RENTER_KIND_PARAM] === NEW_BUSINESS_RENTER_KIND;
  return (
    <AppShell user={user}>
      <PageHeader backHref={RENTERS_PATH} backLabel="Renters" title="Add a Renter" />
      <Card>
        <CardContent className="pt-4 sm:pt-6">
          <NewRenterForms
            initialKind={isBusiness ? "organisation" : "person"}
            today={todayInTimeZone(new Date(), user.operatorTimezone)}
            cancelHref={RENTERS_PATH}
          />
        </CardContent>
      </Card>
    </AppShell>
  );
}
