import type { Metadata } from "next";
import { formatFileSize } from "@fleetapp/core";
import { Badge } from "@fleetapp/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { CountLinks } from "@fleetapp/ui/count-links";
import Link from "next/link";

import { appDb } from "../lib/app-db";
import {
  HOME_STATUS_ORDER,
  RECENT_SIGN_IN_DAYS,
  summariseForAdminHome,
} from "../lib/operators/home-summary";
import { listOperators } from "../lib/operators/queries";
import { OPERATOR_STATUS_LABELS } from "../lib/operators/status-labels";
import { OPERATORS_PATH, operatorPath } from "../lib/paths";
import { requireAdmin } from "../lib/require-admin";
import { AdminShell } from "./admin-shell";
import { NewOperatorButton } from "./operators/new-operator-button";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Home" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The admin home (Abhi's A1): how AGS's businesses are doing at a glance.
 * Counts and setup only, worked out from the Operator list: never a
 * Renter's details (rule 5).
 */
export default async function HomePage() {
  await requireAdmin();
  const summary = summariseForAdminHome(await listOperators(appDb, new Date()), new Date());
  const statusLinks = HOME_STATUS_ORDER.filter(
    (status) => (summary.countByStatus.get(status) ?? 0) > 0,
  ).map((status) => ({
    href: `${OPERATORS_PATH}?status=${status}`,
    label: OPERATOR_STATUS_LABELS[status],
    count: summary.countByStatus.get(status) ?? 0,
  }));

  return (
    <AdminShell>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-primary text-2xl font-extrabold tracking-tight">Home</h1>
        <NewOperatorButton />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Businesses</CardTitle>
          <CardDescription>
            {summary.total === 0
              ? "None yet. Create the first one to send its invite."
              : `${summary.total} in all. Tap a count to see them.`}
          </CardDescription>
        </CardHeader>
        {statusLinks.length > 0 ? (
          <CardContent>
            <CountLinks links={statusLinks} label="Businesses by status" />
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Not set up yet</CardTitle>
          <CardDescription>
            Signed up, but still missing their business details or Stripe. They enter both
            themselves from their own setup checklist.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {summary.setupGaps.length === 0 ? (
            <p className="text-sm">Every signed-up business is set up.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {summary.setupGaps.map((gap) => (
                <li key={gap.operatorId} className="flex flex-wrap items-center gap-2 py-2">
                  <Link
                    href={operatorPath(gap.operatorId)}
                    className="text-teal hover:text-primary inline-flex min-h-11 items-center font-semibold"
                  >
                    {gap.name}
                  </Link>
                  {gap.hasBusinessDetails ? null : (
                    <Badge tone="attention">No business details</Badge>
                  )}
                  {gap.isStripeReady ? null : <Badge tone="attention">Stripe not ready</Badge>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>Signed in, last {RECENT_SIGN_IN_DAYS} days</CardDescription>
            <p className="text-primary text-3xl font-extrabold">{summary.signedInLately}</p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Storage used by all businesses</CardDescription>
            <p className="text-primary text-3xl font-extrabold">
              {formatFileSize(summary.storageUsedBytes)}
            </p>
          </CardHeader>
        </Card>
      </div>
    </AdminShell>
  );
}
