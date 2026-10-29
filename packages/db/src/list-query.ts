import {
  LIST_PAGE_SIZE,
  listPageBounds,
  searchWords,
  type ListPage,
  type ListQuery,
} from "@fleetapp/core";
import { and, sql, type SQL, type SQLWrapper } from "drizzle-orm";

/**
 * How a list too big to load whole is searched, filtered and sorted by the
 * database, keyed like the list's columns and filters. Every value the
 * person typed reaches Postgres as a parameter, never as SQL.
 */
export interface DatabaseListRules {
  /** Searched as one line of text: "camry white" finds a white Toyota Camry. */
  searchIn: readonly SQLWrapper[];
  sortBy: Readonly<Record<string, SQLWrapper>>;
  filterBy: Readonly<Record<string, (value: string) => SQL | undefined>>;
  /** A unique column, so rows with the same sort value never swap between pages. */
  tieBreaker: SQLWrapper;
}

/** Searching for "50%" looks for those characters, not for "50 and anything". */
function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** The search and filters as a condition, to add to the list's own (its Operator, archived or not). */
export function listConditions(rules: DatabaseListRules, query: ListQuery): SQL | undefined {
  const searchedText = sql`concat_ws(' ', ${sql.join([...rules.searchIn], sql`, `)})`;
  const searchConditions =
    rules.searchIn.length > 0
      ? searchWords(query.search).map(
          (word) => sql`${searchedText} ilike ${`%${escapeLikePattern(word)}%`}`,
        )
      : [];
  const filterConditions = Object.entries(query.filters).map(([key, value]) =>
    rules.filterBy[key]?.(value),
  );
  return and(...searchConditions, ...filterConditions);
}

/** The chosen sort, blanks last whichever way, then the tie-breaker. */
export function listOrderBy(rules: DatabaseListRules, query: ListQuery): SQL[] {
  const sortColumn = rules.sortBy[query.sort.column];
  const direction = sql.raw(query.sort.direction === "asc" ? "asc" : "desc");
  const tieBreak = sql`${rules.tieBreaker} asc`;
  return sortColumn ? [sql`${sortColumn} ${direction} nulls last`, tieBreak] : [tieBreak];
}

export interface ListPageLoaders<Row> {
  count: () => Promise<number>;
  rows: (window: { offset: number; limit: number }) => Promise<Row[]>;
}

/**
 * One page of a list: counts what matches, then loads just that page. Run
 * both inside one transaction, so the count and the rows agree.
 */
export async function loadListPage<Row>(
  query: ListQuery,
  loaders: ListPageLoaders<Row>,
): Promise<ListPage<Row>> {
  const total = await loaders.count();
  const { page, pageCount, offset } = listPageBounds(total, query.page);
  const rows = total === 0 ? [] : await loaders.rows({ offset, limit: LIST_PAGE_SIZE });
  return { rows, total, page, pageCount };
}
