import { listQueryString, pageOfRows, parseListQuery } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { DataList } from "@fleetapp/ui/data-list";
import Link from "next/link";

import { appDb } from "../../lib/app-db";
import { listOperators } from "../../lib/operators/queries";
import {
  NEW_OPERATOR_PATH,
  OPERATORS_EXPORT_PATH,
  OPERATORS_PATH,
  operatorPath,
} from "../../lib/paths";
import { requireAdmin } from "../../lib/require-admin";
import { AdminShell } from "../admin-shell";
import { OPERATOR_LIST } from "./operator-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function OperatorsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const query = parseListQuery(OPERATOR_LIST, await props.searchParams);
  const operators = await listOperators(appDb, new Date());
  const queryString = listQueryString(OPERATOR_LIST, query, { page: 1 });

  return (
    <AdminShell>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Operators</h1>
        <Button asChild>
          <Link href={NEW_OPERATOR_PATH}>New Operator</Link>
        </Button>
      </div>

      {operators.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No Operators yet. Create the first one to send its invite.
        </p>
      ) : (
        <DataList
          definition={OPERATOR_LIST}
          page={pageOfRows(operators, OPERATOR_LIST, query)}
          query={query}
          basePath={OPERATORS_PATH}
          rowKey={(operator) => operator.id}
          rowHref={(operator) => operatorPath(operator.id)}
          itemName={{ one: "Operator", many: "Operators" }}
          searchLabel="Search by name or email"
          exportHrefs={{
            csv: `${OPERATORS_EXPORT_PATH}/csv${queryString}`,
            xlsx: `${OPERATORS_EXPORT_PATH}/xlsx${queryString}`,
          }}
          emptyMessage="No Operators match. Try a different search or filter."
        />
      )}
    </AdminShell>
  );
}
