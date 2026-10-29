/**
 * The rules every list in the product shares (docs/design/08): search,
 * filters, sorting, paging and export, from one definition of its columns.
 * Pure, so the server applies exactly the same query to the page shown and
 * to the export.
 */

/** Rows a page shows. A list never sends everything to the browser. */
export const LIST_PAGE_SIZE = 25;
/** An export larger than this is cut off, with the page saying so. */
export const MAX_EXPORT_ROWS = 10_000;
const MAX_SEARCH_LENGTH = 100;

export type SortDirection = "asc" | "desc";
export type ListValue = string | number | Date | null;

export interface ListColumn<Row> {
  key: string;
  label: string;
  /** Present for a column that can be sorted by. */
  sortValue?: (row: Row) => ListValue;
  /** What goes in the CSV or Excel cell. */
  exportValue: (row: Row) => ListValue;
}

export interface ListFilterOption {
  value: string;
  label: string;
}

export interface ListFilter<Row> {
  key: string;
  label: string;
  options: readonly ListFilterOption[];
  matches: (row: Row, value: string) => boolean;
}

export interface ListDefinition<Row, Column extends ListColumn<Row> = ListColumn<Row>> {
  columns: readonly Column[];
  /** The text the search box looks through. */
  searchText: (row: Row) => string;
  filters: readonly ListFilter<Row>[];
  defaultSort: { column: string; direction: SortDirection };
}

export interface ListQuery {
  search: string;
  sort: { column: string; direction: SortDirection };
  /** Only filters whose value is one of their options. */
  filters: Readonly<Record<string, string>>;
  page: number;
}

/** The names a list's query goes by in the page address. Filters use their own key. */
export const LIST_PARAMS = { search: "q", sort: "sort", direction: "dir", page: "page" } as const;

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

function single(params: SearchParams, name: string): string | undefined {
  const value = params[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Reads a list's query from the page address, keeping only what the list
 * allows: an unknown column, filter value or page number falls back to the
 * default rather than reaching a query.
 */
export function parseListQuery<Row>(
  definition: ListDefinition<Row>,
  params: SearchParams,
): ListQuery {
  const sortColumn = single(params, LIST_PARAMS.sort);
  const isSortable = definition.columns.some(
    (column) => column.key === sortColumn && column.sortValue,
  );
  const direction = single(params, LIST_PARAMS.direction);
  const page = Number(single(params, LIST_PARAMS.page));
  const filters = Object.fromEntries(
    definition.filters.flatMap((filter) => {
      const value = single(params, filter.key);
      return filter.options.some((option) => option.value === value) ? [[filter.key, value!]] : [];
    }),
  );

  return {
    search: (single(params, LIST_PARAMS.search) ?? "").trim().slice(0, MAX_SEARCH_LENGTH),
    sort: isSortable
      ? { column: sortColumn!, direction: direction === "asc" ? "asc" : "desc" }
      : definition.defaultSort,
    filters,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

function compare(left: ListValue, right: ListValue): number {
  // Blanks go last whichever way the list is sorted.
  if (left === null || right === null) {
    return left === right ? 0 : left === null ? 1 : -1;
  }
  const leftValue = left instanceof Date ? left.getTime() : left;
  const rightValue = right instanceof Date ? right.getTime() : right;
  if (typeof leftValue === "string" && typeof rightValue === "string") {
    return leftValue.localeCompare(rightValue, undefined, { sensitivity: "base" });
  }
  return Number(leftValue) - Number(rightValue);
}

/** Every row the query matches, sorted: what an export holds. */
export function matchingRows<Row>(
  rows: readonly Row[],
  definition: ListDefinition<Row>,
  query: ListQuery,
): Row[] {
  const search = query.search.toLowerCase();
  const sortColumn = definition.columns.find((column) => column.key === query.sort.column);
  const directionSign = query.sort.direction === "asc" ? 1 : -1;

  const matching = rows.filter(
    (row) =>
      (!search || definition.searchText(row).toLowerCase().includes(search)) &&
      definition.filters.every((filter) => {
        const value = query.filters[filter.key];
        return value === undefined || filter.matches(row, value);
      }),
  );
  if (!sortColumn?.sortValue) {
    return matching;
  }
  const sortValue = sortColumn.sortValue;
  return [...matching].sort((left, right) => {
    const leftValue = sortValue(left);
    const rightValue = sortValue(right);
    const blanksLast = leftValue === null || rightValue === null;
    return blanksLast
      ? compare(leftValue, rightValue)
      : directionSign * compare(leftValue, rightValue);
  });
}

export interface ListPage<Row> {
  rows: Row[];
  total: number;
  page: number;
  pageCount: number;
}

/** One page of the matching rows. A page past the end shows the last one. */
export function pageOfRows<Row>(
  rows: readonly Row[],
  definition: ListDefinition<Row>,
  query: ListQuery,
): ListPage<Row> {
  const matching = matchingRows(rows, definition, query);
  const pageCount = Math.max(1, Math.ceil(matching.length / LIST_PAGE_SIZE));
  const page = Math.min(query.page, pageCount);
  return {
    rows: matching.slice((page - 1) * LIST_PAGE_SIZE, page * LIST_PAGE_SIZE),
    total: matching.length,
    page,
    pageCount,
  };
}

/**
 * The page address for a query, leaving out anything at its default, with
 * some parts changed: for sort headings, filters and page links.
 */
export function listQueryString<Row>(
  definition: ListDefinition<Row>,
  query: ListQuery,
  changes: Partial<ListQuery> = {},
): string {
  const next = { ...query, ...changes };
  const params = new URLSearchParams();
  if (next.search) {
    params.set(LIST_PARAMS.search, next.search);
  }
  const isDefaultSort =
    next.sort.column === definition.defaultSort.column &&
    next.sort.direction === definition.defaultSort.direction;
  if (!isDefaultSort) {
    params.set(LIST_PARAMS.sort, next.sort.column);
    params.set(LIST_PARAMS.direction, next.sort.direction);
  }
  for (const [key, value] of Object.entries(next.filters)) {
    params.set(key, value);
  }
  if (next.page > 1) {
    params.set(LIST_PARAMS.page, String(next.page));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}
