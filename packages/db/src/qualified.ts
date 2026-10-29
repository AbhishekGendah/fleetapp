import { getTableName, sql, type Column, type SQL } from "drizzle-orm";

/**
 * A column written with its table's name, e.g. "vehicles"."id". Drizzle
 * leaves the table name off in a query on one table, so inside a sub-query
 * that reads a second table, a bare "id" would mean the second table's.
 * Every column a correlated sub-query uses goes through here.
 */
export function qualified(column: Column): SQL {
  return sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;
}
