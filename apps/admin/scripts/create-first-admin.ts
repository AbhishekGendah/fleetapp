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
 *
 * Reads its own, smaller set of variables rather than the app's: it never
 * touches the app role's connection, and whoever runs this should have to be
 * handed as little as possible.
 */
import { MINIMUM_PASSWORD_LENGTH } from "@fleetapp/auth/login-policy";
import { describeErrorForLog } from "@fleetapp/core";
import { createInterface, type Interface } from "node:readline/promises";

import { createDb } from "@fleetapp/db/client";
import { z } from "zod";

import { createAdminAuth } from "../src/lib/auth-options";
import {
  AdminAlreadyExistsError,
  createFirstAdmin,
  InvalidAdminDetailsError,
  WeakPasswordError,
} from "../src/lib/create-first-admin";

const EXIT_FAILURE = 1;

const scriptEnvSchema = z.object({
  AUTH_DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  AUTH_ISSUER_NAME: z.string().min(1),
  ADMIN_URL: z.url(),
});

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(EXIT_FAILURE);
}

/**
 * Asks without echoing what is typed, so the password does not end up in the
 * terminal's scrollback or over the shoulder of whoever is nearby.
 */
async function askSecretly(
  input: Interface,
  lines: AsyncIterator<string>,
  prompt: string,
): Promise<string> {
  process.stderr.write(prompt);

  const reveal = input as Interface & { _writeToOutput?: (text: string) => void };
  const previousWriter = reveal._writeToOutput;
  reveal._writeToOutput = () => undefined;

  try {
    // A line iterator rather than question(): when the password is piped in,
    // both lines arrive at once and question() silently drops the second,
    // leaving the command to exit without creating anything or saying why.
    const line = await lines.next();
    if (line.done) {
      fail("No password was entered. Nothing was created.");
    }
    return line.value;
  } finally {
    reveal._writeToOutput = previousWriter;
    process.stderr.write("\n");
  }
}

async function readPassword(): Promise<string> {
  const input = createInterface({ input: process.stdin, output: process.stderr });
  const lines = input[Symbol.asyncIterator]();
  try {
    const password = await askSecretly(input, lines, "Choose a password for the first Admin: ");
    const confirmation = await askSecretly(input, lines, "Type it again: ");

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

  const parsedEnv = scriptEnvSchema.safeParse(process.env);
  if (!parsedEnv.success) {
    fail(
      "Missing settings. This command needs AUTH_DATABASE_URL, BETTER_AUTH_SECRET, " +
        "AUTH_ISSUER_NAME and ADMIN_URL.",
    );
  }
  const env = parsedEnv.data;

  const password = await readPassword();

  const database = createDb(env.AUTH_DATABASE_URL);

  try {
    await createFirstAdmin({
      database,
      auth: createAdminAuth({
        database,
        baseURL: env.ADMIN_URL,
        secret: env.BETTER_AUTH_SECRET,
        issuerName: env.AUTH_ISSUER_NAME,
        recordActivity: async () => undefined,
      }),
      email,
      fullName,
      password,
    });
  } catch (error) {
    // Only our own refusals are worth quoting: a database error's message can
    // hold the email and the password hash.
    const isOwnRefusal =
      error instanceof AdminAlreadyExistsError ||
      error instanceof WeakPasswordError ||
      error instanceof InvalidAdminDetailsError;
    fail(
      isOwnRefusal
        ? error.message
        : `Could not create the first Admin (${describeErrorForLog(error).errorType}).`,
    );
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
  console.error("Creating the first Admin failed", describeErrorForLog(error));
  process.exit(EXIT_FAILURE);
});
