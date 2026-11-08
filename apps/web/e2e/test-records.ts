import { randomUUID } from "node:crypto";

import { Client } from "pg";

/**
 * Records a signed contract for a rental straight in the test database:
 * for tests of what comes after signing, as signing itself is proven in
 * signing.e2e.ts. The PDF row is a stand-in; nothing opens it.
 */
export async function recordSignedContract(rentalId: string): Promise<void> {
  const client = new Client({ connectionString: process.env.E2E_SUPERUSER_URL });
  await client.connect();
  try {
    const fileId = randomUUID();
    const { rows } = await client.query<{ operator_id: string }>(
      "SELECT operator_id FROM rentals WHERE id = $1",
      [rentalId],
    );
    const operatorId = rows[0]?.operator_id;
    await client.query(
      `INSERT INTO files (id, operator_id, purpose, storage_area, object_key, content_type, size_bytes, confirmed_at)
       VALUES ($1, $2, 'issued_document', 'general', $3, 'application/pdf', 10, now())`,
      [fileId, operatorId, `e2e/${fileId}.pdf`],
    );
    await client.query(
      `INSERT INTO issued_documents (operator_id, rental_id, kind, version, file_id, sha256)
       VALUES ($1, $2, 'contract', 1, $3, $4)`,
      [operatorId, rentalId, fileId, "a".repeat(64)],
    );
  } finally {
    await client.end();
  }
}

/**
 * Marks a booked rental as out with the Renter, straight in the test
 * database: for tests of changes during a rental, as the handover itself is
 * proven in handover.e2e.ts.
 */
export async function markRentalOut(rentalId: string): Promise<void> {
  const client = new Client({ connectionString: process.env.E2E_SUPERUSER_URL });
  await client.connect();
  try {
    await client.query(
      "UPDATE rentals SET status = 'active', handed_over_at = now() WHERE id = $1",
      [rentalId],
    );
  } finally {
    await client.end();
  }
}

/**
 * Records a finished handover with no photos straight in the test
 * database: the rental out, the car Rented at 1,000 km, the Renter holding
 * it since yesterday. For tests of what comes after a handover (a car
 * swap), as the handover itself is proven in handover.e2e.ts.
 */
export async function recordHandover(rentalId: string): Promise<void> {
  const client = new Client({ connectionString: process.env.E2E_SUPERUSER_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{
      operator_id: string;
      vehicle_id: string;
      renter_id: string;
      user_id: string;
    }>(
      `SELECT r.operator_id, r.vehicle_id, r.renter_id, u.id AS user_id
       FROM rentals r JOIN users u ON u.operator_id = r.operator_id
       WHERE r.id = $1 LIMIT 1`,
      [rentalId],
    );
    const rental = rows[0]!;
    const handedOverAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const inspectionId = randomUUID();
    await client.query(
      `INSERT INTO inspections (id, operator_id, rental_id, vehicle_id, kind, status, photo_names,
         odometer_km, fuel_level, keys_count, started_by_user_id, acceptance_text, completed_at)
       VALUES ($1, $2, $3, $4, 'handover', 'completed', '{}', 1000, 'full', 2, $5,
         'Accepted in the test.', $6)`,
      [inspectionId, rental.operator_id, rentalId, rental.vehicle_id, rental.user_id, handedOverAt],
    );
    await client.query(
      `INSERT INTO possessions (operator_id, rental_id, vehicle_id, renter_id, started_at,
         handover_inspection_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        rental.operator_id,
        rentalId,
        rental.vehicle_id,
        rental.renter_id,
        handedOverAt,
        inspectionId,
      ],
    );
    await client.query("UPDATE rentals SET status = 'active', handed_over_at = $2 WHERE id = $1", [
      rentalId,
      handedOverAt,
    ]);
    await client.query("UPDATE vehicles SET status = 'rented' WHERE id = $1", [rental.vehicle_id]);
  } finally {
    await client.end();
  }
}

/**
 * Records a handed-over rental as back an hour ago, straight in the test
 * database: the Renter's time with the car ends and the car's hold is let
 * go, as the return does. For tests of what shows a rental's past (the
 * timeline), as the return itself is proven in handover.e2e.ts.
 */
export async function recordReturn(rentalId: string): Promise<void> {
  const client = new Client({ connectionString: process.env.E2E_SUPERUSER_URL });
  await client.connect();
  try {
    const returnedAt = new Date(Date.now() - 60 * 60 * 1000);
    await client.query(
      "UPDATE possessions SET ended_at = $2 WHERE rental_id = $1 AND ended_at IS NULL",
      [rentalId, returnedAt],
    );
    await client.query(
      "UPDATE car_holds SET released_at = $2 WHERE rental_id = $1 AND released_at IS NULL",
      [rentalId, returnedAt],
    );
    await client.query("UPDATE rentals SET status = 'returned', returned_at = $2 WHERE id = $1", [
      rentalId,
      returnedAt,
    ]);
    await client.query(
      "UPDATE vehicles SET status = 'available' FROM rentals WHERE rentals.id = $1 AND vehicles.id = rentals.vehicle_id",
      [rentalId],
    );
  } finally {
    await client.end();
  }
}

/**
 * Makes a rental out (`recordHandover`) late back, straight in the test
 * database: booked from three days ago until an hour ago, its car's hold
 * with it, and the car not returned. For tests of a car still out past its
 * return date (docs/plans/find-a-car.md, decision 5).
 */
export async function recordLateBack(rentalId: string): Promise<void> {
  const client = new Client({ connectionString: process.env.E2E_SUPERUSER_URL });
  await client.connect();
  try {
    await client.query(
      `UPDATE rentals SET planned_start = now() - interval '3 days', planned_end = now() - interval '1 hour'
       WHERE id = $1`,
      [rentalId],
    );
    await client.query(
      `UPDATE car_holds SET held_during = tstzrange(now() - interval '3 days', now() - interval '1 hour', '[)')
       WHERE rental_id = $1 AND released_at IS NULL`,
      [rentalId],
    );
  } finally {
    await client.end();
  }
}

/** Puts a car in the workshop until a day, straight in the test database. */
export async function recordInWorkshop(rego: string, expectedBack: string): Promise<void> {
  const client = new Client({ connectionString: process.env.E2E_SUPERUSER_URL });
  await client.connect();
  try {
    await client.query(
      `UPDATE vehicles SET status = 'in_service', status_reason = 'New clutch',
         status_expected_back = $2 WHERE rego = $1`,
      [rego, expectedBack],
    );
  } finally {
    await client.end();
  }
}

/**
 * Records a rego on direct debit and an insurance policy covering every
 * test date for a car, straight in the test database: a handover asks why a
 * car goes without them (review A8-2), proven in handover.e2e.ts.
 */
export async function recordCurrentPaperwork(rego: string): Promise<void> {
  const client = new Client({ connectionString: process.env.E2E_SUPERUSER_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string; operator_id: string }>(
      "SELECT id, operator_id FROM vehicles WHERE rego = upper($1) AND archived_at IS NULL",
      [rego],
    );
    const car = rows[0];
    if (!car) {
      throw new Error(`No car ${rego} to record paperwork for.`);
    }
    await client.query(
      `INSERT INTO vehicle_registrations (operator_id, vehicle_id, state, term_months, paid_on, cost_cents)
       VALUES ($1, $2, 'WA', 1, '2020-01-01', 0)`,
      [car.operator_id, car.id],
    );
    const policy = await client.query<{ id: string }>(
      `INSERT INTO insurance_policies (operator_id, insurer, policy_number, cover_type, starts_on, ends_on, cost_cents)
       VALUES ($1, 'Test Insurer', $2, 'comprehensive', '2020-01-01', '2099-12-31', 0) RETURNING id`,
      [car.operator_id, randomUUID().slice(0, 8).toUpperCase()],
    );
    await client.query(
      `INSERT INTO insurance_policy_vehicles (operator_id, policy_id, vehicle_id) VALUES ($1, $2, $3)`,
      [car.operator_id, policy.rows[0]!.id, car.id],
    );
  } finally {
    await client.end();
  }
}

/**
 * Adds a charge to a rental as if it had been due `daysAgo` days ago and is
 * still unpaid, straight in the test database (ledger lines are only ever
 * added, never changed). For tests of what is overdue, which would otherwise
 * need a rental out for weeks. Uses the rental's own rent charge type.
 */
export async function recordUnpaidCharge(
  rentalId: string,
  charge: { daysAgo: number; amountCents: number },
): Promise<void> {
  const client = new Client({ connectionString: process.env.E2E_SUPERUSER_URL });
  await client.connect();
  try {
    // Days are counted on the Operator's own calendar, as the app counts them: a UTC date
    // is a day behind in Perth from 4 pm UTC, which made "N days late" read N + 1.
    await client.query(
      `INSERT INTO ledger_lines (operator_id, rental_id, kind, charge_type_id, amount_cents,
         gst_cents, description, effective_on)
       SELECT line.operator_id, line.rental_id, 'charge', line.charge_type_id, $2, 0,
         'Unpaid towing', (now() AT TIME ZONE operator.timezone)::date - $3::int
       FROM ledger_lines line JOIN operators operator ON operator.id = line.operator_id
       WHERE line.rental_id = $1 AND line.kind = 'charge' LIMIT 1`,
      [rentalId, charge.amountCents, charge.daysAgo],
    );
  } finally {
    await client.end();
  }
}
