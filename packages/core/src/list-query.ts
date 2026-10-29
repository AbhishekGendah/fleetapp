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
  /** Shown with a sort link. The list's rules must say how to sort by it. */
  isSortable?: boolean;
  /** What goes in the CSV or Excel cell. */
  exportValue: (row: Row) => ListValue;
}

export interface ListFilterOption {
  value: string;
  label: string;
}

export interface ListFilter {
  key: string;
  label: string;
  options: readonly ListFilterOption[];
}

/**
 * What a list shows: its columns, filters and starting sort. How it is
 * searched, filtered and sorted is kept apart, because a small list does it
 * in memory (`InMemoryListRules`) and a large one in the database.
 */
export interface ListDefinition<Row, Column extends ListColumn<Row> = ListColumn<Row>> {
  columns: readonly Column[];
  filters: readonly ListFilter[];
  defaultSort: { column: string; direction: SortDirection };
}

/** How a list held in memory is searched, filtered and sorted, by column and filter key. */
export interface InMemoryListRules<Row> {
  /** The text the search box looks through. */
  searchText: (row: Row) => string;
  sortValues: Readonly<Record<string, (row: Row) => ListValue>>;
  filterMatches: Readonly<Record<string, (row: Row, value: string) => boolean>>;
}

/**
 * The sortable columns and filters a list's rules do not cover: empty when
 * they match. For tests, so a sort link or filter can never do nothing.
 */
export function missingListRules<Row>(
  definition: ListDefinition<Row>,
  rules: { sortKeys: readonly string[]; filterKeys: readonly string[] },
): string[] {
  const sortable = definition.columns.filter((column) => column.isSortable).map((column) => column.key);
  return [
    ...sortable.filter((key) => !rules.sortKeys.includes(key)),
    ...definition.filters.map((filter) => filter.key).filter((key) => !rules.filterKeys.includes(key)),
  ];
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
    (column) => column.key === sortColumn && column.isSortable,
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

/** The words of a search, lower-cased. A row matches when every word is somewhere in it. */
export function searchWords(search: string): string[] {
  return search.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Every row the query matches, sorted: what an export holds. */
export function matchingRows<Row>(
  rows: readonly Row[],
  rules: InMemoryListRules<Row>,
  query: ListQuery,
): Row[] {
  const words = searchWords(query.search);
  const directionSign = query.sort.direction === "asc" ? 1 : -1;

  const matching = rows.filter(
    (row) =>
      words.every((word) => rules.searchText(row).toLowerCase().includes(word)) &&
      Object.entries(query.filters).every(([key, value]) => rules.filterMatches[key]?.(row, value) ?? true),
  );
  const sortValue = rules.sortValues[query.sort.column];
  if (!sortValue) {
    return matching;
  }
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

export interface ListPageBounds {
  page: number;
  pageCount: number;
  /** How many matching rows come before this page. */
  offset: number;
}

/** Which page to show of so many matching rows. A page past the end shows the last one. */
export function listPageBounds(total: number, requestedPage: number): ListPageBounds {
  const pageCount = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  return { page, pageCount, offset: (page - 1) * LIST_PAGE_SIZE };
}

/** One page of the matching rows, for a list held in memory. */
export function pageOfRows<Row>(
  rows: readonly Row[],
  rules: InMemoryListRules<Row>,
  query: ListQuery,
): ListPage<Row> {
  const matching = matchingRows(rows, rules, query);
  const { page, pageCount, offset } = listPageBounds(matching.length, query.page);
  return {
    rows: matching.slice(offset, offset + LIST_PAGE_SIZE),
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
