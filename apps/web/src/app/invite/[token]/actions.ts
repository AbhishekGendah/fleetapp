"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { authDb, auth } from "../../../lib/auth";
import { MAXIMUM_PASSWORD_LENGTH, MINIMUM_PASSWORD_LENGTH } from "../../../lib/auth-options";
import { acceptInvite, InviteNotUsableError } from "../../../lib/invites/accept-invite";
import { SET_UP_AUTHENTICATOR_PATH, SIGN_IN_PATH } from "../../../lib/require-user";

const UNEXPECTED_ERROR_MESSAGE = "Something went wrong. Try again in a moment.";

const acceptInviteSchema = z
  .object({
    token: z.string().min(1),
    password: z
      .string()
      .min(MINIMUM_PASSWORD_LENGTH, `At least ${MINIMUM_PASSWORD_LENGTH} characters.`)
      .max(MAXIMUM_PASSWORD_LENGTH, `At most ${MAXIMUM_PASSWORD_LENGTH} characters.`),
    confirmation: z.string(),
  })
  .refine((input) => input.password === input.confirmation, {
    path: ["confirmation"],
    message: "The two passwords were not the same.",
  });

export interface AcceptInviteState {
  formError?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
}

/**
 * Sets the password, then signs the new User straight in and sends them to
 * set up their authenticator. Passwords are never sent back to the form, so a
 * refused attempt starts with empty password boxes.
 */
export async function acceptInviteAction(
  _previous: AcceptInviteState,
  formData: FormData,
): Promise<AcceptInviteState> {
  const parsed = acceptInviteSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmation: formData.get("confirmation"),
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  let email: string;
  try {
    ({ email } = await acceptInvite({
      database: authDb,
      auth,
      token: parsed.data.token,
      password: parsed.data.password,
      now: new Date(),
    }));
  } catch (error) {
    if (error instanceof InviteNotUsableError) {
      return { formError: error.message };
    }
    console.error("Accepting an invite failed", error);
    return { formError: UNEXPECTED_ERROR_MESSAGE };
  }

  // The login exists from here on, so a failure to sign in is not a failure
  // to accept: send them to sign in by hand rather than say it went wrong.
  // redirect() works by throwing, so both calls sit outside any try.
  const isSignedIn = await auth.api
    .signInEmail({ body: { email, password: parsed.data.password }, headers: await headers() })
    .then(() => true)
    .catch((error: unknown) => {
      console.error("Signing in after accepting an invite failed", error);
      return false;
    });
  redirect(isSignedIn ? SET_UP_AUTHENTICATOR_PATH : SIGN_IN_PATH);
}
