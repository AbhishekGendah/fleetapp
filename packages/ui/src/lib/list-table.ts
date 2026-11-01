import {
  constructTable,
  createColumnHelper,
  tableFeatures,
  type RowData,
  type Table,
} from "@tanstack/table-core";
import { storeReactivityBindings } from "@tanstack/table-core/store-reactivity-bindings";
import type * as React from "react";

/** One column of a shared list, as the list's definition gives it. */
export interface ListTableColumn<Row> {
  key: string;
  label: string;
  /** What the cell shows. */
  cell: (row: Row) => React.ReactNode;
}

const LIST_FEATURES = tableFeatures({ coreReactivityFeature: storeReactivityBindings() });

export type ListTable<Row extends RowData> = Table<typeof LIST_FEATURES, Row>;

/**
 * The page of rows as a TanStack Table, for drawing as a table or as cards.
 * Built where the page is drawn (on the server): searching, sorting and
 * paging have already happened in the database, so only the core row model
 * is needed.
 */
export function buildListTable<Row extends RowData>(
  columns: readonly ListTableColumn<Row>[],
  rows: readonly Row[],
  rowKey: (row: Row) => string,
): ListTable<Row> {
  const helper = createColumnHelper<typeof LIST_FEATURES, Row>();
  return constructTable({
    features: LIST_FEATURES,
    columns: helper.columns(
      columns.map((column) =>
        helper.display({
          id: column.key,
          header: column.label,
          cell: (context) => column.cell(context.row.original),
        }),
      ),
    ),
    data: [...rows],
    getRowId: (row) => rowKey(row),
  });
}
