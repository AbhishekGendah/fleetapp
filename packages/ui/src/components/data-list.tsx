import {
  AUSTRALIAN_LOCALE,
  LIST_PARAMS,
  listQueryString,
  type ListColumn,
  type ListDefinition,
  type ListPage,
  type ListQuery,
  MAX_EXPORT_ROWS,
} from "@fleetapp/core";
import type * as React from "react";

import { cn } from "../lib/utils";
import { AutoSubmitSelect } from "./auto-submit-select";
import { Button } from "./button";
import { Card, CardContent } from "./card";
import { Input } from "./input";

export interface DataListColumn<Row> extends ListColumn<Row> {
  /** How the cell looks. Left out, the export value is shown as text. */
  render?: (row: Row) => React.ReactNode;
  /** The card's heading on a phone; every other column is a line beneath it. */
  isCardTitle?: boolean;
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
    <form
      action={props.basePath}
      method="get"
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
    >
      <label className="flex flex-1 flex-col gap-2 text-sm font-medium">
        {props.searchLabel}
        <Input type="search" name={LIST_PARAMS.search} defaultValue={query.search} />
      </label>
      {definition.filters.map((filter) => (
        <label key={filter.key} className="flex flex-col gap-2 text-sm font-medium sm:w-48">
          {filter.label}
          <AutoSubmitSelect name={filter.key} defaultValue={query.filters[filter.key] ?? ""}>
            <option value="">All</option>
            {filter.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </AutoSubmitSelect>
        </label>
      ))}
      {/* A new search starts from the first page but keeps the sort. */}
      <input type="hidden" name={LIST_PARAMS.sort} value={query.sort.column} />
      <input type="hidden" name={LIST_PARAMS.direction} value={query.sort.direction} />
      <Button type="submit" variant="outline">
        Search
      </Button>
    </form>
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
    <a href={href} className="inline-flex min-h-11 items-center gap-1 hover:underline">
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

function Table<Row>(props: DataListProps<Row>) {
  const { definition, query } = props;
  return (
    <table className="hidden w-full text-left text-sm md:table">
      <thead className="text-muted-foreground border-b">
        <tr>
          {definition.columns.map((column) => (
            <th
              key={column.key}
              className="py-1 pr-4 font-medium"
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
        {props.page.rows.map((row) => (
          <tr
            key={props.rowKey(row)}
            className={cn("border-b", props.rowHref && "hover:bg-muted/60 relative")}
          >
            {definition.columns.map((column) => (
              <td key={column.key} className="py-3 pr-4">
                {column.isCardTitle ? (
                  <RowLink href={props.rowHref?.(row)}>{cellContent(column, row)}</RowLink>
                ) : (
                  cellContent(column, row)
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Cards<Row>(props: DataListProps<Row>) {
  const columns = props.definition.columns;
  const title = columns.find((column) => column.isCardTitle) ?? columns[0];
  return (
    <ul className="flex flex-col gap-3 md:hidden">
      {props.page.rows.map((row) => (
        <li key={props.rowKey(row)}>
          <Card className={cn(props.rowHref && "active:bg-muted/60 hover:bg-muted/60 relative")}>
            <CardContent className="flex flex-col gap-1 p-4">
              {title ? (
                <RowLink href={props.rowHref?.(row)} className="flex min-h-11 items-center">
                  {cellContent(title, row)}
                </RowLink>
              ) : null}
              {columns
                .filter((column) => column !== title)
                .map((column) => (
                  <div key={column.key} className="flex flex-wrap items-center gap-1 text-sm">
                    <span className="text-muted-foreground">{column.label}:</span>
                    {cellContent(column, row)}
                  </div>
                ))}
            </CardContent>
          </Card>
        </li>
      ))}
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
export function DataList<Row>(props: DataListProps<Row>): React.JSX.Element {
  const { page, itemName } = props;
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
          <Cards {...props} />
          <Table {...props} />
          <Paging {...props} />
        </>
      )}
    </div>
  );
}
