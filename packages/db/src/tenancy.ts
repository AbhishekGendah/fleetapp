/**
 * The names that the migrations, the runtime tenant helper and the tenancy
 * tests all have to agree on. They are here so a change is a single edit
 * rather than a search for a string spelled the same way in four places.
 */

/**
 * Postgres setting holding the Operator whose rows the current transaction may
 * touch. Set with `set_config(..., true)` so it lasts for that transaction
 * only and never leaks across pooled connections.
 */
export const TENANT_SETTING_NAME = "app.operator_id";

/** Schema holding the tenancy helper function used by the security policies. */
export const APP_SCHEMA_NAME = "app";

/** Database role used by apps/web at request time. Must not have BYPASSRLS. */
export const WEB_APP_ROLE = "web_app_role";

/** Database role used by apps/admin at request time. Must not have BYPASSRLS. */
export const ADMIN_APP_ROLE = "admin_app_role";

/** The tenancy column carried by every tenant-owned table. See rule 1. */
export const TENANT_ID_COLUMN = "operator_id";

/**
 * Tables scoped by their own primary key instead of an `operator_id` column.
 * `operators` is the tenant, so its tenancy column is `id`. These still have
 * row-level security enabled and forced.
 */
export const SELF_SCOPED_TENANT_TABLES = ["operators"] as const;

/**
 * Tables that carry no tenant scoping at all, because they belong to AGS
 * rather than to an Operator.
 *
 * Row-level security is enabled and forced on every table without exception;
 * these are exempt only from the `operator_id NOT NULL` requirement. Adding a
 * name here is the one way to opt a table out, which makes it a deliberate,
 * reviewable edit rather than an oversight.
 */
export const NON_TENANT_TABLES = ["admin_users"] as const;

/**
 * Tables that are append-only: no updates, no deletes, ever. See rules 11
 * and 19 in CLAUDE.md.
 */
export const APPEND_ONLY_TABLES = ["activity_log"] as const;

/**
 * Schemas that hold no tenant data and are exempt from the structural checks:
 * Postgres internals, the tenancy helper functions, and Drizzle's migration
 * bookkeeping.
 */
export const NON_TENANT_SCHEMAS = ["information_schema", APP_SCHEMA_NAME, "drizzle"] as const;

/**
 * The columns of `operators` that apps/web may change.
 *
 * Deliberately a column-level grant rather than a table-level one. The
 * Operator edits its own business details; it must not be able to set its own
 * Stripe account, mark its own payments enabled, or change its own AGS
 * subscription status, even through a mass-assignment bug in a settings form.
 */
export const WEB_UPDATABLE_OPERATOR_COLUMNS = [
  "legal_name",
  "trading_name",
  "abn",
  "gst_registered",
  "gst_registered_from",
  "address_line1",
  "address_line2",
  "suburb",
  "state",
  "postcode",
  "phone",
  "email",
  "logo_file_key",
  "timezone",
  "updated_at",
] as const;
