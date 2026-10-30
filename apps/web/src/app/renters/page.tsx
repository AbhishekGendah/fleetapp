import { listQueryString, parseListQuery } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { DataList } from "@fleetapp/ui/data-list";
import { Plus } from "lucide-react";
import Link from "next/link";

import { appDb } from "../../lib/app-db";
import { NEW_RENTER_PATH, RENTERS_EXPORT_PATH, RENTERS_PATH, renterPath } from "../../lib/paths";
import { requireUser } from "../../lib/require-user";
import { hasAnyRenter, listRenterPage } from "../../lib/renters/renter-queries";
import { AppShell } from "../app-shell";
import { loadExpiryContext } from "../../lib/vehicles/expiry-context";
import { RENTER_LIST, withLicenceStatuses } from "./renter-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function RentersPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const query = parseListQuery(RENTER_LIST, await props.searchParams);
  const [hasRenters, page, licenceExpiry] = await Promise.all([
    hasAnyRenter(appDb, user.operatorId),
    listRenterPage(appDb, user.operatorId, query),
    loadExpiryContext(user, "licenceExpiryWarningDays"),
  ]);
  const queryString = listQueryString(RENTER_LIST, query, { page: 1 });

  return (
    <AppShell user={user}>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-primary text-2xl font-extrabold">Renters</h1>
        <Button asChild>
          <Link href={NEW_RENTER_PATH}>
            <Plus aria-hidden />
            Add a Renter
          </Link>
        </Button>
      </div>

      {hasRenters ? (
        <DataList
          definition={RENTER_LIST}
          page={{ ...page, rows: withLicenceStatuses(page.rows, licenceExpiry) }}
          query={query}
          basePath={RENTERS_PATH}
          rowKey={(renter) => renter.id}
          rowHref={(renter) => renterPath(renter.id)}
          itemName={{ one: "Renter", many: "Renters" }}
          searchLabel="Search by name, phone, email or licence number"
          exportHrefs={{
            csv: `${RENTERS_EXPORT_PATH}/csv${queryString}`,
            xlsx: `${RENTERS_EXPORT_PATH}/xlsx${queryString}`,
          }}
          emptyMessage="No Renters match. Try a different search or filter."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>No Renters yet</CardTitle>
            <CardDescription>
              Add your first Renter with their name and a phone or email. You can add the rest
              later.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </AppShell>
  );
}
