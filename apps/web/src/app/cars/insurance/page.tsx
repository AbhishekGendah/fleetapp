import { expiryStatus, parseListQuery } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { PageHeader } from "@fleetapp/ui/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { DataList } from "@fleetapp/ui/data-list";
import Link from "next/link";

import { appDb } from "../../../lib/app-db";
import { CARS_PATH, INSURANCE_PATH, NEW_POLICY_PATH, policyPath } from "../../../lib/paths";
import { requireUser } from "../../../lib/require-user";
import { loadExpiryContext } from "../../../lib/vehicles/expiry-context";
import { listPolicyPage } from "../../../lib/vehicles/paperwork-queries";
import { AppShell } from "../../app-shell";
import { POLICY_LIST } from "./policy-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every insurance policy: one per car, or fleet policies covering several. */
export default async function InsurancePage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const query = parseListQuery(POLICY_LIST, await props.searchParams);
  const [page, expiry] = await Promise.all([
    listPolicyPage(appDb, user.operatorId, query),
    loadExpiryContext(user),
  ]);
  const rows = page.rows.map((policy) => ({
    ...policy,
    endsStatus: expiryStatus(policy.endsOn, expiry.today, expiry.warningDays),
  }));

  return (
    <AppShell user={user}>
      <PageHeader backHref={CARS_PATH} backLabel="Cars" title="Insurance" />
      <div className="flex items-center justify-end gap-2">
        <Button asChild className="w-full sm:w-auto">
          <Link href={NEW_POLICY_PATH}>Add a policy</Link>
        </Button>
      </div>
      <p className="text-muted-foreground -mt-2 text-sm">
        Insuring one car? It is quickest from the car&rsquo;s Rego &amp; insurance tab. Add a policy
        here for a fleet policy covering several cars.
      </p>
      {page.total === 0 && !query.search && Object.keys(query.filters).length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No policies yet</CardTitle>
            <CardDescription>Policies you add, here or on a car, are listed here.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <DataList
          definition={POLICY_LIST}
          page={{ ...page, rows }}
          query={query}
          basePath={INSURANCE_PATH}
          rowKey={(policy) => policy.id}
          rowHref={(policy) => policyPath(policy.id)}
          itemName={{ one: "policy", many: "policies" }}
          searchLabel="Search by insurer or policy number"
          emptyMessage="No policies match. Try a different search or filter."
        />
      )}
    </AppShell>
  );
}
