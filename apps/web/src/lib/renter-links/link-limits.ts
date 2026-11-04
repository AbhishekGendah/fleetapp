import { LINK_HOURLY_LIMITS, type LinkLimitedAction } from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import { renterLinkAttempts } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { sql } from "drizzle-orm";

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

/** What a Renter sees once a link has done something too often this hour. */
export const TOO_MANY_TRIES_MESSAGE = "Too many tries. Wait a while, then try again.";

/**
 * Counts one try at something a link may do only so often an hour (review
 * G6-6), and says whether it is still within the limit. Counted in the
 * database, so every server sees the same count; a flood or a script is
 * stopped, a Renter never is.
 */
export async function isWithinLinkLimit(
  database: AnyDatabase,
  link: { operatorId: string; linkId: string },
  action: LinkLimitedAction,
  now: Date,
): Promise<boolean> {
  const hourStartsAt = new Date(
    Math.floor(now.getTime() / MILLISECONDS_PER_HOUR) * MILLISECONDS_PER_HOUR,
  );
  const [counted] = await withTenant(database, link.operatorId, (tx) =>
    tx
      .insert(renterLinkAttempts)
      .values({ operatorId: link.operatorId, linkId: link.linkId, action, hourStartsAt })
      .onConflictDoUpdate({
        target: [
          renterLinkAttempts.linkId,
          renterLinkAttempts.action,
          renterLinkAttempts.hourStartsAt,
        ],
        set: { attempts: sql`${renterLinkAttempts.attempts} + 1` },
      })
      .returning({ attempts: renterLinkAttempts.attempts }),
  );
  return (counted?.attempts ?? 0) <= LINK_HOURLY_LIMITS[action];
}
