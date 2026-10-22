import type { AnyDatabase } from "@fleetapp/db/client";
import { devEmailOutbox } from "@fleetapp/db/schema";
import { desc, eq } from "drizzle-orm";

/** The test inbox is for trying things out, not an archive. */
const OUTBOX_LIST_LIMIT = 100;

export interface OutboxEmailSummary {
  id: string;
  toAddress: string;
  subject: string;
  createdAt: Date;
}

export async function listOutboxEmails(database: AnyDatabase): Promise<OutboxEmailSummary[]> {
  return database
    .select({
      id: devEmailOutbox.id,
      toAddress: devEmailOutbox.toAddress,
      subject: devEmailOutbox.subject,
      createdAt: devEmailOutbox.createdAt,
    })
    .from(devEmailOutbox)
    .orderBy(desc(devEmailOutbox.createdAt))
    .limit(OUTBOX_LIST_LIMIT);
}

export type OutboxEmail = typeof devEmailOutbox.$inferSelect;

export async function getOutboxEmail(
  database: AnyDatabase,
  emailId: string,
): Promise<OutboxEmail | null> {
  const [email] = await database
    .select()
    .from(devEmailOutbox)
    .where(eq(devEmailOutbox.id, emailId));
  return email ?? null;
}
