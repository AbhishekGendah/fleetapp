/**
 * Whether the database updates in the repo and the ones a database has
 * already run still agree (review G1-1). Drizzle itself runs only updates
 * dated after the newest one already run, so without this check an update
 * edited after it ran, or one merged out of order, would be skipped for good
 * and the run would still report success.
 */

/** An update in the repo: its journal date (its identity to Drizzle), name and fingerprint. */
export interface RepoMigration {
  tag: string;
  folderMillis: number;
  hash: string;
}

/** An update the database has run, as Drizzle records it. */
export interface AppliedMigration {
  hash: string;
  createdAt: number;
}

/** What is wrong, in words for whoever runs the update; empty when all is well. */
export function findMigrationProblems(
  repo: readonly RepoMigration[],
  applied: readonly AppliedMigration[],
): string[] {
  const problems: string[] = [];
  repo.forEach((migration, index) => {
    const before = repo[index - 1];
    if (before && migration.folderMillis <= before.folderMillis) {
      problems.push(
        `${migration.tag} is dated no later than ${before.tag}: the journal must be in date order.`,
      );
    }
  });
  const repoByDate = new Map(repo.map((migration) => [migration.folderMillis, migration]));
  for (const done of applied) {
    const migration = repoByDate.get(done.createdAt);
    if (!migration) {
      problems.push(
        `The database has run an update dated ${done.createdAt} that is not in the repo.`,
      );
    } else if (migration.hash !== done.hash) {
      problems.push(
        `${migration.tag} was changed after it ran. Never edit an update that has run: add a new one.`,
      );
    }
  }
  const newestApplied = Math.max(...applied.map((done) => done.createdAt), -Infinity);
  const appliedDates = new Set(applied.map((done) => done.createdAt));
  for (const migration of repo) {
    if (migration.folderMillis < newestApplied && !appliedDates.has(migration.folderMillis)) {
      problems.push(
        `${migration.tag} is older than updates already run, so it would be skipped. Regenerate it so it comes last.`,
      );
    }
  }
  return problems;
}
