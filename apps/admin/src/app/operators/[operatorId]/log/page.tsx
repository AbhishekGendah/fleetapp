import type { Metadata } from "next";
import { AUSTRALIAN_LOCALE, pageOfRows, parseListQuery } from "@fleetapp/core";
import { describeActivity } from "@fleetapp/db/activity";
import { DataList } from "@fleetapp/ui/data-list";

import { OPERATOR_HISTORY_LIMIT } from "../../../../lib/operators/queries";
import { operatorLogPath } from "../../../../lib/paths";
import { loadOperatorForPage, OperatorFrame } from "../operator-frame";
import { LOG_LIST, LOG_LIST_RULES, type LogRow } from "./log-list";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Operator log" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A business's page, Log tab: its history a page at a time (Abhi's A5, A6). */
export default async function OperatorLogPage(props: {
  params: Promise<{ operatorId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ operatorId }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const operator = await loadOperatorForPage(operatorId);
  const query = parseListQuery(LOG_LIST, searchParams);
  const rows: LogRow[] = operator.history.map((entry) => ({
    id: entry.id,
    occurredAt: entry.occurredAt,
    what: describeActivity(entry.entityType, entry.action),
    actorType: entry.actorType,
  }));

  return (
    <OperatorFrame operator={operator} current="log">
      <p className="text-muted-foreground text-sm">
        The latest {OPERATOR_HISTORY_LIMIT.toLocaleString(AUSTRALIAN_LOCALE)} things that happened
        in this business, newest first. Older ones are kept, just not listed here.
      </p>
      <DataList
        definition={LOG_LIST}
        page={pageOfRows(rows, LOG_LIST_RULES, query)}
        query={query}
        basePath={operatorLogPath(operator.id)}
        rowKey={(row) => row.id}
        itemName={{ one: "line", many: "lines" }}
        searchLabel="Search the log"
        emptyMessage="Nothing in the log matches."
      />
    </OperatorFrame>
  );
}
