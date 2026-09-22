/**
 * Helpers for tests that need a real Postgres with these migrations applied.
 *
 * Exported from the package so the apps can use the same harness rather than
 * each growing its own. Everything here depends on `pg`, which is a dev
 * dependency: this module is for tests, never for application code.
 */
export { startTestPostgres, type TestPostgres } from "./postgres";
export { connectAs, migrateTestDatabase, type TestConnection } from "./connect";
