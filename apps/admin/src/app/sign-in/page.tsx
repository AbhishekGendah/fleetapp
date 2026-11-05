import type { Metadata } from "next";
import { ADMIN_SESSION, signInNotice } from "@fleetapp/auth/login-policy";

import { SignInScreen } from "./sign-in-screen";

export default async function SignInPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <SignInScreen notice={signInNotice(await props.searchParams, ADMIN_SESSION)} />;
}

/** The admin site's sign-in, in its tab (review A10-2). */
export const metadata: Metadata = { title: "Sign in" };
