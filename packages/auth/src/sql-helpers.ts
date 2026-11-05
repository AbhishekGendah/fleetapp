import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/** All this needs of a database: running raw SQL. Both drivers in use qualify. */
export interface SqlExecutor {
  execute(query: SQL): Promise<unknown>;
}

/** A SET clause takes a bare column name; Drizzle would otherwise qualify it. */
export function columnName(column: PgColumn): SQL {
  return sql`${sql.identifier(column.name)}`;
}

/** Both the Neon and node-postgres drivers return rows under `rows`. */
export function firstRow(result: unknown): Record<string, unknown> | undefined {
  if (typeof result !== "object" || result === null) {
    return undefined;
  }
  const rows: unknown = Reflect.get(result, "rows");
  if (!Array.isArray(rows)) {
    return undefined;
  }
  const [row]: unknown[] = rows;
  return typeof row === "object" && row !== null ? (row as Record<string, unknown>) : undefined;
}
