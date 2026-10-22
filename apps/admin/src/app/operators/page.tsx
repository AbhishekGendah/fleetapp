import { Button } from "@fleetapp/ui/button";
import { Card, CardContent } from "@fleetapp/ui/card";
import Link from "next/link";

import { appDb } from "../../lib/app-db";
import { formatAdminDateTime } from "../../lib/format";
import { listOperators, type OperatorSummary } from "../../lib/operators/queries";
import { requireAdmin } from "../../lib/require-admin";
import { AdminShell } from "../admin-shell";
import { OperatorStatusBadge } from "../status-badge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function displayName(operator: OperatorSummary): string {
  return operator.tradingName ?? operator.legalName;
}

function formatLastSignIn(operator: OperatorSummary): string {
  return operator.lastSignedInAt ? formatAdminDateTime(operator.lastSignedInAt) : "Never";
}

function OperatorCards({ operators }: { operators: OperatorSummary[] }) {
  return (
    <ul className="flex flex-col gap-3 md:hidden">
      {operators.map((operator) => (
        <li key={operator.id}>
          <Link href={`/operators/${operator.id}`} className="block">
            <Card>
              <CardContent className="flex flex-col gap-1 p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{displayName(operator)}</span>
                  <OperatorStatusBadge status={operator.status} />
                </div>
                <span className="text-muted-foreground text-sm break-all">
                  {operator.userEmail ?? "No User"}
                </span>
                <span className="text-muted-foreground text-xs">
                  Last sign-in: {formatLastSignIn(operator)}
                </span>
              </CardContent>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function OperatorTable({ operators }: { operators: OperatorSummary[] }) {
  return (
    <table className="hidden w-full text-left text-sm md:table">
      <thead className="text-muted-foreground border-b">
        <tr>
          <th className="py-2 font-medium">Operator</th>
          <th className="py-2 font-medium">User</th>
          <th className="py-2 font-medium">Status</th>
          <th className="py-2 font-medium">Last sign-in</th>
          <th className="py-2 font-medium">Created</th>
        </tr>
      </thead>
      <tbody>
        {operators.map((operator) => (
          <tr key={operator.id} className="border-b">
            <td className="py-3">
              <Link href={`/operators/${operator.id}`} className="font-medium hover:underline">
                {displayName(operator)}
              </Link>
            </td>
            <td className="py-3">{operator.userEmail ?? "No User"}</td>
            <td className="py-3">
              <OperatorStatusBadge status={operator.status} />
            </td>
            <td className="py-3">{formatLastSignIn(operator)}</td>
            <td className="py-3">{formatAdminDateTime(operator.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function OperatorsPage() {
  await requireAdmin();
  const operators = await listOperators(appDb, new Date());

  return (
    <AdminShell>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Operators</h1>
        <Button asChild>
          <Link href="/operators/new">New Operator</Link>
        </Button>
      </div>

      {operators.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No Operators yet. Create the first one to send its invite.
        </p>
      ) : (
        <>
          <OperatorCards operators={operators} />
          <OperatorTable operators={operators} />
        </>
      )}
    </AdminShell>
  );
}
