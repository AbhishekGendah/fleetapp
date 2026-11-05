import { CLAIM_STATUSES, type ClaimStatus } from "@fleetapp/core";
import { insuranceClaims, ledgerLines } from "@fleetapp/db/schema";
import { qualified } from "@fleetapp/db/qualified";
import { sql, type AnyColumn, type SQL } from "drizzle-orm";

/** A claim still under way: its photos are the insurer's evidence. */
const OPEN_CLAIM_STATUSES: readonly ClaimStatus[] = CLAIM_STATUSES.filter(
  (status) => status === "not_lodged" || status === "lodged" || status === "approved",
);

/**
 * The damage record's photos back something still open, so they can't be
 * removed (batch 7 decision 3): a claim not yet paid, declined or withdrawn,
 * or a charge to the Renter not reversed. Ledger lines are never deleted
 * (rule 11), so a reversal is how a charge is taken back.
 */
export function isDamageEvidenceHeld(
  damageRecordIdColumn: AnyColumn,
  operatorIdColumn: AnyColumn,
): SQL<boolean> {
  return sql<boolean>`(
    exists (
      select 1 from ${insuranceClaims}
      where ${qualified(insuranceClaims.damageRecordId)} = ${qualified(damageRecordIdColumn)}
        and ${qualified(insuranceClaims.operatorId)} = ${qualified(operatorIdColumn)}
        and ${qualified(insuranceClaims.status)}::text in (${sql.join(
          OPEN_CLAIM_STATUSES.map((status) => sql`${status}`),
          sql`, `,
        )})
    )
    or exists (
      select 1 from ${ledgerLines} as "charge"
      where "charge"."damage_record_id" = ${qualified(damageRecordIdColumn)}
        and "charge"."operator_id" = ${qualified(operatorIdColumn)}
        and "charge"."kind" = 'charge'
        and not exists (
          select 1 from ${ledgerLines} as "reversal"
          where "reversal"."reverses_id" = "charge"."id" and "reversal"."operator_id" = "charge"."operator_id"
        )
    )
  )`;
}
