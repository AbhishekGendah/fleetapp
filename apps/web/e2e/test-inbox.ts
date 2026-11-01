import { Client } from "pg";

/** The newest email sent to an address, as the test inbox holds it. */
export async function latestEmailTo(
  address: string,
): Promise<{ subject: string; text: string; attachmentNames: string[] }> {
  const client = new Client({ connectionString: process.env.E2E_SUPERUSER_URL });
  await client.connect();
  try {
    const result = await client.query<{ subject: string; text: string; attachmentNames: string[] }>(
      `SELECT subject, text, attachment_names AS "attachmentNames" FROM dev_email_outbox WHERE to_address = $1 ORDER BY created_at DESC LIMIT 1`,
      [address],
    );
    const email = result.rows[0];
    if (!email) {
      throw new Error("No email has been sent to that address.");
    }
    return email;
  } finally {
    await client.end();
  }
}
