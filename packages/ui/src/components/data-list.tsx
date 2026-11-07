import {
  AUSTRALIAN_LOCALE,
  listQueryString,
  type ListColumn,
  type ListDefinition,
  type ListPage,
  type ListQuery,
  MAX_EXPORT_ROWS,
} from "@fleetapp/core";
import type { RowData } from "@tanstack/table-core";
import { flexRender } from "@tanstack/table-core/flex-render";
import type * as React from "react";

import { buildListTable, type ListTable } from "../lib/list-table";
import { ROW_CLASSES } from "./row-link";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { Card, CardContent } from "./card";
import { ListToolbar } from "./list-toolbar";

export interface DataListColumn<Row> extends ListColumn<Row> {
  /** How the cell looks. Left out, the export value is shown as text. */
  render?: (row: Row) => React.ReactNode;
  /** The card's heading on a phone; every other column is a line beneath it. */
  isCardTitle?: boolean;
  /** Amounts line up at the right of the table. */
  isAlignedEnd?: boolean;
  /**
   * In the CSV and Excel files only, not on screen: a detail the screen
   * folds into another column (a car's year under its name, say) that a
   * spreadsheet still wants on its own.
   */
  isOnlyInExports?: boolean;
}

export type DataListDefinition<Row> = ListDefinition<Row, DataListColumn<Row>>;

export interface DataListProps<Row> {
  definition: DataListDefinition<Row>;
  page: ListPage<Row>;
  query: ListQuery;
  /** The page the list is on; sorting, filters and paging link back to it. */
  basePath: string;
  rowKey: (row: Row) => string;
  rowHref?: (row: Row) => string;
  /**
   * The cells draw the row's links themselves, in the 6 Nov 2026 look: a
   * RowLink (from row-link) that opens the row's main thing, and names as
   * InlineRecordLinks. The row or card is then only the frame its RowLink
   * stretches over. Use instead of `rowHref`.
   */
  hasRowLinksInCells?: boolean;
  /**
   * The whole of a row's card on a phone, laid out for that list (6 Nov 2026
   * look: name and status on top, then the lines that matter), instead of
   * a line per column. It must hold the row's one RowLink, which the card
   * stretches it over, so one tap anywhere opens the row.
   */
  renderCard?: (row: Row) => React.ReactNode;
  /**
   * A short list inside a record page's card (a car's rentals): no search,
   * filters, count or exports, and on a phone each row is a bordered box
   * rather than a card of its own.
   */
  isInCard?: boolean;
  /** What one row is, e.g. { one: "Operator", many: "Operators" }. */
  itemName: { one: string; many: string };
  searchLabel: string;
  /** Where the CSV and Excel exports of the same query are. */
  exportHrefs?: { csv: string; xlsx: string };
  emptyMessage: string;
}

function cellContent<Row>(column: DataListColumn<Row>, row: Row): React.ReactNode {
  if (column.render) {
    return column.render(row);
  }
  const value = column.exportValue(row);
  return value instanceof Date ? value.toISOString() : (value ?? "");
}

function Toolbar<Row>(props: DataListProps<Row>) {
  const { definition, query } = props;
  return (
    <ListToolbar
      searchLabel={props.searchLabel}
      search={query.search}
      filters={definition.filters.map((filter) => ({
        key: filter.key,
        label: filter.label,
        options: filter.options,
      }))}
      filterValues={query.filters}
    />
  );
}

function SortHeading<Row>(props: DataListProps<Row> & { column: DataListColumn<Row> }) {
  const { column, query, definition } = props;
  if (!column.isSortable) {
    return <>{column.label}</>;
  }
  const isSorted = query.sort.column === column.key;
  const direction = isSorted && query.sort.direction === "asc" ? "desc" : "asc";
  const href = `${props.basePath}${listQueryString(definition, query, {
    sort: { column: column.key, direction },
    page: 1,
  })}`;
  return (
    <a
      href={href}
      className="text-teal hover:text-primary inline-flex min-h-11 items-center gap-1 font-semibold"
    >
      {column.label}
      <span aria-hidden="true">{isSorted ? (query.sort.direction === "asc" ? "▲" : "▼") : ""}</span>
    </a>
  );
}

/**
 * The row's one link, stretched over its whole row or card (which must be
 * `relative`) so a tap anywhere opens it. Still one link per row, so screen
 * readers and the keyboard meet it once.
 */
function RowLink(props: { href?: string; children: React.ReactNode; className?: string }) {
  return props.href ? (
    <a
      href={props.href}
      className={cn(
        "focus-visible:after:ring-ring font-medium after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] focus-visible:outline-none focus-visible:after:ring-2",
        props.className,
      )}
    >
      {props.children}
    </a>
  ) : (
    <span className={props.className}>{props.children}</span>
  );
}

/** The columns drawn on screen: every one but those only in the exports. */
function screenColumns<Row>(definition: DataListDefinition<Row>): DataListColumn<Row>[] {
  return definition.columns.filter((column) => !column.isOnlyInExports);
}

/** The page's rows as a TanStack Table: each column's cell, the title one as the row's link. */
function rowsTable<Row extends RowData>(props: DataListProps<Row>): ListTable<Row> {
  return buildListTable(
    screenColumns(props.definition).map((column) => ({
      key: column.key,
      label: column.label,
      cell: (row: Row) =>
        column.isCardTitle ? (
          <RowLink href={props.rowHref?.(row)}>{cellContent(column, row)}</RowLink>
        ) : (
          cellContent(column, row)
        ),
    })),
    props.page.rows,
    props.rowKey,
  );
}

function Table<Row extends RowData>(props: DataListProps<Row> & { table: ListTable<Row> }) {
  const { definition, query } = props;
  const columns = screenColumns(definition);
  const alignedEnd = new Set(
    columns.filter((column) => column.isAlignedEnd).map((column) => column.key),
  );
  return (
    <table className="hidden w-full text-left text-sm md:table">
      <thead className="text-muted-foreground border-b">
        <tr>
          {columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              className={cn("py-1 pr-4 font-medium", column.isAlignedEnd && "text-right")}
              aria-sort={
                query.sort.column === column.key
                  ? query.sort.direction === "asc"
                    ? "ascending"
                    : "descending"
                  : undefined
              }
            >
              <SortHeading {...props} column={column} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.table.getRowModel().rows.map((row) => (
          <tr
            key={row.id}
            className={cn(
              "border-b",
              props.rowHref && "hover:bg-muted/60 relative",
              props.hasRowLinksInCells && ROW_CLASSES,
            )}
          >
            {row.getAllCells().map((cell) => (
              <td
                key={cell.id}
                className={cn("py-3 pr-4", alignedEnd.has(cell.column.id) && "text-right")}
              >
                {flexRender(cell.column.columnDef.cell, cell.getContext()) as React.ReactNode}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Each row's own card, as the list lays it out, the row's link stretched over it. */
function OwnCards<Row>(props: DataListProps<Row> & { renderCard: (row: Row) => React.ReactNode }) {
  if (props.isInCard) {
    return (
      <ul className="flex flex-col gap-2 md:hidden">
        {props.page.rows.map((row) => (
          <li
            key={props.rowKey(row)}
            className={cn(
              ROW_CLASSES,
              "active:bg-muted/60 flex flex-col gap-1 rounded-xl border p-3",
            )}
          >
            {props.renderCard(row)}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="flex flex-col gap-3 md:hidden">
      {props.page.rows.map((row) => (
        <li key={props.rowKey(row)}>
          <Card className={cn(ROW_CLASSES, "active:bg-muted/60")}>
            <CardContent className="flex flex-col gap-1 p-4">{props.renderCard(row)}</CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function Cards<Row extends RowData>(props: DataListProps<Row> & { table: ListTable<Row> }) {
  const { renderCard } = props;
  if (renderCard) {
    return <OwnCards {...props} renderCard={renderCard} />;
  }
  const columns = screenColumns(props.definition);
  const titleKey = (columns.find((column) => column.isCardTitle) ?? columns[0])?.key;
  const labels = new Map(columns.map((column) => [column.key, column.label]));
  return (
    <ul className="flex flex-col gap-3 md:hidden">
      {props.table.getRowModel().rows.map((row) => {
        const cells = row.getAllCells();
        const title = cells.find((cell) => cell.column.id === titleKey);
        return (
          <li key={row.id}>
            <Card
              className={cn(
                props.rowHref && "active:bg-muted/60 hover:bg-muted/60 relative",
                props.hasRowLinksInCells && cn(ROW_CLASSES, "active:bg-muted/60"),
              )}
            >
              <CardContent className="flex flex-col gap-1 p-4">
                {title ? (
                  <div className="flex min-h-11 items-center font-medium">
                    {flexRender(title.column.columnDef.cell, title.getContext()) as React.ReactNode}
                  </div>
                ) : null}
                {cells
                  .filter((cell) => cell !== title)
                  .map((cell) => (
                    <div key={cell.id} className="flex flex-wrap items-center gap-1 text-sm">
                      <span className="text-muted-foreground">{labels.get(cell.column.id)}:</span>
                      {flexRender(cell.column.columnDef.cell, cell.getContext()) as React.ReactNode}
                    </div>
                  ))}
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

function Paging<Row>(props: DataListProps<Row>) {
  const { page, query, definition } = props;
  if (page.pageCount <= 1) {
    return null;
  }
  const hrefFor = (target: number) =>
    `${props.basePath}${listQueryString(definition, query, { page: target })}`;
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-2 text-sm">
      {page.page > 1 ? (
        <Button asChild variant="outline">
          <a href={hrefFor(page.page - 1)}>Previous</a>
        </Button>
      ) : (
        <span />
      )}
      <span className="text-muted-foreground">
        Page {page.page} of {page.pageCount}
      </span>
      {page.page < page.pageCount ? (
        <Button asChild variant="outline">
          <a href={hrefFor(page.page + 1)}>Next</a>
        </Button>
      ) : (
        <span />
      )}
    </nav>
  );
}

/**
 * The one list every list in the product uses (docs/design/08): search,
 * filters and sorting in the page address, a table on a wide screen and
 * cards on a phone (rule 24), pages, and export of exactly what is shown.
 * The server applies the query; this only draws the result.
 */
export function DataList<Row extends RowData>(props: DataListProps<Row>): React.JSX.Element {
  const { page, itemName } = props;
  const table = rowsTable(props);
  if (props.isInCard) {
    return page.total === 0 ? (
      <p className="text-muted-foreground text-sm">{props.emptyMessage}</p>
    ) : (
      <div className="flex flex-col gap-4">
        <Cards {...props} table={table} />
        <Table {...props} table={table} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <Toolbar {...props} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm" role="status">
          {page.total} {page.total === 1 ? itemName.one : itemName.many}
          {props.exportHrefs && page.total > MAX_EXPORT_ROWS
            ? `. Exports hold the first ${MAX_EXPORT_ROWS.toLocaleString(AUSTRALIAN_LOCALE)}.`
            : null}
        </p>
        {props.exportHrefs && page.total > 0 ? (
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <a href={props.exportHrefs.csv}>Export CSV</a>
            </Button>
            <Button asChild variant="outline">
              <a href={props.exportHrefs.xlsx}>Export Excel</a>
            </Button>
          </div>
        ) : null}
      </div>
      {page.total === 0 ? (
        <p className="text-muted-foreground text-sm">{props.emptyMessage}</p>
      ) : (
        <>
          <Cards {...props} table={table} />
          <Table {...props} table={table} />
          <Paging {...props} />
        </>
      )}
    </div>
  );
}
