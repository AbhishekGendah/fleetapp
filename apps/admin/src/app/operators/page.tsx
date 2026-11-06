import type { Metadata } from "next";
import { listQueryString, pageOfRows, parseListQuery } from "@fleetapp/core";
import { DataList } from "@fleetapp/ui/data-list";

import { appDb } from "../../lib/app-db";
import { listOperators } from "../../lib/operators/queries";
import { OPERATORS_EXPORT_PATH, OPERATORS_PATH, operatorPath } from "../../lib/paths";
import { requireAdmin } from "../../lib/require-admin";
import { AdminShell } from "../admin-shell";
import { NewOperatorButton } from "./new-operator-button";
import { OPERATOR_LIST, OPERATOR_LIST_RULES } from "./operator-list";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Operators" };

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
        <NewOperatorButton />
      </div>

      {operators.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No Operators yet. Create the first one to send its invite.
        </p>
      ) : (
        <DataList
          definition={OPERATOR_LIST}
          page={pageOfRows(operators, OPERATOR_LIST_RULES, query)}
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
