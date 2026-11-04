import { BOND_MOVEMENT_KINDS } from "@fleetapp/core";
import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { primaryKeyColumn } from "./columns";
import { paymentMethodEnum } from "./enums";
import { payments } from "./payments";
import { operatorIdColumn } from "./operators";
import { rentals } from "./rentals";
import { users } from "./users";

export const bondMovementKindEnum = pgEnum("bond_movement_kind", BOND_MOVEMENT_KINDS);

/**
 * One movement on a rental's bond account (docs/design/06): money received,
 * refunded or deducted, or a reversal that undoes one earlier entry exactly.
 * Only ever added to; what is held is worked out from these rows, never
 * stored. Amounts are positive cents; the kind says which way it went.
 */
export const bondMovements = pgTable(
  "bond_movements",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    rentalId: uuid("rental_id").notNull(),
    kind: bondMovementKindEnum("kind").notNull(),
    amountCents: integer("amount_cents").notNull(),
    /** How the money moved; for money received or refunded only. */
    method: paymentMethodEnum("method"),
    /** The bank transfer's reference or a receipt number, in capitals. */
    reference: text("reference"),
    /** The day the money moved, in the Operator's timezone. */
    occurredOn: date("occurred_on").notNull(),
    /** Why: needed for a deduction or a reversal. */
    note: text("note"),
    /** The entry a reversal undoes. */
    reversesId: uuid("reverses_id"),
    /**
     * The payment through Stripe this money came in by (recorded once Stripe
     * says it succeeded), or went back out of by a refund or dispute.
     */
    paymentId: uuid("payment_id"),
    /** The Stripe refund or dispute an entry came from, so a repeated message adds nothing (rule 20). */
    stripeObjectId: text("stripe_object_id"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: "bond_movements_rental_fk",
      columns: [table.rentalId, table.operatorId],
      foreignColumns: [rentals.id, rentals.operatorId],
    }),
    unique("bond_movements_id_rental_unique").on(table.id, table.operatorId, table.rentalId),
    // A reversal undoes an entry of the same rental (and Operator), and each entry only once.
    foreignKey({
      name: "bond_movements_reverses_fk",
      columns: [table.reversesId, table.operatorId, table.rentalId],
      foreignColumns: [table.id, table.operatorId, table.rentalId],
    }),
    unique("bond_movements_reversed_once").on(table.reversesId),
    // A payment's money lands on its own rental's bond, once.
    foreignKey({
      name: "bond_movements_payment_fk",
      columns: [table.paymentId, table.operatorId, table.rentalId],
      foreignColumns: [payments.id, payments.operatorId, payments.rentalId],
    }),
    // A payment lands on the bond once; a dispute won puts it back under the dispute's own ID.
    uniqueIndex("bond_movements_one_per_payment")
      .on(table.paymentId)
      .where(sql`${table.kind} = 'received' and ${table.stripeObjectId} is null`),
    unique("bond_movements_stripe_object_once").on(table.stripeObjectId, table.kind),
    check(
      "bond_movements_payment_kind",
      sql`${table.paymentId} is null or ${table.kind} in ('received', 'refunded')`,
    ),
    check(
      "bond_movements_stripe_object_shape",
      sql`${table.stripeObjectId} is null or ${table.stripeObjectId} ~ '^(re|pyr|du)_[A-Za-z0-9]+$'`,
    ),
    index("bond_movements_rental_idx").on(table.operatorId, table.rentalId),
    check("bond_movements_amount", sql`${table.amountCents} > 0`),
    check(
      "bond_movements_reversal",
      sql`(${table.kind} = 'reversal') = (${table.reversesId} is not null)`,
    ),
    check(
      "bond_movements_method",
      sql`(${table.kind} in ('received', 'refunded')) = (${table.method} is not null)`,
    ),
    check(
      "bond_movements_note",
      sql`${table.kind} not in ('deducted', 'reversal') or ${table.note} is not null`,
    ),
  ],
);
