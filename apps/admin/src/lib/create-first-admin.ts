import type { AnyDatabase } from "@fleetapp/db/client";
import {
  ADMIN_ACTIVITY_ACTIONS,
  adminAccounts,
  adminActivityLog,
  adminUsers,
} from "@fleetapp/db/schema";

import type { AdminAuth } from "./auth-options";

/** Long enough to matter, short enough that a passphrase still fits. */
export const MINIMUM_ADMIN_PASSWORD_LENGTH = 12;

/** Thrown when an Admin already exists. Creating further Admins is the admin app's job. */
export class AdminAlreadyExistsError extends Error {
  constructor() {
    super("An Admin already exists, so the first-Admin command will not run.");
    this.name = "AdminAlreadyExistsError";
  }
}

export class WeakPasswordError extends Error {
  constructor() {
    super(`The password must be at least ${MINIMUM_ADMIN_PASSWORD_LENGTH} characters.`);
    this.name = "WeakPasswordError";
  }
}

export interface CreateFirstAdminInput {
  database: AnyDatabase;
  auth: AdminAuth;
  email: string;
  fullName: string;
  password: string;
}

/**
 * Creates the very first Admin, once.
 *
 * Signing up is switched off — Admins are never self-serve — so the rows are
 * written here rather than through the sign-up endpoint. The password is
 * hashed by the login system's own hasher, so sign-in verifies it exactly as
 * it would any other password.
 *
 * The "is there already an Admin?" check and the writes happen in one
 * transaction, so two of these running at once cannot both succeed.
 */
export async function createFirstAdmin(
  input: CreateFirstAdminInput,
): Promise<{ adminUserId: string }> {
  if (input.password.length < MINIMUM_ADMIN_PASSWORD_LENGTH) {
    throw new WeakPasswordError();
  }

  const { password: passwordHasher } = await input.auth.$context;
  const hashedPassword = await passwordHasher.hash(input.password);

  return input.database.transaction(async (tx) => {
    const existing = await tx.select({ id: adminUsers.id }).from(adminUsers).limit(1);

    if (existing.length > 0) {
      throw new AdminAlreadyExistsError();
    }

    const [admin] = await tx
      .insert(adminUsers)
      .values({
        email: input.email,
        fullName: input.fullName,
        // An Admin's address is verified out of band by AGS before this is
        // ever run; there is nobody to send a confirmation link to yet.
        emailVerified: true,
      })
      .returning({ id: adminUsers.id });

    if (!admin) {
      throw new Error("The Admin record was not created.");
    }

    await tx.insert(adminAccounts).values({
      adminUserId: admin.id,
      accountId: admin.id,
      providerId: "credential",
      password: hashedPassword,
      updatedAt: new Date(),
    });

    await tx.insert(adminActivityLog).values({
      adminUserId: admin.id,
      action: ADMIN_ACTIVITY_ACTIONS.created,
    });

    return { adminUserId: admin.id };
  });
}
