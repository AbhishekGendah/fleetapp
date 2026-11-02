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
