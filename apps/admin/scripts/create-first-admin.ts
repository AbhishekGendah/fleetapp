/**
 * Creates the very first Admin, once.
 *
 * Deliberately a command rather than a web page. A setup page would be an
 * endpoint that exists on the internet, that can be found, and that someone
 * can forget to switch off. This is run by hand and refuses to run if any
 * Admin already exists.
 *
 * Usage:
 *   pnpm --filter admin create-first-admin "you@example.com" "Your Name"
 *
 * The password is read from stdin, never from the command line, so it does not
 * end up in the shell history or in the process list.
 */
import { createInterface } from "node:readline/promises";

import { createDb } from "@fleetapp/db/client";

import { env } from "../src/env";
import { auth } from "../src/lib/auth";
import { createFirstAdmin, MINIMUM_ADMIN_PASSWORD_LENGTH } from "../src/lib/create-first-admin";

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
    if (password.length < MINIMUM_ADMIN_PASSWORD_LENGTH) {
      fail(`The password must be at least ${MINIMUM_ADMIN_PASSWORD_LENGTH} characters.`);
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

  const password = await readPassword();

  try {
    await createFirstAdmin({
      database: createDb(env.AUTH_DATABASE_URL),
      auth,
      email,
      fullName,
      password,
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : "Could not create the first Admin.");
  }

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
