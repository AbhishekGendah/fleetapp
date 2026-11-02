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
