/**
 * Creates the very first Admin, once.
 *
 * Deliberately a command rather than a web page. A setup page would be an
 * endpoint that exists on the internet, that can be found, and that someone
 * can forget to switch off. This is run by hand, with credentials that are not
 * in the app, and refuses to run if any Admin already exists.
 *
 * Usage:
 *   pnpm --filter admin create-first-admin "you@example.com" "Your Name"
 *
 * The password is read from stdin, never from the command line, so it does not
 * end up in the shell history or in the process list.
 */
import { createInterface } from "node:readline/promises";

import { createDb } from "@fleetapp/db/client";
import {
  ADMIN_ACTIVITY_ACTIONS,
  adminAccounts,
  adminActivityLog,
  adminUsers,
} from "@fleetapp/db/schema";

import { auth } from "../src/lib/auth";
import { env } from "../src/env";

const MINIMUM_PASSWORD_LENGTH = 12;
const EXIT_FAILURE = 1;

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(EXIT_FAILURE);
}

async function readPassword(): Promise<string> {
  const input = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const password = await input.question("Choose a password for the first Admin: ");
    const confirmation = await input.question("Type it again: ");

    if (password !== confirmation) {
      fail("Those two passwords were not the same. Nothing was created.");
    }
    if (password.length < MINIMUM_PASSWORD_LENGTH) {
      fail(`The password must be at least ${MINIMUM_PASSWORD_LENGTH} characters.`);
    }
    return password;
  } finally {
    input.close();
  }
}

async function main(): Promise<void> {
  const [email, fullName] = process.argv.slice(2);

  if (!email || !fullName) {
    fail('Usage: pnpm --filter admin create-first-admin "you@example.com" "Your Name"');
  }

  const db = createDb(env.AUTH_DATABASE_URL);

  const existing = await db.select({ id: adminUsers.id }).from(adminUsers).limit(1);
  if (existing.length > 0) {
    fail(
      "An Admin already exists, so this command will not run. Create further Admins from inside the admin app.",
    );
  }

  const password = await readPassword();

  // Signing up is switched off — Admins are never self-serve — so the rows are
  // written here. The password is hashed by the login system's own hasher, so
  // sign-in verifies it exactly as it would any other password.
  const { password: passwordHasher } = await auth.$context;
  const hashedPassword = await passwordHasher.hash(password);

  await db.transaction(async (tx) => {
    const [admin] = await tx
      .insert(adminUsers)
      .values({
        email,
        fullName,
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
  });

  console.log(
    [
      "",
      `Created the first Admin: ${email}`,
      "",
      "Next: sign in at the admin site. You will be asked to set up your",
      "authenticator app, and shown your recovery codes once.",
      "",
    ].join("\n"),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(EXIT_FAILURE);
});
